import assert from "node:assert/strict";
import test from "node:test";
import { decideCommentAction, SHADES_HE } from "../src/lib/comment-intent.js";

const decide = (message: string, overrides: { isFromPage?: boolean; alreadyReplied?: boolean } = {}) =>
  decideCommentAction({ message, isFromPage: false, alreadyReplied: false, ...overrides });

/**
 * Every message below is a real comment taken from the ads on 2026-09-16. The
 * previous classifier filed all of them as positive_neutral, including the scam
 * warnings, which is why nothing could be automated from it.
 */
test("a customer saying the order never arrived is answered and taken off the ad", () => {
  for (const message of [
    "הזמנתי לפני שבועיים ועדיין לא הגיע!!! ממש מאוכזבת מרגישה שעבדו עלי",
    "הזמנתי ולא קיבלתי",
    "לא עובד עד שזה מגיע לפחות חודש",
  ]) {
    const decision = decide(message);
    assert.equal(decision.intent, "DELIVERY_COMPLAINT", message);
    assert.equal(decision.action, "REPLY_AND_HIDE");
    assert.match(decision.reply as string, /מספר ההזמנה/);
  }
});

test("a customer saying it does not colour is answered, not argued with", () => {
  for (const message of [
    "לא עובד. קניתי ופשוט לא צובע כלום",
    "דיס המלצה\nחבל על הכסף לא עובד ! רכשתי",
    "שמפו חירטוט. הזמנתי והתבדיתי.",
    "אצלי לא כיסה את השורשים, שינה מעט את צבע השיער . לא אקנה שוב",
  ]) {
    const decision = decide(message);
    assert.equal(decision.intent, "PRODUCT_NOT_WORKING", message);
    assert.equal(decision.classification, "severe_negative");
    assert.match(decision.reply as string, /הודעה פרטית/);
  }
});

test("a public accusation is never answered by a machine", () => {
  for (const message of [
    "זהירות בקניה לבדוק בגוגל על החברה , המוצר מוצג זול מידי",
    "אל תקנו מהם, רמאים",
  ]) {
    const decision = decide(message);
    assert.equal(decision.intent, "TRUST_ATTACK", message);
    assert.equal(decision.action, "ESCALATE");
    assert.equal(decision.reply, null, "a canned reply to an accusation makes it worse");
  }
});

test("anything about skin, allergies, pregnancy or ingredients goes to a person", () => {
  for (const message of [
    "מה לגבי שאריות צבע שמפו על העור",
    "יש בזה אמוניה?",
    "מתאים בהריון?",
    "יש אישור של משרד הבריאות?",
    "יש לי אלרגיה לצבעי שיער, זה מתאים?",
  ]) {
    const decision = decide(message);
    assert.equal(decision.intent, "SAFETY_OR_HEALTH", message);
    assert.equal(decision.action, "ESCALATE");
    assert.equal(decision.reply, null);
  }
});

test("health wins over a shade question when a comment is both", () => {
  const decision = decide("יש גוון בלונד? ויש בזה אמוניה?");
  assert.equal(decision.intent, "SAFETY_OR_HEALTH");
  assert.equal(decision.reply, null);
});

test("the shade question is answered from the catalogue, and says there is no blonde", () => {
  for (const message of ["האם יש גוון בלונד?", "לשיער בלונד יהיה בהמשך?", "למה אין גוון בלונד", "יש שחור?"]) {
    const decision = decide(message);
    assert.equal(decision.intent, "SHADE_QUESTION", message);
    assert.equal(decision.action, "REPLY");
    assert.match(decision.reply as string, /אין לנו גוון בלונד/);
    // Medium Brown was added to the catalogue and has to appear here too.
    for (const shade of SHADES_HE) assert.ok((decision.reply as string).includes(shade), shade);
  }
});

test("delivery questions are answered from approved facts only", () => {
  const decision = decide("כמה זמן משלוח? האם המשלוח עד הבית?");
  assert.equal(decision.intent, "SHIPPING_QUESTION");
  assert.match(decision.reply as string, /5–12 ימי עסקים/);
  assert.match(decision.reply as string, /199/);
});

test("a payment question waits for a person, because no approved answer exists", () => {
  const decision = decide("אפשר מזומן לשליח?");
  assert.equal(decision.intent, "PAYMENT_QUESTION");
  assert.equal(decision.action, "ESCALATE");
  assert.equal(decision.reply, null);
});

