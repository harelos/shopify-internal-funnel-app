export type LifecycleMode = "disabled" | "test" | "production";

export interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results?: T[];
  meta?: Record<string, unknown>;
  error?: string;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface ScheduledControllerLike {
  scheduledTime: number;
  cron: string;
  noRetry?(): void;
}

export interface LifecycleEnv {
  DB: D1Database;
  APP_URL?: string;
  SHOP_DOMAIN?: string;
  ALLOWED_SHOP_DOMAIN?: string;
  SHOPIFY_STOREFRONT_DOMAIN?: string;
  SHOPIFY_API_VERSION?: string;
  SHOPIFY_ADMIN_ACCESS_TOKEN?: string;
  SHOPIFY_ACCESS_TOKEN?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
  SHOPIFY_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string;
  RESEND_FROM?: string;
  RESEND_REPLY_TO?: string;
  LIFECYCLE_MODE?: string;
  LIFECYCLE_ENABLED?: string;
  LIFECYCLE_TEST_EMAIL?: string;
  LIFECYCLE_ALERT_EMAIL?: string;
  LIFECYCLE_ADMIN_TOKEN?: string;
  LIFECYCLE_DATA_KEY?: string;
  LIFECYCLE_HASH_KEY?: string;
  LIFECYCLE_ACTIVATED_AT?: string;
  LIFECYCLE_SYNC_INTERVAL_MINUTES?: string;
  LIFECYCLE_SYNC_OVERLAP_MINUTES?: string;
  LIFECYCLE_MAX_PAGES?: string;
}

export type LifecycleFlow =
  | "abandoned_checkout"
  | "welcome"
  | "abandoned_cart"
  | "browse_abandonment"
  | "post_purchase"
  | "replenishment";

export type LifecycleEventName =
  | "shopify.checkout_abandoned"
  | "shopify.checkout_recovered"
  | "shopify.purchase_completed"
  | "shopify.marketing_subscribed"
  | "shopify.post_purchase_started"
  | "shopify.replenishment_due"
  | "storefront.cart_abandoned"
  | "storefront.product_browsed"
  | "lifecycle.browse_stop"
  | "lifecycle.cart_stop"
  | "lifecycle.replenishment_stop";

export type ConsentState =
  | "SUBSCRIBED"
  | "PENDING"
  | "NOT_SUBSCRIBED"
  | "UNSUBSCRIBED"
  | "REDACTED"
  | "UNKNOWN";

export interface NormalizedLifecyclePayload {
  event_key: string;
  checkout_id?: string;
  order_id?: string;
  customer_id?: string;
  first_name?: string;
  cta_url?: string;
  product_name?: string;
  product_image?: string;
  variant?: string;
  shade?: string;
  bundle?: string;
  quantity?: number;
  total?: number;
  currency?: string;
  consent_state: ConsentState;
  occurred_at: string;
  email_number?: number;
  flow?: LifecycleFlow;
  is_test: boolean;
  [key: `cta_url_e${string}`]: string | undefined;
}

