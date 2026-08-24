export type SupportCategory =
  | "shipping_tracking"
  | "product_usage"
  | "refund_return"
  | "address_change"
  | "shade_product_question"
  | "damaged_wrong_item"
  | "order_status"
  | "other";

export type SupportUrgency = "low" | "normal" | "high";

export type SupportMessageInput = {
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  from: string;
  to: string[];
  subject: string;
  sentAt: Date;
  text: string;
  html?: string | null;
};

export type SupportClassification = {
  category: SupportCategory;
  confidence: number;
  urgency: SupportUrgency;
  summary: string;
  requiresHuman: boolean;
};

export type SupportThreadInput = {
  threadKey: string;
  subject: string;
  participants: string[];
  messages: SupportMessageInput[];
  classification: SupportClassification;
};
