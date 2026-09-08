import { runLifecycleCron } from "./cron";
import { handleLifecycleRequest } from "./index";
import type {
  ExecutionContextLike,
  LifecycleEnv,
  ScheduledControllerLike,
} from "./types";
import { processShopifyLifecycleWebhook } from "./webhooks";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(
    request: Request,
    env: LifecycleEnv,
    _context: ExecutionContextLike,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/api/lifecycle/webhooks/shopify") {
      try {
        const result = await processShopifyLifecycleWebhook(env, request);
        return json({ ok: true, ...result });
      } catch (error) {
        const invalid = error instanceof Error && error.message === "invalid_shopify_webhook";
        return json({ ok: false, error: invalid ? "invalid_signature" : "processing_failed" }, invalid ? 401 : 500);
      }
    }

    const lifecycle = await handleLifecycleRequest(request, env);
    return lifecycle ?? new Response("Not found", { status: 404 });
  },

  scheduled(
    event: ScheduledControllerLike,
    env: LifecycleEnv,
    context: ExecutionContextLike,
  ): void {
    context.waitUntil(runLifecycleCron(env, event));
  },
};