export interface OutboundLifecycleEvent {
  event: LifecycleEventName;
  email: string;
  payload: NormalizedLifecyclePayload;
}

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyAbandonedCheckout {
  id: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  abandonedCheckoutUrl: string;
  customer: {
    id: string;
    firstName: string | null;
    defaultEmailAddress: {
      emailAddress: string;
      marketingState: ConsentState;
      marketingOptInLevel: string | null;
      marketingUpdatedAt: string | null;
      validFormat: boolean;
    } | null;
  } | null;
  lineItems: {
    nodes: Array<{
      id: string;
      title: string | null;
      variantTitle: string | null;
      sku: string | null;
      quantity: number;
      image: { url: string; altText: string | null } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  totalPriceSet: { presentmentMoney: ShopifyMoney };
}

export interface AbandonedCheckoutRow {
  shopify_checkout_id: string;
  shop_domain: string;
  customer_id: string | null;
  email: string | null;
  email_hash: string | null;
  first_name: string | null;
  checkout_url: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  automation_triggered_at: string | null;
  recovery_event_sent_at: string | null;
  purchase_event_sent_at: string | null;
  consent_state: ConsentState;
  state: "PENDING" | "ABANDONED" | "RECOVERED" | "PURCHASED" | "INELIGIBLE" | "SUPPRESSED" | "EXHAUSTED";
  next_email_number: number;
  next_due_at: string | null;
  payload_hash: string;
  product_name: string | null;
  product_image: string | null;
  variant: string | null;
  shade: string | null;
  bundle: string | null;
  quantity: number | null;
  total: number | null;
  currency: string | null;
}

export interface ScheduledLifecycleRow {
  idempotency_key: string;
  event_name: LifecycleEventName;
  flow: LifecycleFlow;
  email_number: number;
  entity_type: string;
  entity_id: string;
  due_at: string;
  status: "PENDING" | "LEASED" | "DISPATCHED" | "CANCELLED" | "RETRY" | "DEAD";
  attempts: number;
  max_attempts: number;
  lease_until: string | null;
  next_attempt_at: string;
}

export interface ShopifyOrderWebhook {
  id?: number | string;
  admin_graphql_api_id?: string;
  checkout_id?: number | string | null;
  checkout_token?: string | null;
  email?: string | null;
  contact_email?: string | null;
  customer?: {
    id?: number | string;
    admin_graphql_api_id?: string;
    first_name?: string | null;
    email?: string | null;
  } | null;
  created_at?: string;
  processed_at?: string;
  currency?: string;
  presentment_currency?: string;
  total_price?: string | number;
  current_total_price?: string | number;
  financial_status?: string | null;
  marketing_consent_state?: ConsentState;
  test?: boolean;
  line_items?: Array<{
    product_id?: number | string | null;
    product_handle?: string | null;
    title?: string;
    variant_title?: string | null;
    quantity?: number;
    sku?: string | null;
  }>;
}

export interface ShopifyOrderNode {
  id: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  displayFinancialStatus: string | null;
  test: boolean;
  email: string | null;
  customer: {
    id: string;
    firstName: string | null;
    defaultEmailAddress: {
      emailAddress: string;
      marketingState: ConsentState;
      marketingOptInLevel: string | null;
      marketingUpdatedAt: string | null;
      validFormat: boolean;
    } | null;
  } | null;
  lineItems: {
    nodes: Array<{
      id: string;
      title: string;
      variantTitle: string | null;
      sku: string | null;
      quantity: number;
      image: { url: string; altText: string | null } | null;
      product: { id: string; handle: string } | null;
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
  fulfillments: Array<{
    id: string;
    displayStatus: string | null;
    inTransitAt: string | null;
    deliveredAt: string | null;
    estimatedDeliveryAt: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
    events: {
      nodes: Array<{ id: string; status: string; happenedAt: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  }>;
  currentTotalPriceSet: { presentmentMoney: ShopifyMoney };
}

export interface ShopifyFulfillmentEventWebhook {
  id?: number | string;
  admin_graphql_api_id?: string;
  fulfillment_id?: number | string;
  order_id?: number | string;
  status?: string | null;
  happened_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  estimated_delivery_at?: string | null;
}

export interface ShopifyFulfillmentWebhook {
  id?: number | string;
  admin_graphql_api_id?: string;
  order_id?: number | string;
  status?: string | null;
  shipment_status?: string | null;
  tracking_company?: string | null;
  tracking_number?: string | null;
  tracking_numbers?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ShopifyCustomerNode {
  id: string;
  firstName: string | null;
  updatedAt: string;
  defaultEmailAddress: {
    emailAddress: string;
    marketingState: ConsentState;
    marketingOptInLevel: string | null;
    marketingUpdatedAt: string | null;
    validFormat: boolean;
  } | null;
}

export interface ResendWebhookPayload {
  type: string;
  created_at: string;
  data: {
    email_id?: string;
    email?: string;
    unsubscribed?: boolean;
    template_id?: string;
    automation_id?: string;
    to?: string[];
    subject?: string;
    tags?: Record<string, string>;
    bounce?: { type?: string; subType?: string; message?: string };
    suppressed?: { type?: string; message?: string };
  };
}
