export interface SupportContextExample {
  topic: string;
  customerMessage: string;
  ownerReply: string;
  createdAt?: Date | string;
}

function clean(value: unknown, max = 900): string {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?:\+?972|0)(?:[-\s]?\d){8,9}/g, "[PHONE]")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/**
 * Renders the approval-gated support context as Markdown. This is generated
 * from D1 at request/draft time, so it stays current without allowing an AI
 * draft to mutate the knowledge base.
 */
export function renderSupportContextMarkdown(input: {
  approvedFacts: string[];
  approvedExamples: SupportContextExample[];
  sourceLabel?: string;
}): string {
  const facts = input.approvedFacts.filter(Boolean).map(fact => clean(fact, 500));
  const examples = input.approvedExamples.filter(example => example.customerMessage && example.ownerReply);
  const lines = [
    "# AI Support Context",
    "",
    "This document is approval-gated. Use it for verified store facts and the owner's writing voice.",
    "Only examples marked APPROVED in the Support workspace are included.",
    "",
    `Source: ${clean(input.sourceLabel || "Funnel Builder Support knowledge", 180)}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Approved store facts",
    "",
    ...(facts.length ? facts.map(fact => `- ${fact}`) : ["- No approved store facts are currently available."]),
    "",
    "## Approved owner-reply examples",
    "",
  ];
  if (!examples.length) {
    lines.push("No approved owner-reply examples are currently available.");
  } else {
    examples.slice(0, 24).forEach((example, index) => {
      lines.push(`### Example ${index + 1} · ${clean(example.topic || "OTHER", 80)}`);
      lines.push("");
      lines.push("**Customer:**");
      lines.push("");
      lines.push(clean(example.customerMessage));
      lines.push("");
      lines.push("**Owner reply:**");
      lines.push("");
      lines.push(clean(example.ownerReply));
      lines.push("");
    });
  }
  lines.push(
    "## Safety rules",
    "",
    "- Never invent order status, tracking, delivery dates, refunds, cancellations, product results, medical claims, or regulatory approval.",
    "- Chargebacks, refunds, cancellations, address changes, legal/safety/fraud/privacy concerns, and uncertain identity require owner review.",
    "- Reply in concise, warm Israeli Hebrew when the customer writes Hebrew; answer the latest customer message directly.",
    "- This context guides style and approved facts only. It does not authorize sending a message.",
    "",
  );
  return lines.join("\n");
}