test("praise is thanked and never hidden", () => {
  const decision = decide("מוצר מעולה אני קניתי והשתמשתי תוצאה מושלמת");
  assert.equal(decision.intent, "PRAISE");
  assert.equal(decision.action, "REPLY");
});

test("tagging a friend is not a question", () => {
  for (const message of ["Sivan Adivi", "כוכב אופיר", "Shani Ben Tovim"]) {
    assert.equal(decide(message).action, "IGNORE", message);
  }
  // A tag with a real question attached is still a question.
  assert.equal(decide("Shani Ben Tovim מה דעתך שנזמין? יש בלונד?").intent, "SHADE_QUESTION");
});

test("nothing is ever answered twice, and the page never answers itself", () => {
  assert.equal(decide("האם יש גוון בלונד?", { alreadyReplied: true }).action, "IGNORE");
  assert.equal(decide("הזמנתי ולא קיבלתי", { alreadyReplied: true }).action, "IGNORE");
  assert.equal(decide("מושלם", { isFromPage: true }).action, "IGNORE");
});

test("an unrecognised comment waits for a person rather than guessing", () => {
  const decision = decide("האם אפשר להשתמש בזה יחד עם מסכה שקניתי בסופר בשבוע שעבר?");
  assert.equal(decision.action, "ESCALATE");
  assert.equal(decision.reply, null);
});

test("a comment pointing buyers at AliExpress is hidden, not argued with", () => {
  for (const message of [
    "אותו מוצר באליאקספרס ב-20 שקל",
    "זהירות! זה מאלי אקספרס במחיר רבע",
    "You can buy this on AliExpress for 5 dollars",
  ]) {
    const decision = decide(message);
    assert.equal(decision.intent, "MARKETPLACE_PRICE_CLAIM", message);
    assert.equal(decision.action, "HIDE");
    assert.equal(decision.reply, null, "arguing about price under a paid ad loses");
  }
  // A person's health question still beats it.
  assert.equal(decide("ראיתי באליאקספרס, ויש בזה אמוניה?").intent, "SAFETY_OR_HEALTH");
});

/**
 * The cases below were all misread on the first pass over the live ads on
 * 2026-09-17, which is why each one is here.
 */
test("asking to be allowed to try a sample is not an accusation", () => {
  // "שנוכל להתנסות" is "so that we can try it"; נוכל is only an accusation alone.
  const decision = decide("לפני שמוכרים 4 בקבוקים במבצע, אשמח שתמכרו דוגמיות, שנוכל להתנסות ולראות שהמוצר מתאים");
  assert.notEqual(decision.intent, "TRUST_ATTACK");
  assert.equal(decide("הם נוכלים").intent, "TRUST_ATTACK");
  assert.equal(decide("נוכל לקבל הנחה?").intent !== "TRUST_ATTACK", true);
});

test("a parcel that arrived smashed is apologised for, not traced", () => {
  const decision = decide("הזמנתי 4 שמפו בצבע חום כהה 2 הגיעו מפוצצים ושבורים. שלחתי מיילים ואין מענה מהם!!!!");
  assert.equal(decision.intent, "DAMAGED_ON_ARRIVAL");
  assert.equal(decision.action, "REPLY_AND_HIDE");
  // It is already on her counter, so never ask her to wait while we find it.
  assert.doesNotMatch(decision.reply as string, /איפה החבילה|ההמתנה/);
  assert.match(decision.reply as string, /תמונה/);
});

test("a package that never came is still traced", () => {
  const decision = decide("שלחתי מיילים ואין מענה, ההזמנה לא הגיעה");
  assert.equal(decision.intent, "DELIVERY_COMPLAINT");
  assert.match(decision.reply as string, /איפה החבילה/);
});

test("past-tense complaints count as complaints", () => {
  for (const message of ["לאה סודרי באמת? אצלי לא עבד", "שקר וכזב המוצר הזה! לא צבע לי שערה לבנה אחת"]) {
    assert.equal(decide(message).intent, "PRODUCT_NOT_WORKING", message);
  }
});

test("a shade question counts even without the word for shade", () => {
  const decision = decide("היי אם השיער שלי חום כהה ואני רוצה חום טיפה בהיר יותר לקנות את הבהיר יותר?");
  assert.equal(decision.intent, "SHADE_QUESTION");
  assert.match(decision.reply as string, /חום בינוני/);
});

test("a price question is not answered with a list of shades", () => {
  const decision = decide("למה המחיר שונה בין שחור לחום בהיר?");
  assert.equal(decision.intent, "PRICE_QUESTION");
  assert.equal(decision.reply, null);
});
