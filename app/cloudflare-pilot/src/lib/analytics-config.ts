export type AnalyticsMode = "TEST" | "LIVE";

export function configuredAnalyticsMode(): AnalyticsMode {
  return process.env.ANALYTICS_MODE === "LIVE" ? "LIVE" : "TEST";
}

export function analyticsModeForRequest(query: Record<string, unknown>): AnalyticsMode {
  const configured = configuredAnalyticsMode();
  if (process.env.ANALYTICS_ALLOW_TEST_QUERY === "true" && query.mode === "TEST") {
    return "TEST";
  }
  return configured;
}

export function analyticsDataContract(mode: AnalyticsMode) {
  return {
    dataMode: mode,
    dataSource: mode === "LIVE" ? "SHOPIFY_CONNECTED" : "LOCAL_TEST",
    sampleSizeCaveat: mode === "LIVE"
      ? "Live values require active Shopify webhooks, Web Pixel telemetry, and a configured public app endpoint."
      : "These values are local TEST data and are not Shopify store analytics.",
  } as const;
}

export function isTestForMode(mode: AnalyticsMode): boolean {
  return mode === "TEST";
}
