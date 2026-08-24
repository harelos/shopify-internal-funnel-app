export type KnowledgePackStatus = "DRAFT" | "APPROVED" | "RETIRED";
export type KnowledgeFactState = "KNOWN" | "UNKNOWN";

export type KnowledgeFact<T> = {
  state: KnowledgeFactState;
  value?: T;
  source: string;
  verifiedAt?: string;
  notes?: string;
};

export type ShippingPolicyKnowledge = {
  deliveryWindow: KnowledgeFact<string>;
  processingWindow: KnowledgeFact<string>;
  freeShippingRule: KnowledgeFact<string>;
  regions: KnowledgeFact<string[]>;
  customsAndDuties: KnowledgeFact<string>;
};

export type ReturnsPolicyKnowledge = {
  eligibilityWindow: KnowledgeFact<string>;
  exclusions: KnowledgeFact<string[]>;
  returnMethod: KnowledgeFact<string>;
  refundTiming: KnowledgeFact<string>;
};

export type StorePolicyKnowledge = {
  shipping: ShippingPolicyKnowledge;
  returns: ReturnsPolicyKnowledge;
  guarantee: KnowledgeFact<string>;
  supportContact: KnowledgeFact<string>;
};

export type ProductFaq = {
  question: string;
  answer: string;
};

export type ProductKnowledge = {
  key: string;
  title: string;
  aliases: string[];
  shopifyProductIds?: string[];
  usageInstructions: KnowledgeFact<string[]>;
  productFacts: KnowledgeFact<Record<string, string | number | boolean>>;
  shadeGuidance: KnowledgeFact<string[]>;
  faq: KnowledgeFact<ProductFaq[]>;
};

export type SupportKnowledgePack = {
  schemaVersion: 1;
  packId: string;
  version: string;
  status: KnowledgePackStatus;
  effectiveFrom: string;
  reviewedBy?: string;
  policies: StorePolicyKnowledge;
  products: ProductKnowledge[];
};

export type KnowledgeLookupResult<T> =
  | {
      found: true;
      packId: string;
      packVersion: string;
      value: T;
      source: string;
      verifiedAt?: string;
    }
  | {
      found: false;
      packId: string;
      packVersion: string;
      reason: "PACK_NOT_APPROVED" | "UNKNOWN_FACT" | "PRODUCT_NOT_FOUND" | "AMBIGUOUS_PRODUCT";
    };
