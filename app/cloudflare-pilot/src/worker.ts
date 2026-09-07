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
        // A rejection inside waitUntil settles after this try block has already
        // returned, so the catch below never sees it, and Promise.all would fail
        // the whole tick over a single bad task. Each task now reports its own
        // failure and settles, so one broken reconciler cannot mark every
        // minute's cron run as a Worker error.
        const run = (label: string, task: Promise<unknown>) =>
          task.catch(taskErr => console.error(`[CRON TASK FAILED] ${label}`, taskErr));
        ctx.waitUntil(Promise.allSettled([
          run("processPendingQueueCron", processPendingQueueCron(workerEnv.DB)),
          run("reconcileGrowthCockpitMetaSpend", reconcileGrowthCockpitMetaSpend()),
          run("reconcileGrowthCockpitShopifyFinancials", reconcileGrowthCockpitShopifyFinancials()),
        ]));
      }
    } catch (cronErr) {
      console.error("[CRON EXECUTION ERROR]", cronErr);
    }
  }
};
