import type { SupportMessageInput } from "./types.js";

export function supportFixtureMessages(mailboxAddress: string): SupportMessageInput[] {
  return [
    {
      messageId: "fixture-shipping-1@example.test",
      from: "dana@example.test",
      to: [mailboxAddress],
      subject: "איפה המשלוח שלי?",
      sentAt: new Date("2026-08-23T10:00:00Z"),
      text: "היי, הזמנתי לפני כמה ימים ורציתי לדעת איפה המשלוח שלי.",
    },
    {
      messageId: "fixture-shipping-2@example.test",
      inReplyTo: "fixture-shipping-1@example.test",
      references: ["fixture-shipping-1@example.test"],
      from: "dana@example.test",
      to: [mailboxAddress],
      subject: "Re: איפה המשלוח שלי?",
      sentAt: new Date("2026-08-23T12:00:00Z"),
      text: "יש כבר מספר מעקב?",
    },
    {
      messageId: "fixture-refund-1@example.test",
      from: "noa@example.test",
      to: [mailboxAddress],
      subject: "בקשה להחזר",
      sentAt: new Date("2026-08-23T11:15:00Z"),
      text: "אני רוצה להחזיר את המוצר ולקבל החזר בבקשה.",
    },
    {
      messageId: "fixture-shade-1@example.test",
      from: "yael@example.test",
      to: [mailboxAddress],
      subject: "איזה גוון לבחור?",
      sentAt: new Date("2026-08-22T17:45:00Z"),
      text: "השיער שלי חום כהה ואני מתלבטת בין חום כהה לשחור. איזה גוון מתאים?",
    },
    {
      messageId: "fixture-legal-1@example.test",
      from: "customer4@example.test",
      to: [mailboxAddress],
      subject: "דחוף - הזמנה לא הגיעה",
      sentAt: new Date("2026-08-21T09:30:00Z"),
      text: "זה דחוף. אם לא אקבל תשובה אאלץ לפנות לחברת האשראי.",
    },
  ];
}
