/**
 * NovaHair AI concierge - conversation flows v2.
 *
 * Structure follows BELIEF_OBJECTION_MAP.md:
 *   recognition -> status-quo disadvantage -> inference space
 *   -> credible alternative -> low-risk choice
 *
 * SPIN is used as an internal planner, not a script. Situation and Problem are
 * real branching questions because in a chat that is the natural medium.
 * Implication is STATED once, flatly, never asked rhetorically.
 *
 * Deliberately absent: any line that reveals we tracked her behaviour.
 * "I noticed you spent time on the product" and "let me guess why you're
 * leaving" were both cut. They are the fastest route to feeling watched.
 */
window.NovaHairAIFlows = {
  version: 'nova_ai_v2',

  /* The advisor is a real, named NovaHair specialist rather than anonymous
   * support. Keep this identity consistent in the header and every opener. */
  advisor: {
    name: 'נעמה לוי',
    role: 'מומחית צביעת השיער של NovaHair',
    avatar: 'img/advisor.png'
  },

  /* Openers put her inside a moment before naming anything (§9), and each
   * one carries an anchor that no other hair brand could reuse (§32). */
  openers: {
    default: 'היי, אני נעמה. אני מומחית לצביעת השיער של Nova מבית TigerBrandsGlobal. ואני כאן כדי לעזור לך עם כל שאלה.',
    cost:    'היי, אני נעמה, מומחית צביעת השיער של NovaHair. אם הגעת בגלל העלות של חידוש שורשים במספרה, יש מספר אחד ששווה לך לראות.',
    roots:   'היי, אני נעמה, מומחית צביעת השיער של NovaHair. אם השורשים כבר חזרו שבועיים אחרי הצבע, בואי נראה מה יכול להתאים לך.',
    shade:   'היי, אני נעמה, מומחית צביעת השיער של NovaHair. אם מה שעוצר אותך הוא גוון שלא יתמזג, נוכל לדייק אותו יחד.'
  },

  /* Sent only if she has not touched anything. One line, no pressure. */
  hook: 'רוב הנשים לא סוגרות את הדף כי הן לא מעוניינות. הן סוגרות כי נשארה שאלה אחת בלי תשובה.',

  entry: 'ask_name',

  /* The discount lever. Kept here so it is never hardcoded in the runtime.
   * Must match the Shopify discount code and the Worker NOVAHAIR_POPUP_COUPON. */
  coupon: {
    code: 'NOVA10',
    /* Shopify applies the code and drops the shopper on the sales page. */
    applyPath: '/discount/NOVA10?redirect=/pages/novahair-sales-staging'
  },

  /* Tag sets that drive offerDecision(). "ready" means she signalled intent to
   * buy; "price" means the blocker is cost. A coupon is only worthwhile when
   * price is the blocker AND she has not already decided to buy. */
  intentTags: {
    ready: ['shade_cta', 'bundle_cta', 'buy_cta', 'repeat_same'],
    price: ['price', 'wants_compare', 'wants_answer', 'to_bundle', 'wants_coupon']
  },

  /* Words that route her out of the sales conversation entirely. */
  escalationTriggers: [
    'הזמנתי', 'ההזמנה שלי', 'לא הגיע', 'לא קיבלתי', 'החזר', 'לבטל', 'ביטול',
    'תלונה', 'פגום', 'שבור', 'טעות', 'חייבו אותי', 'כסף בחזרה', 'שירות לקוחות',
    'משלוח שלי', 'מתי יגיע'
  ],

  /* Topics the assistant must never answer. Routed to a human. */
  refusalTriggers: [
    'הריון', 'בהריון', 'מניקה', 'אלרגי', 'אלרגיה', 'תרופה', 'כימותרפי',
    'קרקפת פצועה', 'רופא', 'מחלה', 'ילד', 'ילדה בת'
  ],

  nodes: {

    /* A real landing point after an open-text answer. The Worker deliberately
     * sends approved factual replies here so a shipping or warranty question
     * cannot accidentally fall through to an unrelated keyword flow. */
    root_choice: {
      id: 'root_choice',
      type: 'ask',
      messages: ['מה תרצי לבדוק עכשיו?'],
      allowFree: true,
      freePlaceholder: 'אפשר לשאול עוד שאלה',
      options: [
        { id: 'shade_help', label: 'עזרי לי לבחור גוון', next: 'shade_photo',  tag: 'to_shade' },
        { id: 'how',        label: 'איך משתמשים',        next: 'proof_how',    tag: 'to_how' },
        { id: 'bundles',    label: 'מחירים ומארזים',     next: 'price_bundle', tag: 'to_bundle' },
        { id: 'done',       label: 'זה ענה לי, תודה',    next: 'close',        tag: 'done' }
      ]
    },

    /* ============================================================== *
     * 0. Name. Lowest-commitment possible opener, and it makes every
     *    later line readable as a person talking.
     * ============================================================== */
    ask_name: {
      id: 'ask_name',
      type: 'ask',
      messages: ['איך קוראים לך?'],
      allowFree: true,
      freePlaceholder: 'השם שלך',
      captureAs: 'name',
      options: [
        { id: 'skip_name', label: 'מעדיפה בלי שם כרגע', next: 'situation', tag: 'no_name' }
      ],
      next: 'situation'
    },

    /* ============================================================== *
     * 1. SITUATION - recognition. Something she already knows is true.
     * ============================================================== */
    situation: {
      id: 'situation',
      type: 'ask',
      /* Situation, anchored in the mirror moment rather than asked
       * abstractly. The buttons are her words, not category labels. */
      messages: ['{{greet}}איך את מסתדרת היום עם השורש שיוצא בין צבע לצבע?'],
      options: [
        { id: 'salon_regular', label: 'מחכה לתור הבא במספרה',   next: 'problem',     tag: 'salon' },
        { id: 'home_already',  label: 'כבר צובעת לבד בבית',      next: 'problem',     tag: 'home' },
        { id: 'growing_out',   label: 'נתתי לזה לגדול והתחרטתי', next: 'problem',     tag: 'grow_out' },
        { id: 'first_time',    label: 'רק מתחילה לברר',          next: 'proof_roots', tag: 'new' }
      ]
    },

    /* ============================================================== *
     * 2. PROBLEM - what specifically is annoying.
     * ============================================================== */
    problem: {
      id: 'problem',
      type: 'ask',
      /* Declarative, then one question. Two questions back to back would
       * read as an interrogation (§3). */
      messages: ['ומה החלק שהכי מעצבן שם?'],
      allowFree: true,
      freePlaceholder: 'אפשר לכתוב במילים שלך',
      options: [
        { id: 'timing',  label: 'השורשים חוזרים תוך שבועיים',  next: 'implication', tag: 'roots' },
        { id: 'cost',    label: 'כמה זה עולה לי בסוף',          next: 'price_bundle', tag: 'price' },
        { id: 'hassle',  label: 'לתאם תור ולהגיע לשם',          next: 'implication', tag: 'hassle' },
        { id: 'shade',   label: 'שלא אדע לבחור גוון נכון',      next: 'shade_open',  tag: 'shade' },
        { id: 'natural', label: 'שיראו עליי שצבעתי לבד',        next: 'proof_roots', tag: 'natural' }
      ]
    },

    /* ============================================================== *
     * 3. IMPLICATION - stated once, as an observation. Not a question,
     *    not a guilt trip. She draws the conclusion herself.
     * ============================================================== */
    implication: {
      id: 'implication',
      type: 'ask',
      /* Status-quo cost, stated flatly. No question mark, no guilt. */
      messages: [
        'הצבע עצמו כמעט אף פעם לא הבעיה. מה שמעייף זה השבועיים והשלושה שבין הצבע לתור הבא.',
        'זאת התקופה שבה את מסתכלת במראה ולא אוהבת מה שאת רואה, והיא חוזרת כל חודש.'
      ],
      options: [
        { id: 'exactly',  label: 'זה בדיוק זה',           next: 'need_payoff', tag: 'agrees' },
        { id: 'partly',   label: 'קצת',                   next: 'need_payoff', tag: 'partial' },
        { id: 'not_me',   label: 'לא, אצלי זה משהו אחר',  next: 'problem',     tag: 'reframe' }
      ]
    },

    /* ============================================================== *
     * 4. NEED-PAYOFF - she names the value, we do not.
     * ============================================================== */
    need_payoff: {
      id: 'need_payoff',
      type: 'ask',
      /* The one need-payoff question. She names the value, not us. */
      messages: ['אם היית מסדרת את השורש בבית בעשר דקות, מה זה היה פותר לך קודם כל?'],
      options: [
        { id: 'time',   label: 'לא לתאם ולא לנסוע',       next: 'proof_how',   tag: 'time' },
        { id: 'money',  label: 'לחסוך את העלות החוזרת',   next: 'price_open',  tag: 'price' },
        { id: 'look',   label: 'לא ללכת עם שורש לבן',     next: 'proof_roots', tag: 'look' },
        { id: 'unsure', label: 'עוד לא בטוחה שזה בשבילי', next: 'proof_roots', tag: 'skeptic' }
      ]
    },

    /* ============================================================== *
     * SCENARIO A - shade. The photo step is the spine.
     * ============================================================== */
    shade_open: {
      id: 'shade_open',
      type: 'say',
      messages: [
        'הגיוני. הפחד הוא כמעט אף פעם לא מהצביעה, אלא מלבחור גוון שלא יתמזג עם השאר.',
        'אפשר לפתור את זה בעשר שניות.'
      ],
      next: 'shade_photo'
    },

    shade_photo: {
      id: 'shade_photo',
      type: 'photo',
      messages: [
        'צלמי את אזור השורשים באור טבעי, או העלי תמונה, כדי לקבל כיוון ראשוני מתוך חמשת הגוונים.',
        'התמונה נבדקת אצלך במכשיר ולא נשלחת לשום מקום.'
      ],
      skipLabel: 'אני מעדיפה לבחור לבד',
      skipNext: 'shade_manual',
      next: 'shade_result'
    },

    shade_manual: {
      id: 'shade_manual',
      type: 'ask',
      messages: ['אין בעיה. מה הכי קרוב לשיער שלך עכשיו?'],
      options: [
        { id: 'black',       label: 'שחור',         next: 'shade_result', tag: 'black' },
        { id: 'dark_brown',  label: 'חום כהה',      next: 'shade_result', tag: 'dark_brown' },
        { id: 'light_brown', label: 'חום בהיר',     next: 'shade_result', tag: 'light_brown' },
        { id: 'eggplant',    label: 'סגול חציל',    next: 'shade_result', tag: 'eggplant' },
        { id: 'wine_red',    label: 'אדום יין',     next: 'shade_result', tag: 'wine_red' },
        { id: 'unsure',      label: 'אני לא בטוחה', next: 'shade_narrow', tag: 'unsure' }
      ]
    },

    shade_narrow: {
      id: 'shade_narrow',
      type: 'ask',
      messages: ['בואי נצמצם. השיער שלך נוטה לכיוון קר וכהה, או חמים ובהיר?'],
      options: [
        { id: 'cool', label: 'קר וכהה',    next: 'shade_result', tag: 'cool' },
        { id: 'warm', label: 'חמים ובהיר', next: 'shade_result', tag: 'warm' }
      ]
    },

    shade_result: {
      id: 'shade_result',
      type: 'card',
      messages: ['כהתאמה ראשונית, הייתי מתחילה מ{{shade}}. כדאי לוודא מול תמונות הגוונים לפני ההזמנה.'],
      card: { kind: 'shades', highlight: '{{shadeKey}}' },
      options: [
        { id: 'see_shade', label: 'קחי אותי לגוון הזה',   next: 'offer',       tag: 'shade_cta' },
        { id: 'manual',    label: 'אני רוצה לבחור ידנית',  next: 'shade_manual',tag: 'manual_check' },
        { id: 'learn_how', label: 'איך זה עובד בפועל',       next: 'proof_how',   tag: 'wants_explanation' },
        { id: 'another_q', label: 'יש לי עוד שאלה',       next: 'problem',     tag: 'loop' }
      ]
    },

    /* ============================================================== *
     * SCENARIO B - price. Fair comparison, no discount reflex.
     * ============================================================== */
    price_open: {
      id: 'price_open',
      type: 'ask',
      messages: [
        'הוגן. רק שההשוואה הנכונה היא כמעט אף פעם לא מול לא לעשות כלום.',
        'רוצה לראות מול מה כדאי להשוות?'
      ],
      options: [
        { id: 'yes',      label: 'כן, תראי לי',              next: 'price_compare', tag: 'wants_compare' },
        { id: 'best',     label: 'תגידי לי מה הכי כדאי',     next: 'price_bundle',  tag: 'wants_answer' },
        { id: 'thinking', label: 'אני עוד חושבת',            next: 'graceful',      tag: 'hesitant' }
      ]
    },

    price_compare: {
      id: 'price_compare',
      type: 'card',
      messages: ['ההשוואה היא מול תחזוקה חוזרת, הזמן שהיא לוקחת, והתלות בתור פנוי.'],
      card: { kind: 'cost' },
      options: [
        { id: 'show_bundle', label: 'כן, נשמע טוב, אני רוצה', next: 'price_bundle_confirmed', tag: 'bundle_cta' },
        { id: 'why_switch',  label: 'למה נשים עוברות לזה',    next: 'why_switch',            tag: 'wants_reason' }
      ]
    },

    why_switch: {
      id: 'why_switch',
      type: 'ask',
      messages: [
        'בעיקר בגלל השליטה: לא לחכות לתור בכל פעם שהשורש יוצא, ולא לבנות סביבו חצי יום.',
        'עם NovaHair אפשר לחדש את השורשים בבית בתוך 10 עד 15 דקות, בלי ערבוב ובלי אמוניה. במארז 4 הבקבוקים העלות היא כ־₪{{costPerTreatment}} לטיפול שורשים.'
      ],
      protect: [1],
      options: [
        { id: 'ready',    label: 'כן, זה בדיוק מה שאני מחפשת', next: 'price_bundle_confirmed', tag: 'bundle_cta' },
        { id: 'shade',    label: 'עזרי לי לבחור גוון',          next: 'shade_photo',            tag: 'to_shade' },
        { id: 'how',      label: 'איך משתמשים בדיוק',           next: 'proof_how',              tag: 'to_how' },
        { id: 'question', label: 'יש לי עוד שאלה',              next: 'problem',                tag: 'loop' }
      ]
    },

    price_bundle_confirmed: {
      id: 'price_bundle_confirmed',
      type: 'card',
      messages: [
        'מעולה. לפי מה שאמרת, הייתי הולכת איתך על מארז 4 הבקבוקים, שהוא גם המארז הנמכר ביותר שלנו.',
        'ב־₪{{bundlePrice}} במקום ₪{{bundleWas}} את חוסכת ₪{{bundleSavingAmount}} ({{bundleSavingPercent}}), ומקבלת ערכת צביעה מלאה במתנה בשווי ₪{{freeKitValue}}.'
      ],
      protect: [1],
      card: { kind: 'bundle' },
      options: [
        { id: 'to_buy',     label: 'לבחירת הגוון ולהזמנה', next: 'offer',   tag: 'bundle_cta' },
        { id: 'another_q',  label: 'יש לי עוד שאלה',          next: 'problem', tag: 'loop' }
      ]
    },

    price_bundle: {
      id: 'price_bundle',
      type: 'card',
      messages: [
        'אם מה שחשוב לך הוא כמה זה עולה בסוף, מארז 4 הבקבוקים הוא הבחירה שהייתי מציעה לך.',
        '4 בקבוקים ב־₪{{bundlePrice}} במקום ₪{{bundleWas}}: חיסכון של ₪{{bundleSavingAmount}} ({{bundleSavingPercent}}), ובנוסף ערכת צביעה מלאה במתנה בשווי ₪{{freeKitValue}}.'
      ],
      protect: [1],
      card: { kind: 'bundle' },
      options: [
        { id: 'to_buy',     label: 'כן, לבחירת גוון וחבילה', next: 'offer', tag: 'bundle_cta' },
        { id: 'not_yet',    label: 'עוד לא',        next: 'graceful', tag: 'hesitant' }
      ]
    },

    /* ============================================================== *
     * Proof. Each one states an honest limit out loud (§19 Pattern E).
     * ============================================================== */
    proof_roots: {
      id: 'proof_roots',
      type: 'card',
      messages: [
        'שמפו הצבע שלנו בנוי לצביעת שורשים בבית, לתקופה שבין הצבע המלא לתור הבא.',
        'זה לא מחליף צבע מלא במספרה, וזה גם לא מנסה.'
      ],
      /* The honest limit is never trimmed away for brevity. */
      protect: [1],
      options: [
        { id: 'shade_help', label: 'עזרי לי לבחור גוון', next: 'shade_photo', tag: 'to_shade' },
        { id: 'how',        label: 'איך משתמשים',        next: 'proof_how',   tag: 'to_how' },
        { id: 'to_buy',     label: 'לבחירת גוון וחבילה', next: 'offer',       tag: 'buy_cta' }
      ]
    },

    proof_how: {
      id: 'proof_how',
      type: 'card',
      /* The page is explicit: no mixing, no bowls, no brushes. It is used in
       * the shower like a shampoo. Earlier copy here implied a brush-and-bowl
       * routine, which contradicted the FAQ. */
      messages: ['בלי לערבב, בלי מברשות. זה עובד במקלחת כמו שמפו.'],
      card: { kind: 'how' },
      options: [
        { id: 'shade_help', label: 'עזרי לי לבחור גוון',  next: 'shade_photo', tag: 'to_shade' },
        { id: 'to_buy',     label: 'הבנתי, לבחירת גוון וחבילה', next: 'offer',       tag: 'buy_cta' }
      ]
    },

    /* ============================================================== *
     * OFFER GATE. A coupon is a lever for a price objection, not a default.
     * `type: route` hands the decision to offerDecision() in the runtime:
     *   - she is convinced and ready  -> close_ready   (NO coupon, just buy)
     *   - not clearly ready           -> offer_guide   (value capture, NO coupon)
     * The coupon itself lives on the graceful path, as a last-ditch save for a
     * price-hesitant shopper who is about to leave. That is the only place a
     * discount is worth its cost.
     * ============================================================== */
    offer: { id: 'offer', type: 'route', resolve: 'offer' },

    /* She is convinced. Do not spend a discount. Remove friction and send her
     * to buy, with a warm one-liner. */
    close_ready: {
      id: 'close_ready',
      type: 'end',
      messages: ['{{greetName}}מעולה. אני מחזירה אותך לבחירת הגוון והחבילה.'],
      redirect: '#buy'
    },

    /* Not clearly ready. Capture the lead with a genuine value item, the shade
     * guide, and NO discount. */
    offer_guide: {
      id: 'offer_guide',
      type: 'ask',
      messages: ['{{greetName}}אני יכולה לשלוח לך את מדריך התאמת הגוון, בלי התחייבות.'],
      options: [
        { id: 'yes',  label: 'כן, שלחי לי',          next: 'capture',         tag: 'wants_guide' },
        { id: 'skip', label: 'לא צריך, אני ממשיכה',  next: 'exit_to_buy', tag: 'declines_guide' }
      ]
    },

    /* The coupon. Reached only from the graceful save, for a price objection. */
    offer_coupon: {
      id: 'offer_coupon',
      type: 'ask',
      messages: [
        '{{greetName}}אם המחיר הוא מה שעוצר, יש לי דבר אחד שיכול לעזור.',
        'אני יכולה להשאיר לך קוד להזמנה ראשונה.'
      ],
      options: [
        { id: 'yes',  label: 'כן, אשמח לקוד',        next: 'capture_coupon',  tag: 'wants_coupon' },
        { id: 'skip', label: 'לא צריך, תודה',        next: 'graceful_bye',    tag: 'declines_coupon' }
      ]
    },

    /* Guide capture (no code revealed). */
    capture: {
      id: 'capture',
      type: 'capture',
      messages: ['לאן לשלוח?'],
      emailLabel: 'אימייל',
      phoneLabel: 'טלפון, אם נוח לך בוואטסאפ',
      phoneOptional: true,
      consentLabel: 'אפשר לשלוח לי עדכונים והטבות',
      submitLabel: 'שלחי לי',
      skipLabel: 'דלגי, אני רק רוצה להמשיך',
      skipNext: 'exit_to_buy',
      next: 'thanks'
    },

    /* Coupon capture, then reveal the code. */
    capture_coupon: {
      id: 'capture_coupon',
      type: 'capture',
      messages: ['לאן לשלוח את הקוד?'],
      emailLabel: 'אימייל',
      phoneLabel: 'טלפון, אם נוח לך בוואטסאפ',
      phoneOptional: true,
      consentLabel: 'אפשר לשלוח לי עדכונים והטבות',
      submitLabel: 'שלחי לי את הקוד',
      skipLabel: 'דלגי',
      skipNext: 'exit_to_buy',
      next: 'coupon_reveal'
    },

    coupon_reveal: {
      id: 'coupon_reveal',
      type: 'coupon',
      messages: ['הקוד שלך מוכן. הוא מתווסף אוטומטית בקופה.'],
      next: 'close'
    },

    thanks: {
      id: 'thanks',
      type: 'end',
      messages: ['נשלח. {{greetName}}אם תרצי, אני כאן לכל שאלה.'],
      options: [
        { id: 'to_buy', label: 'חזרה לבחירת גוון וחבילה', next: 'exit_to_buy', tag: 'post_capture_buy' },
        { id: 'close',      label: 'תודה, סיימתי',   next: 'close',           tag: 'done' }
      ]
    },

    /* VIP lane entry. Logged-in, loyal. Warm, known, priority. No first-order
     * code. Name is prefilled from the Liquid shopper object. */
    vip_welcome: {
      id: 'vip_welcome',
      type: 'ask',
      messages: [
        '{{greetName}}טוב לראות אותך שוב. אני כאן כדי לקצר לך את הדרך.',
        'במה הכי כדאי שאעזור עכשיו?'
      ],
      options: [
        { id: 'reorder', label: 'להזמין שוב את מה שאהבתי', next: 'exit_to_buy', tag: 'repeat_same' },
        { id: 'change',  label: 'לשנות גוון הפעם',         next: 'shade_photo',     tag: 'repeat_change' },
        { id: 'ask',     label: 'יש לי שאלה',              next: 'problem',         tag: 'vip_q' },
        { id: 'issue',   label: 'משהו בהזמנה שלי',         next: 'escalate',        tag: 'repeat_issue' }
      ]
    },

    /* Service lane entry, when the router opens straight into service (rare,
     * since mid-flow complaints route directly to escalate). Ask, then route. */
    service_entry: {
      id: 'service_entry',
      type: 'ask',
      messages: ['{{greetName}}נשמע שזה עניין של שירות. במה מדובר?'],
      options: [
        { id: 'order',   label: 'בעיה עם הזמנה או משלוח', next: 'escalate',       tag: 'svc_order' },
        { id: 'health',  label: 'שאלה על רגישות או בריאות', next: 'refuse_medical', tag: 'svc_health' },
        { id: 'other',   label: 'משהו אחר',                next: 'escalate',       tag: 'svc_other' }
      ]
    },

    /* Returning customer. Warmth comes from HER stated name plus a coarse
     * "it has been a while" flag. We never echo back data from Shopify. */
    welcome_back: {
      id: 'welcome_back',
      type: 'ask',
      messages: [
        '{{greetName}}נראה לי שכבר הזמנת מאיתנו בעבר, ועבר מאז זמן.',
        'אם את חוזרת על אותו גוון, זה לוקח שנייה. ואם בא לך לשנות, אני אעזור.'
      ],
      options: [
        { id: 'same',  label: 'אותו גוון כמו קודם', next: 'exit_to_buy', tag: 'repeat_same' },
        { id: 'change',label: 'רוצה לשנות גוון',    next: 'shade_photo',     tag: 'repeat_change' },
        { id: 'issue', label: 'יש לי בעיה עם הזמנה', next: 'escalate',       tag: 'repeat_issue' }
      ]
    },

    /* ============================================================== *
     * Escalation. Existing customers with a problem must never be sold
     * to. Route them to a human and stop.
     * ============================================================== */
    escalate: {
      id: 'escalate',
      type: 'end',
      messages: [
        'זה משהו שאני לא רוצה לפתור בצ׳אט, כדי שלא ייפול בין הכיסאות.',
        'הכי מהיר זה דרך הטופס, ומישהי מהצוות חוזרת אלייך.'
      ],
      options: [
        { id: 'to_form',  label: 'קחי אותי לטופס הפנייה', next: 'exit_to_support', tag: 'escalated' },
        { id: 'close',    label: 'אטפל בזה אחר כך',       next: 'close',           tag: 'escalate_declined' }
      ]
    },

    /* Medical / safety questions. Refuse cleanly, do not improvise. */
    refuse_medical: {
      id: 'refuse_medical',
      type: 'end',
      messages: [
        'זה לא משהו שנכון שאני אענה עליו.',
        'לשאלות של רגישות, הריון או מצב רפואי כדאי להתייעץ עם איש מקצוע, ואפשר גם לפנות אלינו ישירות.'
      ],
      options: [
        { id: 'to_form', label: 'קחי אותי לטופס הפנייה', next: 'exit_to_support', tag: 'medical_escalated' },
        { id: 'close',   label: 'הבנתי, תודה',           next: 'close',           tag: 'medical_closed' }
      ]
    },

    /* GRACEFUL SAVE. She is about to leave. This is the one moment a coupon
     * earns its cost, and only for a price objection. offerDecision('graceful')
     * routes a price-hesitant shopper to offer_coupon and everyone else to the
     * plain, no-discount goodbye. */
    graceful: { id: 'graceful', type: 'route', resolve: 'graceful' },

    graceful_bye: {
      id: 'graceful_bye',
      type: 'end',
      messages: ['אין לחץ. אם תחזרי, אני עדיין כאן ואעזור לך לבחור נכון.'],
      options: [
        { id: 'send_guide', label: 'שלחי לי את המדריך', next: 'capture', tag: 'soft_capture' },
        { id: 'close',      label: 'סוגרת לעכשיו',      next: 'close',   tag: 'graceful_exit' }
      ]
    },

    exit_to_buy:     { id: 'exit_to_buy',     type: 'end', redirect: '#buy',          messages: ['מעבירה אותך לבחירת הגוון והחבילה.'] },
    exit_to_support: { id: 'exit_to_support', type: 'end', redirect: '/pages/contact',                 messages: ['מעבירה אותך לטופס.'] },
    close:           { id: 'close',           type: 'end', messages: [] }
  },

  /* Shade names, hexes and images are the approved product truth. They are
   * read from NovaHairFacts so the chat can never drift from the sales page.
   * The earlier names ("בורדו", "אדום נחושת") were wrong: the page sells
   * "סגול חציל" and "אדום יין". */
  shades: (window.NovaHairFacts ? window.NovaHairFacts.shades : []).map(function (s) {
    return {
      key: s.key, label: s.label, img: s.img,
      hex: { black: '#131313', dark_brown: '#271F19', light_brown: '#6D5442',
             eggplant: '#281541', wine_red: '#210808' }[s.key],
      /* Dark-cluster centroids measured from the approved shade photography.
       * These are classifier references, not display colours. */
      matchRgb: {
        black: [13, 13, 13], dark_brown: [27, 20, 16], light_brown: [74, 55, 39],
        eggplant: [16, 11, 23], wine_red: [32, 5, 5]
      }[s.key]
    };
  }),

  shadeMap: {
    black: 'black', dark_brown: 'dark_brown', light_brown: 'light_brown',
    eggplant: 'eggplant', wine_red: 'wine_red',
    /* Page rule: torn between two, go lighter. So "cool" resolves to the
     * lighter of the cool options, not the darkest one. */
    cool: 'dark_brown', warm: 'light_brown'
  }
};
