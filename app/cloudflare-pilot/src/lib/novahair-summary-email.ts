export interface NovaHairSummaryEmail {
  mainConcern?: string;
  recommendedShade?: string;
  recommendedBundle?: string;
  kind?: "summary" | "guide" | "coupon";
  couponCode?: string;
}

function concernLine(value: string | undefined): string {
  const concern = String(value || "").toLowerCase();
  if (/price|מחיר|כסף|עלות/.test(concern)) return "לפי מה שסיפרת, חשוב לך לבחור פתרון משתלם בלי לקנות יותר ממה שאת צריכה.";
  if (/shade|גוון|צבע/.test(concern)) return "לפי מה שסיפרת, הנקודה החשובה ביותר היא להתחיל מגוון שייראה טבעי על השיער שלך.";
  if (/natural|טבעי|ביתי/.test(concern)) return "לפי מה שסיפרת, חשוב לך שהתוצאה תיראה טבעית ולא כמו צבע ביתי בולט.";
  if (/appointment|hassle|תור|זמן/.test(concern)) return "לפי מה שסיפרת, חשוב לך לקצר את ההתעסקות עם השורשים בין צביעה לצביעה.";
  return "לפי מה שסיפרת, את מחפשת דרך פשוטה יותר לטפל בשורשים בין צביעה לצביעה.";
}

export function buildNovaHairSummaryEmailBody(input: NovaHairSummaryEmail): string {
  const lines = [
    "שלום,",
    "",
    "כמו שהבטחתי, הנה הסיכום שלך משיחת ההתאמה עם נעמה:",
    "",
    concernLine(input.mainConcern),
  ];
  if (input.recommendedShade) {
    lines.push(`הגוון שהייתי בודקת קודם: ${input.recommendedShade}. זו התאמה ראשונית, וכדאי לוודא מול תמונות הגוונים בעמוד.`);
  }
  if (input.recommendedBundle) {
    lines.push(`המארז שהייתי בוחרת לפי השיחה: ${input.recommendedBundle}.`);
  }
  if (input.recommendedBundle === "מארז 4 בקבוקים") {
    lines.push("מחיר המארז הוא ₪239 במקום ₪758: חיסכון של ₪519, כ־68%, וערכת צביעה מלאה במתנה בשווי ₪79.");
  }
  if (input.kind === "coupon" && input.couponCode) {
    lines.push(`קוד ההטבה להזמנה הראשונה: ${input.couponCode}.`);
  }
  lines.push(
    "",
    "לבחירת גוון וחבילה:",
    "https://tigerbrandsglobal.com/pages/novahair-sales-staging#buy",
    "",
    "נעמה לוי",
    "מומחית צביעת השיער של NovaHair",
    "מבית Tiger Brands Global",
  );
  return lines.join("\n");
}
