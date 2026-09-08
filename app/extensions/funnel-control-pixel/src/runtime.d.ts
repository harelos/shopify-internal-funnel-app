export const FUNNEL_CONTROL_PIXEL_ENDPOINT: string;
export const FUNNEL_CONTROL_CART_ATTRIBUTE: string;
export function resolvePixelEndpoint(configuredEndpoint?: unknown): string;
export function cartContextFromEvent(event: unknown): Record<string, unknown>;
export function reduceCheckoutEvent(event: unknown): {
  id?: string;
  name?: string;
  timestamp?: string;
  data: {
    checkout: {
      token?: string;
      order: {
        id?: string;
        customer: { id?: string };
      };
    };
  };
};
