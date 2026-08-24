import type { SupportSentiment } from "./contracts.js";

const positive = [
  /thank you/i,
  /thanks/i,
  /love/i,
  /great/i,
  /amazing/i,
  /תודה/i,
  /מעולה/i,
  /מדהים/i,
  /אהבתי/i,
];

const negative = [
  /angry/i,
  /terrible/i,
  /awful/i,
  /disappointed/i,
  /frustrated/i,
  /unacceptable/i,
  /כועס/i,
  /כועסת/i,
  /מאוכזב/i,
  /מאוכזבת/i,
  /גרוע/i,
  /לא מקובל/i,
];

export function detectSupportSentiment(subject: string | undefined, message: string): SupportSentiment {
  const corpus = `${subject || ""}\n${message}`;
  const hasNegative = negative.some((pattern) => pattern.test(corpus));
  const hasPositive = positive.some((pattern) => pattern.test(corpus));
  if (hasNegative && !hasPositive) return "NEGATIVE";
  if (hasPositive && !hasNegative) return "POSITIVE";
  if (hasPositive || hasNegative) return "NEUTRAL";
  return "UNKNOWN";
}
