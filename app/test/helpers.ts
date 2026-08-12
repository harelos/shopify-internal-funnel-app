import { FunnelService } from "../src/funnel-service.js";

export function createScenario() {
  const service = new FunnelService();
  const shop = service.createShop("test-only.myshopify.test");
  const funnel = service.createFunnel(shop.id, "Test funnel", "test-funnel");
  const step = service.addStep(funnel.id, "Test pre-checkout", "PRE_CHECKOUT");
  const control = service.createVariant(step.id, "Control");
  const alternate = service.createVariant(step.id, "Alternate");
  const experiment = service.createExperiment(step.id, [
    { variantId: control.id, weightBasisPoints: 5_000 },
    { variantId: alternate.id, weightBasisPoints: 5_000 },
  ]);
  return { service, shop, funnel, step, control, alternate, experiment };
}
