import type { SupportMessageInput } from "./types.js";

export const supportFixtureMessages: SupportMessageInput[] = [
  {
    messageId: "fixture-1@example.test",
    from: "customer@example.test",
    to: ["support@example.test"],
    subject: "איפה המשלוח שלי?",
    sentAt: new Date("2026-08-23T10:00:00Z"),
    text: "היי, הזמנתי לפני כמה ימים ורציתי לדעת איפה המשלוח שלי.",
  },
  {
    messageId: "fixture-2@example.test",
    inReplyTo: "fixture-1@example.test",
    references: ["fixture-1@example.test"],
    from: "customer@example.test",
    to: ["support@example.test"],
    subject: "Re: איפה המשלוח שלי?",
    sentAt: new Date("2026-08-23T12:00:00Z"),
    text: "יש כבר מספר מעקב?",
  },
];
