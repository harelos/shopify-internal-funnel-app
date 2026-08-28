import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";

(globalThis as typeof globalThis & {
  __SHOPIFY_WORKER_ENV__?: typeof env;
}).__SHOPIFY_WORKER_ENV__ = env;

const { default: app } = await import("./server.js");

app.listen(3000);
const httpHandler = httpServerHandler({ port: 3000 });

export default {
  fetch(request: Request, workerEnv: any, ctx: any) {
    (globalThis as any).__SHOPIFY_WORKER_ENV__ = workerEnv;
    return httpHandler.fetch!(request as any, workerEnv, ctx);
  },
  async scheduled(event: any, workerEnv: any, ctx: any) {
    (globalThis as any).__SHOPIFY_WORKER_ENV__ = workerEnv;
    try {
      const { processPendingQueueCron } = await import("./services/novahair-monitor.js");
      const {
        reconcileGrowthCockpitMetaSpend,
        reconcileGrowthCockpitShopifyFinancials,
      } = await import("./services/growth-cockpit-reconcile.js");
      if (workerEnv?.DB) {
        ctx.waitUntil(Promise.all([
          processPendingQueueCron(workerEnv.DB),
          reconcileGrowthCockpitMetaSpend(),
          reconcileGrowthCockpitShopifyFinancials(),
        ]));
      }
    } catch (cronErr) {
      console.error("[CRON EXECUTION ERROR]", cronErr);
    }
  }
};
