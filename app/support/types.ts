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

export type SupportThread = {
  threadKey: string;
  subject: string;
  participants: string[];
  messages: SupportMessageInput[];
};

export type SupportClassification = {
  category:
    | "shipping_tracking"
    | "product_usage"
    | "refund_return"
    | "address_change"
    | "shade_product_question"
    | "damaged_wrong_item"
    | "order_status"
    | "other";
  confidence: number;
  urgency: "low" | "normal" | "high";
  summary: string;
  requiresHuman: boolean;
};
