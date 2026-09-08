const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const AI_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(AI_ROOT, '..', '..');
const OUTPUT = path.join(AI_ROOT, 'AI-FLOW-COPY-REVIEW.md');
const FILES = {
  facts: path.join(AI_ROOT, 'assets', 'novahair-ai-facts.js'),
  flows: path.join(AI_ROOT, 'assets', 'novahair-ai-flows.js'),
  agents: path.join(AI_ROOT, 'assets', 'novahair-ai-agents.js'),
  popup: path.join(AI_ROOT, 'assets', 'novahair-ai-popup.js'),
  engineConfig: path.join(REPO_ROOT, 'popup-engine', 'assets', 'novahair-popup-engine.config.js'),
  route: path.join(REPO_ROOT, 'app', 'cloudflare-pilot', 'src', 'routes', 'ai-concierge.ts'),
  approvedFacts: path.join(REPO_ROOT, 'app', 'cloudflare-pilot', 'src', 'lib', 'ai-approved-facts.ts'),
};

const context = { window: {} };
vm.createContext(context);
for (const key of ['facts', 'flows', 'agents']) {
  vm.runInContext(fs.readFileSync(FILES[key], 'utf8'), context, { filename: FILES[key] });
}

const FACTS = context.window.NovaHairFacts;
const FLOW = context.window.NovaHairAIFlows;
const AGENTS = context.window.NovaHairAIAgents;
const popupSource = fs.readFileSync(FILES.popup, 'utf8');
const routeSource = fs.readFileSync(FILES.route, 'utf8');
const approvedFactsSource = fs.readFileSync(FILES.approvedFacts, 'utf8');
const engineConfigSource = fs.readFileSync(FILES.engineConfig, 'utf8');

const configContext = { window: {} };
vm.createContext(configContext);
vm.runInContext(
  engineConfigSource.split('/* Load only the whitelisted tuning surface')[0],
  configContext,
  { filename: FILES.engineConfig },
);
const CONFIG = configContext.window.NovaHairPopupConfig;

const allowedBlock = routeSource.match(/const ALLOWED_NEXT = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
const allowedNodes = Array.from(
  allowedBlock.replace(/\/\/.*$/gm, '').matchAll(/"([a-z0-9_]+)"/g),
  match => match[1],
);
const rawSystemPrompt = routeSource.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1] || '';
const systemPrompt = rawSystemPrompt.replace(
  '${Array.from(ALLOWED_NEXT).join(", ")}',
  allowedNodes.join(', '),
);

const approvedReplies = Array.from(
  approvedFactsSource.matchAll(/reply:\s*"((?:[^"\\]|\\.)*)",\s*\r?\n\s*next:\s*"([a-z0-9_]+)"/g),
  match => ({ reply: JSON.parse(`"${match[1]}"`), next: match[2] }),
);

const fixedReplyTopics = [
  'משלוח, אספקה או זמן הגעה',
  'אחריות, החזר כספי או החלפת גוון',
  'מספר שימושים לבקבוק',
  'מחיר או מחירי המארזים',
  'למה נשים או לקוחות עוברות למוצר, ולמה כדאי',
  'סניף, כתובת פיזית או איסוף עצמי',
];

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
}

