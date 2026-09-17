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
        reconcileGrowthCockpitCjCosts,
        reconcileGrowthCockpitCjOrderCosts,
      } = await import("./services/growth-cockpit-reconcile.js");
      const { processSupportDeskCron, processSupportOutbox } = await import("./services/support-desk.js");
      const { processShipmentOutreach } = await import("./services/shipment-outreach.js");
      const { refreshShipmentTracking } = await import("./services/shipment-refresh.js");
      const { snapshotDashboardDaily } = await import("./services/dashboard-daily.js");
      const { sendOwnerDigest } = await import("./services/owner-digest.js");
      const { reconcileMissingCjOrders } = await import("./services/cj-order-backfill.js");
      const { reconcileShopifyOrderAttribution } = await import("./services/shopify-order-reconcile.js");
      const { processCommentGuardian } = await import("./services/comment-guardian.js");
      if (workerEnv?.DB) {
        // A rejection inside waitUntil settles after this try block has already
        // returned, so the catch below never sees it, and Promise.all would fail
        // the whole tick over a single bad task. Each task now reports its own
        // failure and settles, so one broken reconciler cannot mark every
        // minute's cron run as a Worker error.
        const run = (label: string, task: Promise<unknown>) => task.catch(taskErr => console.error(JSON.stringify({
          message: "cron_task_failed",
          task: label,
          error: taskErr instanceof Error ? taskErr.message : String(taskErr),
        })));
        const tasks = [
          run("processPendingQueueCron", processPendingQueueCron(workerEnv.DB)),
          run("reconcileGrowthCockpitMetaSpend", reconcileGrowthCockpitMetaSpend()),
          run("reconcileGrowthCockpitShopifyFinancials", reconcileGrowthCockpitShopifyFinancials()),
          run("reconcileGrowthCockpitCjCosts", reconcileGrowthCockpitCjCosts()),
          run("reconcileGrowthCockpitCjOrderCosts", reconcileGrowthCockpitCjOrderCosts()),
          run("processSupportDeskCron", processSupportDeskCron()),
          run("processSupportOutbox", processSupportOutbox()),
        ];
        if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 0) {
          tasks.push(run("reconcileShopifyOrderAttribution", reconcileShopifyOrderAttribution()));
        }
        // A paid order the supplier never received is invisible otherwise:
        // nothing retries an order that was never queued in the first place.
        if (new Date(event.scheduledTime).getUTCMinutes() % 20 === 11) {
          tasks.push(run("reconcileMissingCjOrders", reconcileMissingCjOrders()));
        }
        // One email a morning with anything that needs a person.
        if (new Date(event.scheduledTime).getUTCMinutes() % 15 === 6) {
          tasks.push(run("sendOwnerDigest", sendOwnerDigest()));
        }
        // Settle the daily rows the trend comparisons read.
        if (new Date(event.scheduledTime).getUTCMinutes() % 10 === 4) {
          tasks.push(run("snapshotDashboardDaily", snapshotDashboardDaily()));
        }
        // Carrier events refresh a few orders at a time so the board never waits for the next snapshot.
        if (new Date(event.scheduledTime).getUTCMinutes() % 5 === 2) {
          tasks.push(run("refreshShipmentTracking", refreshShipmentTracking()));
        }
        // Comments under a live ad are read by every future buyer. Four times an
        // hour is fast enough to answer one, and slow enough that Meta's write
        // limits are never near.
        if (new Date(event.scheduledTime).getUTCMinutes() % 15 === 3) {
          tasks.push(run("processCommentGuardian", processCommentGuardian()));
        }
        // Proactive delivery updates twice an hour; each run is capped and idempotent.
        if (new Date(event.scheduledTime).getUTCMinutes() % 30 === 7) {
          tasks.push(run("processShipmentOutreach", processShipmentOutreach()));
        }
        ctx.waitUntil(Promise.allSettled(tasks));
      }
    } catch (cronErr) {
      console.error("[CRON EXECUTION ERROR]", cronErr);
    }
  }
};
