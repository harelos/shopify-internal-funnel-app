/**
 * NovaHair - approved product truth.
 *
 * Single source of fact for the concierge. Every number, shade name and claim
 * here was read off the live sales page on 2026-09-02:
 *   https://tigerbrandsglobal.com/pages/novahair-sales-staging
 *
 * RULE: the assistant may only state facts that appear in this file. If a
 * shopper asks something not covered, it says it does not know and offers a
 * human. Nothing here may be edited to something the page does not say.
 *
 * When the sales page changes, THIS FILE CHANGES FIRST, then the copy.
 */
window.NovaHairFacts = {
  sourceUrl: 'https://tigerbrandsglobal.com/pages/novahair-sales-staging',
  verifiedOn: '2026-09-02',

  shades: [
    { key: 'black',       label: 'שחור טבעי', img: 'img/shade-black.png',       tone: 'cool' },
    { key: 'dark_brown',  label: 'חום כהה',   img: 'img/shade-dark_brown.png',  tone: 'cool' },
    { key: 'light_brown', label: 'חום בהיר',  img: 'img/shade-light_brown.png', tone: 'warm' },
    { key: 'eggplant',    label: 'סגול חציל', img: 'img/shade-eggplant.png',    tone: 'cool' },
    { key: 'wine_red',    label: 'אדום יין',  img: 'img/shade-wine_red.png',    tone: 'warm' }
  ],

  bundles: [
    { key: 'b2', bottles: 2, price: 189, perBottle: 94.50, was: 379,   saving: '50%' },
    { key: 'b4', bottles: 4, price: 239, perBottle: 59.75, was: 758,   saving: '68%', bestSeller: true },
    { key: 'b6', bottles: 6, price: 319, perBottle: 53.20, was: 1137,  saving: '72%' }
  ],
  /* The 4-pack is the one we lead with. */
  recommendedBundle: 'b4',

  offer: {
    freeKitValue: 79,          // מסרק · קערה · מברשות וקליפסים
    bundleBenefitsValue: 117,
    freeShippingOver: 199,
    guaranteeDays: 60,
    shippingDays: '5 עד 12 ימי עסקים'
  },

  usesPerBottle: 30,

  /* Derived, not invented: 4 bottles x 30 uses = 120 treatments for ₪239. */
  costPerTreatment: function () {
    var b = this.bundles.filter(function (x) { return x.key === 'b4'; })[0];
    return (b.price / (b.bottles * this.usesPerBottle)).toFixed(2);
  },

  rating: { score: '4.8', count: '9,232' },

  /* How it is actually used. The page is explicit that there is no mixing,
   * no bowls and no brushes: it is applied in the shower like a shampoo. */
  howToUse: [
    'לוחצת על המשאבה ומורחת ישירות על שיער לח במקלחת, כמו שמפו',
    'ממתינה 10 עד 15 דקות',
    'שוטפת במים'
  ],

  claims: {
    noAmmonia: true,
    ph: '5.5',
    tech: 'Micro-Color Sphere™',
    safeOnTreated: 'בטוח לשימוש על שיער צבוע, מובהר או מוחלק',
    refreshEvery: 'אחת לשבועיים עד שלושה, לפי קצב הצמיחה'
  },

  /* Verbatim answers from the page FAQ, trimmed for chat length.
   * Keys are the shopper's likely phrasing, not internal jargon. */
  faq: {
    white_hair:  'כן. הפורמולה פותחה לכיסוי שיבה ושורשים לבנים, והמיקרו-פיגמנטים נצמדים למעטפת השערה.',
    how_long:    'הכיסוי מחזיק לאורך שבועות ועמיד בחפיפות. מומלץ לחדש אחת לשבועיים עד שלושה, לפי קצב הצמיחה שלך.',
    treated_hair:'בטוח לשימוש על שיער צבוע, מובהר או מוחלק. אין אמוניה, וזה לא פוגע בהחלקה.',
    stains:      'נשטף במים וסבון ממשטחים ומהעור אם שוטפים מיד. כדאי כפפות ולהימנע ממגבות בהירות עד השטיפה.',
    choose_shade:'בוחרים את הגוון הקרוב לצבע הטבעי או לאורכי השיער. אם מתלבטים בין שניים, בוחרים את הבהיר מביניהם.',
    uses:        'בקבוק אחד מספיק לעד 30 שימושים לחידוש שורשים, תלוי באורך ובאזור הכיסוי.',
    equipment:   'לא צריך לערבב כלום ולא צריך מברשות. לוחצים על המשאבה, מורחים על שיער לח במקלחת, ממתינים 10 עד 15 דקות ושוטפים.',
    damage:      'הפורמולה לא חודרת לליבת השערה אלא עוטפת אותה מבחוץ, ובלי אמוניה וחמצן.',
    shipping:    'משלוח לכל נקודה בארץ תוך 5 עד 12 ימי עסקים, עם מספר מעקב ועדכוני SMS.',
    support:     'שירות הלקוחות עונה בעברית בוואטסאפ ובמייל.',
    payment:     'התשלום מאובטח בתקן SSL ו-PCI-DSS Level 1 והפרטים לא נשמרים במערכת.',
    guarantee:   '60 יום אחריות מלאה. אם הגוון לא מתאים או שאת לא מרוצה, יש החלפת גוון או החזר כספי מלא.'
  },

  /* Page rule: when she is torn between two shades, go LIGHTER.
   * The photo matcher must respect this, not just pick nearest. */
  tieBreakLighter: true
};
