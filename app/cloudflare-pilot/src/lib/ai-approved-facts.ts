export interface ApprovedFactAnswer {
  reply: string;
  next: "root_choice" | "escalate";
}

/* Fixed store facts should not depend on model availability or phrasing. */
export function approvedFactAnswer(message: string): ApprovedFactAnswer | null {
  const text = message.replace(/\s{2,}/g, " ").trim();

  if (/משלוח|אספקה|זמן הגעה|מתי (?:זה|המוצר|ההזמנה) (?:מגיע|תגיע)/.test(text)) {
    return {
      reply: "המשלוח מגיע לכל נקודה בארץ תוך 5 עד 12 ימי עסקים, וחינם בהזמנה מעל 199 שקל.",
      next: "root_choice",
    };
  }

  if (/אחריות|החזר כספי|החלפת גוון|אפשר להחזיר/.test(text)) {
    return {
      reply: "יש 60 יום אחריות מלאה, כולל החלפת גוון או החזר כספי.",
      next: "root_choice",
    };
  }

  if (/כמה שימושים|לכמה שימושים|כמה פעמים|מספיק (?:לי )?בקבוק/.test(text)) {
    return {
      reply: "בקבוק אחד מספיק לעד 30 שימושים לחידוש שורשים.",
      next: "root_choice",
    };
  }

  if (/כמה (?:זה|המארז|המוצר) עולה|מה המחיר|מחירי המארזים/.test(text)) {
    return {
      reply: "מארז 4 המומלץ עולה 239 שקל במקום 758, חיסכון של 519 שקל, כ-68 אחוז, וכולל ערכת צביעה מלאה במתנה בשווי 79 שקל.",
      next: "root_choice",
    };
  }

  if (/למה.*(?:נשים|לקוחות).*(?:עובר|בוחר)|למה.*(?:עובר|לבחור|כדאי)|מה היתרו(?:ן|נות)|יתרונות/.test(text)) {
    return {
      reply: "בעיקר בגלל השליטה: לא צריך לחכות לתור בכל פעם שהשורש יוצא. אפשר לחדש אותו בבית בתוך 10 עד 15 דקות, בלי ערבוב ובלי אמוניה.",
      next: "root_choice",
    };
  }

  if (/סניף|חנות פיזית|איסוף עצמי|כתובת (?:שלכם|פיזית)|איפה אתם נמצאים/.test(text)) {
    return {
      reply: "אין לי מידע מאושר על סניף, כתובת פיזית או איסוף עצמי. שירות הלקוחות יוכל לאשר לך.",
      next: "escalate",
    };
  }

  return null;
}