function clean(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function quote(lines) {
  if (!lines || !lines.length) return '_אין טקסט מוצג בשלב הזה._';
  return lines.map(line => `> ${line}`).join('\n>\n');
}

function outcomeLabel(redirect) {
  if (redirect === '#buy') return 'אזור בחירת גוון וחבילה בעמוד (`#buy`)';
  if (redirect === '/pages/contact') return 'טופס שירות (`/pages/contact`)';
  return `ניווט אל \`${redirect}\``;
}

function outgoing(nodeId) {
  const node = FLOW.nodes[nodeId];
  if (!node) return [];
  if (node.type === 'route' && node.resolve === 'offer') return ['close_ready', 'offer_guide'];
  if (node.type === 'route' && node.resolve === 'graceful') return ['offer_coupon', 'graceful_bye'];
  const targets = (node.options || []).map(option => option.next);
  if (node.skipNext) targets.push(node.skipNext);
  if (node.next && node.type !== 'coupon') targets.push(node.next);
  return targets;
}

function outcomes(nodeId, visiting = new Set()) {
  const node = FLOW.nodes[nodeId];
  if (!node) return new Set([`יעד חסר: ${nodeId}`]);
  if (node.type === 'coupon') {
    return new Set([`החלת ${FLOW.coupon.code} וחזרה לעמוד המכירה`]);
  }
  if (node.redirect) return new Set([outcomeLabel(node.redirect)]);
  if (nodeId === 'close') return new Set(['סגירת הפופאפ ללא ניווט']);
  if (visiting.has(nodeId)) return new Set(['לולאה לשלב קודם']);
  const targets = outgoing(nodeId);
  if (!targets.length) return new Set(['סגירת הפופאפ']);
  const nextVisiting = new Set(visiting);
  nextVisiting.add(nodeId);
  const result = new Set();
  for (const target of targets) {
    for (const value of outcomes(target, nextVisiting)) result.add(value);
  }
  return result;
}

function cardCopy(kind) {
  const b4 = FACTS.bundles.find(bundle => bundle.key === FACTS.recommendedBundle);
  if (kind === 'shades') {
    return [
      'כותרת: "הגוונים שלנו"',
      ...FACTS.shades.map(shade => `גוון: "${shade.label}"`),
    ];
  }
  if (kind === 'cost') {
    return [
      'כותרת: "איך זה נראה במספרים"',
      `"מארז 4 בקבוקים" | "₪${b4.price}"`,
      `"לבקבוק" | "₪${b4.perBottle}"`,
      `"שימושים בבקבוק" | "עד ${FACTS.usesPerBottle}"`,
      `"לטיפול שורשים" | "₪${FACTS.costPerTreatment()}"`,
    ];
  }
  if (kind === 'bundle') {
    return [
      `כותרת: "מארז ${b4.bottles} בקבוקים · ₪${b4.price}"`,
      `"במקום" | "₪${b4.was}"`,
      `"חיסכון" | "₪${b4.was - b4.price} · ${b4.saving}"`,
      `"ערכת צביעה מלאה" | "מתנה · שווי ₪${FACTS.offer.freeKitValue}"`,
      `"אחריות" | "${FACTS.offer.guaranteeDays} יום"`,
    ];
  }
  if (kind === 'how') {
    return [
      'כותרת: "שלושה שלבים"',
      ...FACTS.howToUse.map((step, index) => `"${index + 1}. ${step}"`),
    ];
  }
  return [];
}

const nodeTitles = {
  root_choice: 'תפריט אחרי תשובה חופשית',
  audience_choice: 'בחירת מסלול: מתעניינת או לקוחה חוזרת',
  situation: 'המצב היום',
  problem: 'הבעיה המרכזית',
  capture_roots: 'אימייל אחרי בעיית שורשים',
  capture_hassle: 'אימייל אחרי טרחת תורים',
  capture_shade: 'אימייל אחרי חשש מגוון',
  capture_price: 'אימייל אחרי שאלת מחיר',
  capture_natural: 'אימייל אחרי חשש מתוצאה לא טבעית',
  capture_free_text: 'אימייל אחרי תשובה חופשית',
  implication: 'המחיר הרגשי של המצב',
  need_payoff: 'מה היא רוצה לפתור',
  shade_open: 'פתיחת התאמת גוון',
  shade_photo: 'צילום או העלאת תמונה',
  shade_manual: 'בחירת גוון ידנית',
  shade_narrow: 'צמצום בחירת הגוון',
  shade_result: 'המלצת גוון',
  price_open: 'פתיחת התנגדות מחיר',
  price_compare: 'השוואת עלויות',
  why_switch: 'למה נשים עוברות לזה',
  price_bundle_confirmed: 'הצעה לאחר הסכמה',
  price_bundle: 'תשובת מחיר ישירה',
  proof_roots: 'הגדרת המוצר והגבול שלו',
  proof_how: 'הוראות שימוש',
  offer: 'שער החלטה להצעה',
  close_ready: 'לקוחה מוכנה לקנייה',
  offer_guide: 'הצעת מדריך גוון',
  offer_coupon: 'הצעת קופון',
  capture: 'לכידת ליד למדריך',
  capture_coupon: 'לכידת ליד לקופון',
  returning_menu: 'תפריט לקוחה חוזרת',
  returning_identity: 'זיהוי לקוחה חוזרת במייל',
  returning_found: 'הזמנה קודמת נמצאה',
  coupon_reveal: 'חשיפת קופון',
  thanks: 'תודה לאחר שליחת מדריך',
  vip_welcome: 'כניסת VIP',
  service_entry: 'כניסת שירות',
  welcome_back: 'כניסת לקוחה חוזרת',
  escalate: 'העברה לשירות',
  refuse_medical: 'סירוב לשאלה רפואית',
  graceful: 'שער יציאה רכה',
  graceful_bye: 'פרידה ללא קופון',
  exit_to_buy: 'יציאה לאזור הקנייה',
  exit_to_support: 'יציאה לשירות',
  close: 'סגירה',
};

function renderNode(nodeId, node, index) {
  const lines = [];
  lines.push(`### ${index + 1}. \`${nodeId}\`: ${nodeTitles[nodeId] || nodeId}`);
  lines.push(`- **סוג:** \`${node.type}\``);
  lines.push(`- **תוצאות סופיות אפשריות:** ${Array.from(outcomes(nodeId)).join(' / ')}`);
  lines.push('');
  lines.push('**הטקסט שמוצג**');
  lines.push('');
  lines.push(quote(node.messages || []));

  if (node.card) {
    lines.push('');
    lines.push(`**כרטיס \`${node.card.kind}\` שמופיע מתחת לטקסט**`);
    lines.push('');
    for (const item of cardCopy(node.card.kind)) lines.push(`- ${item}`);
  }

  if (node.allowFree) {
    lines.push('');
    lines.push(`- **שאלה חופשית:** placeholder \`${node.freePlaceholder}\`; עוברת קודם למסנני בטיחות, אחר כך לתשובה קבועה או ל־AI.`);
  }

  if (node.type === 'photo') {
    lines.push('');
    lines.push('- **כפתור צילום:** "צלמי את השורשים או בחרי תמונה".');
    lines.push(`- **דילוג:** "${node.skipLabel}" -> \`${node.skipNext}\`.`);
    lines.push(`- **זיהוי אמין:** -> \`${node.next}\` עם אחד מחמשת הגוונים.`);
    lines.push(`- **זיהוי לא ודאי:** "לא הצלחתי לזהות את אזור השורשים בוודאות מהתמונה הזאת. בואי נבחר יחד." -> \`${node.skipNext}\`.`);
    lines.push('- **תמונה לא קריאה:** "לא הצלחתי לקרוא את התמונה. נסי אחרת או בחרי ידנית."');
  }

  if (node.type === 'capture') {
    lines.push('');
    lines.push(`- **אימייל:** "${node.emailLabel}" (חובה).`);
    lines.push('- **הסכמה שיווקית אופציונלית:** "אני רוצה לקבל גם טיפים, עדכונים והטבות מ־NovaHair במייל."');
    lines.push('- **ללא סימון:** הלקוחה נשמרת ב־Shopify Customer, והסכמת השיווק הקיימת אינה משתנה.');
    lines.push(`- **שליחה:** "${node.submitLabel}" -> \`${node.next}\`.`);
    lines.push(`- **דילוג:** "${node.skipLabel}" -> \`${node.skipNext}\`.`);
    lines.push('- **שגיאה:** "לא הצלחנו לאשר את השמירה כרגע. נסי שוב."');
  }

  if (node.type === 'identify') {
    lines.push('');
    lines.push(`- **אימייל לזיהוי:** "${node.emailLabel}" (חובה).`);
    lines.push(`- **שליחה:** "${node.submitLabel}" -> נשלח קוד חד־פעמי בן 6 ספרות למייל.`);
    lines.push('- **אימות:** placeholder "קוד אימות", כפתור "אמתִי"; הקוד תקף ל־10 דקות ולעד 5 ניסיונות.');
    lines.push('- **אין תיבת הסכמה שיווקית והסכמת השיווק אינה משתנה.**');
    lines.push(`- **דילוג:** "${node.skipLabel}" -> \`${node.skipNext}\`.`);
  }

  if (node.type === 'coupon') {
    lines.push('');
    lines.push(`- **כרטיס:** "הקוד שלך" + \`${FLOW.coupon.code}\`.`);
    lines.push(`- **כפתור:** "להזמנה עם הקוד" -> \`${FLOW.coupon.applyPath}\`.`);
  }

  if (node.type === 'route') {
    lines.push('');
    if (node.resolve === 'offer') {
      lines.push('- **תנאי:** תג מוכנות (`shade_cta`, `bundle_cta`, `buy_cta`, `repeat_same`) -> `close_ready`; אחרת -> `offer_guide`.');
    } else {
      lines.push('- **תנאי:** התנגדות מחיר + מסלול שמותר לו קופון -> `offer_coupon`; אחרת -> `graceful_bye`.');
    }
  }

  if ((node.options || []).length) {
    lines.push('');
    lines.push('**כל האפשרויות**');
    lines.push('');
    for (const option of node.options) {
      const final = Array.from(outcomes(option.next)).join(' / ');
      lines.push(`- "${option.label}" -> \`${option.next}\` (תג: \`${option.tag || 'ללא'}\`) -> ${final}`);
    }
  } else if (node.redirect) {
    lines.push('');
    lines.push(`- **מעבר אוטומטי:** \`${node.redirect}\` -> ${outcomeLabel(node.redirect)}.`);
  } else if (node.next && node.type !== 'photo' && node.type !== 'capture' && node.type !== 'coupon') {
    lines.push('');
    lines.push(`- **מעבר אוטומטי:** \`${node.next}\`.`);
  }

  return lines.join('\n');
}

const b4 = FACTS.bundles.find(bundle => bundle.key === FACTS.recommendedBundle);
const lines = [];
lines.push('# NovaHair AI Concierge: כל הזרימות וכל הקופי');
lines.push('');
lines.push(`נוצר אוטומטית מקוד המקור הפעיל בתאריך 2026-09-06. גרסת flow: \`${FLOW.version}\`.`);
lines.push('');
lines.push(`מקורות: \`flows ${sha(FILES.flows)}\`, \`popup ${sha(FILES.popup)}\`, \`facts ${sha(FILES.facts)}\`, \`agents ${sha(FILES.agents)}\`.`);
lines.push('');
lines.push('## איך לערוך את המסמך');
lines.push('');
lines.push('- כדי לבקש שינוי, מספיק לציין את מזהה השלב, למשל: `why_switch`, ואת המשפט או הכפתור החדש.');
lines.push('- טקסט בתוך `{{...}}` הוא משתנה שמוחלף בזמן אמת.');
lines.push('- `{{greet}}` ו־`{{greetName}}` נשארים ריקים במסלול החדש; הפופאפ אינו שואל שם.');
lines.push('- `{{shade}}` = הגוון שנבחר; שאר משתני המחיר נפתחים כיום ל־₪239, ₪758, ₪519, 68%, ₪79 ו־₪1.99.');
lines.push('- תשובות כפתור הן קבועות לחלוטין. תשובות לשאלה חופשית עשויות להשתנות; כל העובדות והחוקים שמגבילים אותן מופיעים בהמשך.');
lines.push('');
lines.push('## סטטוס פריסה');
lines.push('');
lines.push('- המסמך מתאר את קוד ה־release הנוכחי. סטטוס לייב אינו מוסק מהקובץ ויש לאמת אותו מול hash התמה לאחר פריסה.');
lines.push('- יעד הפריסה הוא רק `/pages/novahair-sales-staging`, במיקום `exit_sales`.');
lines.push('- הוא אינו נטען באופן גלובלי ואינו פעיל בסל, בקופה, בחשבון, באתגר, בתודה או בהזמנות.');
lines.push('- ה־Worker מנהל את הטריגרים; הרשימה והספים מפורטים למטה.');
lines.push('');
lines.push('## תרשים על');
lines.push('');
lines.push('```text');
lines.push('התנהגות נטישה שעוברת את כל הספים');
lines.push('  -> פתיח קבוע -> audience_choice');
lines.push('     -> "אני עדיין בודקת": situation -> problem -> לכידת אימייל מותאמת לבעיה');
lines.push('     -> "כבר קניתי": returning_menu');
lines.push('          -> הזמנה חוזרת: זיהוי מאובטח במייל + OTP -> returning_found');
lines.push('          -> שאלה על הזמנה/מוצר: service_entry');
lines.push('');
lines.push('problem -> email capture');
lines.push('  -> שורשים / טרחה: capture_roots או capture_hassle -> implication -> need_payoff');
lines.push('  -> מחיר: capture_price -> price_bundle');
lines.push('  -> חשש גוון: capture_shade -> shade_open -> shade_photo או shade_manual -> shade_result');
lines.push('  -> חשש למראה טבעי: capture_natural -> proof_roots');
lines.push('  -> טקסט חופשי: משפט bridge אישי אחד מה־AI -> capture_free_text -> implication');
lines.push('');
lines.push('need_payoff');
lines.push('  -> זמן: proof_how');
lines.push('  -> כסף: price_open -> price_compare -> why_switch או price_bundle_confirmed');
lines.push('  -> שורש לבן / ספק: proof_roots');
lines.push('');
lines.push('כל CTA עם כוונת קנייה');
lines.push('  -> offer -> close_ready -> #buy');
lines.push('');
lines.push('יציאה מהססת');
lines.push('  -> graceful');
lines.push('     -> מחיר עוצר + לקוחה חדשה: offer_coupon -> capture_coupon -> NOVA10 -> עמוד המכירה');
lines.push('     -> אחרת: graceful_bye -> capture מדריך או סגירה');
lines.push('');
lines.push('טקסט חופשי');
lines.push('  -> מילת בטיחות רפואית: refuse_medical -> שירות או סגירה');
lines.push('  -> בעיית הזמנה / משלוח: escalate -> שירות או סגירה');
lines.push('  -> עובדה מסחרית מוכרת: תשובה קבועה -> root_choice');
lines.push('  -> אחרת: AI מוגבל -> אחד מיעדי השיחה המאושרים');
lines.push('```');
lines.push('');
lines.push('## טריגרים חיים');
lines.push('');
lines.push(`כל טריגר דורש לפחות ${CONFIG.gates.minTimeOnPage} שניות בעמוד, ${CONFIG.gates.minEngagedSeconds} שניות מעורבות, עומק גלילה ${Math.round(CONFIG.gates.minScrollDepth * 100)}%, ציון מעורבות ${CONFIG.gates.minEngagementScore}, וטאב גלוי.`);
lines.push('');
for (const trigger of CONFIG.triggers) {
  const descriptions = {
    return_to_top: `ירדה לפחות ל־${Math.round(CONFIG.abandon.returnToTop.deepAt * 100)}% וחזרה עד ${Math.round(CONFIG.abandon.returnToTop.backTo * 100)}%.`,
    fast_scroll_up: `גלילה מהירה למעלה של לפחות ${CONFIG.abandon.fastScrollUp.minVelocity}px לשנייה, עם השהיה של ${CONFIG.abandon.fastScrollUp.settleMs}ms.`,
    idle_after_price: `ראתה מחיר ולא פעלה במשך ${CONFIG.abandon.idleAfterPrice.idleSeconds} שניות.`,
    desktop_exit: 'בדסקטופ, הסמן יוצא מחלקו העליון של החלון.',
    bundle_hesitation: 'שהתה באזור המארזים בלי לבחור מארז.',
    engaged_drift: `מעורבות גבוהה אך התרחקות, עם ציון נטישה ${trigger.minAbandonScore} ומעורבות ${trigger.minEngagementScore}.`,
  };
  lines.push(`- \`${trigger.id}\`: ${descriptions[trigger.id]} פעיל: ${trigger.enabled ? 'כן' : 'לא'}.`);
}
lines.push('');
lines.push(`תדירות: עד ${CONFIG.frequency.maxImpressionsPerSession} בסשן, עד ${CONFIG.frequency.maxImpressionsPerVisitor} למבקרת, ו־${CONFIG.frequency.dismissCooldownDays} ימי צינון לאחר סגירה.`);
lines.push('');
lines.push('הפופאפ מדוכא אם כבר נוסף מוצר לסל, אם יש פריט בסל, אם הלקוחה בצ׳קאאוט, או אם ציון כוונת הקנייה מגיע ל־6.');
lines.push('');
lines.push('## סוגי לקוחות ונקודות פתיחה');
lines.push('');
lines.push('| מסלול | תנאי | שלב ראשון | קופון NOVA10 |');
lines.push('|---|---|---|---|');
lines.push('| מתעניינת | בוחרת "אני עדיין בודקת אם זה מתאים לי" | `situation` | אפשרי רק בהתנגדות מחיר בזמן יציאה |');
lines.push('| לקוחה חוזרת | בוחרת "כבר קניתי אצלכם" | `returning_menu` | לא |');
lines.push('| שירות | בוחרת שאלה על ההזמנה/המוצר | `service_entry` | לא |');
lines.push('');
lines.push('### הפתיח היחיד');
lines.push('');
for (const [angle, opener] of Object.entries(FLOW.openers)) lines.push(`- \`${angle}\`: "${opener}"`);
lines.push('');
lines.push('לא מופיע hook נוסף שמחליף או מוסיף מסר לפתיח הראשון.');
lines.push('');
lines.push(`## קטלוג מלא של כל ${Object.keys(FLOW.nodes).length} השלבים`);
lines.push('');
Object.entries(FLOW.nodes).forEach(([nodeId, node], index) => {
  lines.push(renderNode(nodeId, node, index));
  lines.push('');
});
lines.push('## תשובות לשאלות חופשיות');
lines.push('');
lines.push('שאלות חופשיות זמינות ב־`problem` וב־`root_choice`. אין שאלת שם.');
lines.push('ב־`problem`, ה־AI רשאי לכתוב רק משפט bridge אישי אחד, עד 18 מילים; אחריו מוצג טופס האימייל הקבוע.');
lines.push('');
lines.push('### מסנני בטיחות לפני AI');
lines.push('');
lines.push(`- מעבר ישיר ל־\`escalate\`: ${FLOW.escalationTriggers.map(value => `"${value}"`).join(', ')}.`);
lines.push(`- מעבר ישיר ל־\`refuse_medical\`: ${FLOW.refusalTriggers.map(value => `"${value}"`).join(', ')}.`);
lines.push('');
lines.push('### תשובות קבועות שאינן תלויות במודל');
lines.push('');
approvedReplies.forEach((item, index) => {
  lines.push(`- **${fixedReplyTopics[index] || `נושא ${index + 1}`}** -> "${item.reply}" -> \`${item.next}\`.`);
});
lines.push('');
lines.push('### ניתוב מקומי אם ה־AI אינו זמין');
lines.push('');
lines.push('- למה עוברות / יתרונות / למה כדאי -> `why_switch`.');
lines.push('- גוון / צבע / מתאים לי / בלונד / חום / שחור -> `shade_open`.');
lines.push('- יקר / מחיר / כסף / עלות / הנחה -> `price_open`.');
lines.push('- שורש / כיסוי / לבן / שיבה -> `proof_roots`.');
lines.push('- איך / שימוש / להשתמש / כמה זמן -> `proof_how`.');
lines.push('- אין התאמה -> "לא בטוחה שהבנתי נכון. בואי ננסה ככה." -> `root_choice`.');
lines.push('');
lines.push('### מה ה־AI רשאי לכתוב');
lines.push('');
lines.push('אין רשימה סופית של כל המשפטים שהמודל עשוי לנסח. זהו הפרומפט המלא שמגביל את התשובה:');
lines.push('');
lines.push('```text');
lines.push(systemPrompt);
lines.push('```');
lines.push('');
lines.push('במסלול email bridge חל פרומפט נפרד: משפט עברי טבעי אחד בלבד, עד 18 מילים, ללא הנחה, טענה חדשה, שאלה או אזכור אימייל. לאחריו הקופי הקבוע אינו נכתב מחדש בידי המודל.');
lines.push('');
lines.push(`יעדי AI מורשים: ${allowedNodes.map(value => `\`${value}\``).join(', ')}.`);
lines.push('');
lines.push('כל תשובת AI עוברת ניקוי: עד שני משפטים ועד 300 תווים, ללא HTML, אימוג׳ים או מקפים ארוכים. יעד לא קיים נדחה ונבחר נתיב מקומי תקין.');
lines.push('');
lines.push('## קופי ממשק שאינו שייך לצומת יחיד');
lines.push('');
lines.push(`- כותרת: "${FLOW.advisor.name}".`);
lines.push(`- תפקיד: "${FLOW.advisor.role}".`);
lines.push('- תווית סגירה נגישה: "סגירה".');
lines.push('- כפתור טקסט חופשי: "שלחי".');
lines.push('- בזמן שמירת ליד: "שומרת...".');
lines.push('- תיבת הסכמה אופציונלית: "אני רוצה לקבל גם טיפים, עדכונים והטבות מ־NovaHair במייל."');
lines.push('- זיהוי לקוחה חוזרת: "שולחת קוד...", "קוד אימות", "אמתִי", "בודקת...".');
lines.push('- צילום: "בודקת כיוון ראשוני לגוון".');
lines.push('- צילום: "התמונה נבדקת במכשיר שלך ולא נשלחת. התוצאה היא כיוון ראשוני בלבד."');
lines.push('- שגיאת ליד: "לא הצלחנו לאשר את השמירה כרגע. נסי שוב."');
lines.push('');
lines.push('## אמת מוצרית שממנה נבנה הקופי');
lines.push('');
lines.push(`- גוונים: ${FACTS.shades.map(shade => shade.label).join(', ')}.`);
lines.push(`- מארזים: ${FACTS.bundles.map(bundle => `${bundle.bottles} בקבוקים, ₪${bundle.price}, במקום ₪${bundle.was}, חיסכון ${bundle.saving}`).join('; ')}.`);
lines.push(`- המארז המוביל: ${b4.bottles} בקבוקים ב־₪${b4.price}.`);
lines.push(`- ערכת צביעה במתנה בשווי ₪${FACTS.offer.freeKitValue}; משלוח חינם מעל ₪${FACTS.offer.freeShippingOver}; ${FACTS.offer.guaranteeDays} ימי אחריות; משלוח ${FACTS.offer.shippingDays}.`);
lines.push(`- עד ${FACTS.usesPerBottle} שימושים לבקבוק; עלות מחושבת במארז 4: ₪${FACTS.costPerTreatment()} לטיפול שורשים.`);
lines.push(`- טענות: ללא אמוניה; pH ${FACTS.claims.ph}; ${FACTS.claims.safeOnTreated}; חידוש ${FACTS.claims.refreshEvery}.`);
lines.push('');
lines.push('### תשובות FAQ שנמצאות בקובץ העובדות אך אינן מוצגות או מוזנות למודל כיום');
lines.push('');
for (const [key, value] of Object.entries(FACTS.faq)) lines.push(`- \`${key}\`: "${value}"`);
lines.push('');
lines.push('## חלקים קיימים אך לא נגישים כיום');
lines.push('');
lines.push('- `service_entry` נגיש מתפריט הלקוחה החוזרת; שאלות שירות ורפואה בטקסט חופשי עוברות ישירות ל־`escalate` או `refuse_medical`.');
lines.push('- `vip_welcome` ו־`welcome_back` נשארו לצורכי תאימות אך אינם נקודות פתיחה; כל לקוחה מתחילה ב־`audience_choice`.');
lines.push('- `offer_guide` אינו נגיש דרך כפתורי המכירה הסקריפטיים, כי כל כפתור שמגיע ל־`offer` מוסיף תג מוכנות וממשיך ל־`#buy`. הוא עדיין יכול להיבחר אחרי תשובת AI שמנתבת ל־`offer` בלי תג מוכנות.');
lines.push('- renderer ישן של כרטיס `roots` אינו בשימוש באף צומת ולכן הטקסט הישן אינו יכול להופיע ללקוחה.');
lines.push('- אובייקט `faq` המפורט למעלה הוא מאגר לא פעיל כרגע; ה־Worker מכיר רק את העובדות שמופיעות בפרומפט ובתשובות הקבועות.');

const document = `${lines.join('\n').trim()}\n`;
const requiredCopy = [
  FLOW.advisor.name,
  FLOW.advisor.role,
  FLOW.hook,
  ...Object.values(FLOW.openers),
  ...approvedReplies.map(item => item.reply),
];
for (const [nodeId, node] of Object.entries(FLOW.nodes)) {
  if (!document.includes(`\`${nodeId}\``)) throw new Error(`Missing node from review: ${nodeId}`);
  requiredCopy.push(...(node.messages || []));
  requiredCopy.push(...(node.options || []).map(option => option.label));
  for (const key of ['freePlaceholder', 'skipLabel', 'emailLabel', 'phoneLabel', 'consentLabel', 'submitLabel']) {
    if (node[key]) requiredCopy.push(node[key]);
  }
}
const missingCopy = Array.from(new Set(requiredCopy.filter(value => value && !document.includes(value))));
if (missingCopy.length) throw new Error(`Missing copy from review: ${missingCopy.join(' | ')}`);

fs.writeFileSync(OUTPUT, document, 'utf8');
console.log(`WROTE ${OUTPUT}`);
console.log(`NODES ${Object.keys(FLOW.nodes).length}`);
console.log(`COPY_STRINGS ${new Set(requiredCopy).size}`);
