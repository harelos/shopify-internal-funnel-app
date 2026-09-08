/**
 * NovaHair concierge - agent lanes and router.
 *
 * Pure data + one pure function. The runtime calls chooseAgent() with the
 * placement, the Liquid shopper object, and a safety signal, and gets back a
 * lane. Each lane sets the opener, the entry node, the goal hint sent to the
 * model, and whether a coupon may be spent.
 *
 * See AGENTS.md for the architecture and the reasoning behind each rule.
 */
window.NovaHairAIAgents = {
  version: 'nova_agents_v1',

  /* Placement sets the DEFAULT goal (toward what she is helped). Lane sets HOW.
   * A persistent launcher differs from the exit popup only in shell + goal. */
  placements: {
    exit_sales:       { shell: 'exit',       goal: 'לעזור לה להחליט ולסגור את הרכישה בעמוד המכירה.' },
    exit_home:        { shell: 'exit',       goal: 'להבין מה היא מחפשת ולהוביל אותה לעמוד הנכון, בלי דחיפה למכירה.' },
    persistent_sales: { shell: 'launcher',   goal: 'לענות על שאלות ולעזור להשלים הזמנה בעמוד המכירה.' },
    persistent_home:  { shell: 'launcher',   goal: 'לעזור לה להתמצא ולמצוא את המוצר הנכון, ולאסוף פרטים אם היא לא מוכנה.' }
  },
  defaultPlacement: 'exit_sales',

  /* VIP threshold. orders_count at or above this lands in the VIP lane. */
  vipMinOrders: 3,

  lanes: {
    sales: {
      id: 'sales',
      entry: 'ask_name',
      allowCoupon: true,
      goalHint: 'היא לקוחה חדשה. עזרי לה להחליט. מותר להציע קוד להזמנה ראשונה רק אם המחיר עוצר אותה והיא עומדת לעזוב.'
    },
    retention: {
      id: 'retention',
      entry: 'welcome_back',
      allowCoupon: false,   // she is not a first-time buyer
      goalHint: 'היא כבר הזמינה בעבר. המטרה היא הזמנה חוזרת פשוטה, אותו גוון או שינוי. בלי קוד להזמנה ראשונה.'
    },
    vip: {
      id: 'vip',
      entry: 'vip_welcome',
      allowCoupon: false,   // a VIP gesture is configured separately, never the new-customer code
      goalHint: 'היא לקוחה ותיקה ונאמנה. יחס אישי, לגרום לה להרגיש מוכרת, עזרה מהירה וקדימות. בלי קוד להזמנה ראשונה.'
    },
    service: {
      id: 'service',
      entry: 'service_entry',
      allowCoupon: false,
      goalHint: 'יש לה בעיה או שאלת שירות. לא למכור בכלל. לפתור או להעביר לאדם.'
    }
  },
  defaultLane: 'sales',

  /**
   * Pure router. Returns a lane id.
   *   input = { placement, shopper:{loggedIn,ordersCount}, safety:'escalate'|'refuse_medical'|null }
   * Safety wins over everything: a VIP with a broken order needs support, not
   * an upsell.
   */
  chooseAgent: function (input) {
    input = input || {};
    if (input.safety === 'escalate' || input.safety === 'refuse_medical') return 'service';
    var s = input.shopper || {};
    var orders = (s.loggedIn && Number(s.ordersCount)) || 0;
    if (orders >= this.vipMinOrders) return 'vip';
    if (orders >= 1) return 'retention';
    return this.defaultLane;
  }
};
