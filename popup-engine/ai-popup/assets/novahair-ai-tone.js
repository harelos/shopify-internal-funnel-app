/**
 * NovaHair AI concierge - tone matching.
 *
 * Reads how she writes and quietly adapts how the assistant writes back:
 * message length, warmth, and whether proof leads or follows.
 *
 * THE RULE: mirror the style, never name the observation.
 * The assistant must never say "I see you're in a hurry" or "you sound
 * unsure". The moment the adaptation becomes visible it reads as surveillance
 * and the whole thing feels worse than not adapting at all. Everything here
 * changes HOW a line is written, never adds a line ABOUT her.
 *
 * Also deliberately absent: parroting her words back. Echoing someone's
 * phrasing is the most recognisable AI tic in Hebrew chat.
 */
window.NovaHairAITone = (function () {
  'use strict';

  var S = {
    samples: 0, words: 0, exclamations: 0, questions: 0,
    emoji: 0, casual: 0, formal: 0, skeptic: 0, urgent: 0, english: 0
  };

  /* Israeli casual register. Presence of any of these means she is relaxed
   * and a stiff reply will feel like a call centre. */
  var CASUAL = ['אחלה', 'סבבה', 'יאללה', 'וואי', 'חחח', 'חח', 'כאילו', 'בקיצור',
                'תכלס', 'ממש', 'לגמרי', 'איזה כיף', 'מגניב'];
  /* Formal / distant register. */
  var FORMAL = ['אשמח', 'אודה', 'בבקשה', 'תודה רבה', 'אני מעוניינת', 'האם ניתן',
                'ברצוני', 'אבקש'];
  /* Doubt. When present, proof should lead and the claim should follow. */
  var SKEPTIC = ['באמת', 'לא בטוחה', 'נשמע לי', 'ספק', 'עובד?', 'שקר', 'בטוח ש',
                 'מנסיון', 'לא מאמינה', 'כאילו זה'];
  /* Time pressure. Shorten everything. */
  var URGENT = ['מהר', 'דחוף', 'עכשיו', 'מחר', 'אין לי זמן', 'בקצרה'];

  var EMOJI = /[←-⇿⌀-➿\uD83C-􏰀-\uDFFF☀-⛿]/;
  var LATIN = /[a-zA-Z]{3,}/;

  function count(text, list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (text.indexOf(list[i]) !== -1) n++;
    return n;
  }

  /* Feed every free-text answer she gives. Button clicks carry no style. */
  function observe(text) {
    var t = String(text || '').trim();
    if (!t) return;
    S.samples++;
    S.words += t.split(/\s+/).length;
    S.exclamations += (t.match(/!/g) || []).length;
    S.questions += (t.match(/\?/g) || []).length;
    if (EMOJI.test(t)) S.emoji++;
    if (LATIN.test(t)) S.english++;
    S.casual  += count(t, CASUAL);
    S.formal  += count(t, FORMAL);
    S.skeptic += count(t, SKEPTIC);
    S.urgent  += count(t, URGENT);
  }

  function profile() {
    var avg = S.samples ? S.words / S.samples : 0;
    return {
      samples: S.samples,
      /* Terse writers find two-line replies patronising. Chatty writers
       * find one-line replies cold. */
      length: S.samples === 0 ? 'unknown' : (avg <= 3.5 ? 'terse' : (avg >= 11 ? 'chatty' : 'normal')),
      register: S.casual > S.formal ? 'casual' : (S.formal > S.casual ? 'formal' : 'neutral'),
      skeptical: S.skeptic > 0,
      urgent: S.urgent > 0,
      usesEmoji: S.emoji > 0,
      mixesEnglish: S.english > 0,
      warm: S.exclamations >= 2
    };
  }

  /* Compact key for analytics. Short on purpose: it goes on every step row. */
  function key() {
    var p = profile();
    return [p.length, p.register, p.skeptical ? 'skep' : '', p.urgent ? 'urg' : '']
      .filter(Boolean).join('/');
  }

  /* Rewrites the assistant's OWN lines to match her rhythm.
   * Never adds content, only removes or softens. */
  /* `protect` holds indices that must survive trimming no matter what.
   * Honest limits and disclosures live there. Shortening for style is fine;
   * silently dropping the sentence that keeps a claim truthful is not. */
  function adapt(messages, protect) {
    var p = profile();
    var out = messages.slice();
    var keep = protect || [];

    /* She writes in three words. Do not send her a paragraph. */
    if (p.length === 'terse' || p.urgent) {
      out = messages.filter(function (m, i) { return i === 0 || keep.indexOf(i) !== -1; });
    }

    /* Doubt present: lead with the honest limit rather than the benefit,
     * so the first thing she reads is the thing she can verify. */
    if (p.skeptical && out.length > 1) {
      var limitIdx = -1;
      for (var i = 0; i < out.length; i++) {
        if (out[i].indexOf('לא מחליף') !== -1 || out[i].indexOf('לא מנסה') !== -1) limitIdx = i;
      }
      if (limitIdx > 0) {
        var limit = out.splice(limitIdx, 1)[0];
        out.unshift(limit);
      }
    }

    /* Formal writer: drop the chattier connectors so we match her distance. */
    if (p.register === 'formal') {
      out = out.map(function (m) {
        return m.replace(/^הגיוני\.\s*/, '').replace(/^הוגן\.\s*/, '');
      });
    }

    return out;
  }

  /* One short instruction appended to the model's system prompt.
   * Style only. It must never contain an inference about her as a person. */
  function styleDirective() {
    var p = profile();
    if (!p.samples) return '';
    var bits = [];
    if (p.length === 'terse' || p.urgent) bits.push('היא כותבת קצר. עני במשפט אחד בלבד.');
    if (p.length === 'chatty') bits.push('אפשר שני משפטים, לא יותר.');
    if (p.register === 'casual') bits.push('הרשמיות שלה נמוכה. דברי בגובה העיניים, בלי מליצות.');
    if (p.register === 'formal') bits.push('היא כותבת רשמית. שמרי על טון ענייני.');
    if (p.skeptical) bits.push('היא ספקנית. פתחי במה שאפשר לאמת, בלי הבטחות.');
    bits.push('אל תזכירי שזיהית משהו על סגנון הכתיבה שלה. אל תחזרי על המילים שלה.');
    return bits.join(' ');
  }

  function reset() {
    Object.keys(S).forEach(function (k) { S[k] = 0; });
  }

  return {
    observe: observe,
    profile: profile,
    key: key,
    adapt: adapt,
    styleDirective: styleDirective,
    reset: reset
  };
})();
