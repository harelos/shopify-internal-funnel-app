import { createHash } from "node:crypto";
import { analyzeHtml } from "./portability.js";
import { LocalStore } from "./store.js";
import type { ShopifyIntegrationEvent } from "./shopify-integration.js";
import { BASIS_POINTS_TOTAL, type Assignment, type ContentVersion, type EventName, type Experiment, type ExperimentAllocation, type Funnel, type FunnelEvent, type OrderAttribution, type Step, type StepKind, type SyntheticEventInput, type Variant, type Visitor } from "./types.js";

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function required<T>(value: T | undefined | null, label: string): T { if (value === undefined || value === null) throw new Error(`${label} is required.`); return value; }

export class FunnelService {
  constructor(readonly store = new LocalStore()) {}

  createShop(domain = "local-only.myshopify.test") {
    const existing = this.store.values(this.store.shops).find((shop) => shop.domain === domain);
    if (existing) return existing;
    const shop = { id: this.store.id(), domain, localOnly: true as const, createdAt: new Date() };
    this.store.shops.set(shop.id, shop);
    return shop;
  }

  createFunnel(shopId: string, name: string, slug: string): Funnel {
    if (!name.trim() || !slug.trim()) throw new Error("Funnel name and slug are required.");
    if (this.store.values(this.store.funnels).some((funnel) => funnel.shopId === shopId && funnel.slug === slug)) throw new Error("A funnel already uses this slug.");
    const now = new Date();
    const funnel: Funnel = { id: this.store.id(), shopId, name: name.trim(), slug: slug.trim(), status: "DRAFT", createdAt: now, updatedAt: now };
    this.store.funnels.set(funnel.id, funnel);
    return funnel;
  }

  listFunnels(shopId: string): Funnel[] { return this.store.values(this.store.funnels).filter((funnel) => funnel.shopId === shopId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()); }
  getFunnel(id: string): Funnel { return required(this.store.funnels.get(id), "Funnel"); }

  updateFunnel(id: string, input: Partial<Pick<Funnel, "name" | "status">>): Funnel {
    const funnel = this.getFunnel(id);
    if (input.name !== undefined && !input.name.trim()) throw new Error("Funnel name cannot be empty.");
    const updated: Funnel = { ...funnel, ...input, name: input.name?.trim() ?? funnel.name, updatedAt: new Date(), archivedAt: input.status === "ARCHIVED" ? new Date() : funnel.archivedAt };
    this.store.funnels.set(id, updated);
    return updated;
  }

  addStep(funnelId: string, name: string, kind: StepKind): Step {
    this.getFunnel(funnelId);
    if (!name.trim()) throw new Error("Step name is required.");
    const position = this.store.stepsForFunnel(funnelId).length + 1;
    const step: Step = { id: this.store.id(), funnelId, position, name: name.trim(), kind, createdAt: new Date() };
    this.store.steps.set(step.id, step);
    return step;
  }

  createVariant(stepId: string, name: string): Variant {
    const step = required(this.store.steps.get(stepId), "Step");
    if (step.kind === "CHECKOUT_HANDOFF") throw new Error("Checkout handoff is a boundary marker and cannot have variants.");
    if (!name.trim()) throw new Error("Variant name is required.");
    const variant: Variant = { id: this.store.id(), stepId, name: name.trim(), createdAt: new Date() };
    this.store.variants.set(variant.id, variant);
    return variant;
  }

  importHtml(variantId: string, rawHtml: string): ContentVersion {
    required(this.store.variants.get(variantId), "Variant");
    const prior = this.store.versionsForVariant(variantId);
    const { normalizedHtml, report } = analyzeHtml(rawHtml);
    const version: ContentVersion = { id: this.store.id(), variantId, revision: prior.length + 1, state: "DRAFT", rawHtml, normalizedHtml, portabilityReport: report, createdAt: new Date() };
    this.store.versions.set(version.id, version);
    return version;
  }

  updateDraftVersion(id: string, rawHtml: string): ContentVersion {
    const version = required(this.store.versions.get(id), "Content version");
    if (version.state !== "DRAFT" && version.state !== "PREVIEW") throw new Error("Published and archived versions are immutable. Create a new draft revision instead.");
    const { normalizedHtml, report } = analyzeHtml(rawHtml);
    const updated: ContentVersion = { ...version, rawHtml, normalizedHtml, portabilityReport: report };
    this.store.versions.set(id, updated);
    return updated;
  }

  publishVersion(id: string): ContentVersion {
    const version = required(this.store.versions.get(id), "Content version");
    if (version.state === "ARCHIVED") throw new Error("Archived versions cannot be published.");
    const previous = this.store.versionsForVariant(version.variantId).find((item) => item.state === "PUBLISHED");
    if (previous) this.store.versions.set(previous.id, { ...previous, state: "ARCHIVED" });
    const published: ContentVersion = { ...version, state: "PUBLISHED", publishedAt: new Date() };
    this.store.versions.set(id, published);
    const variant = required(this.store.variants.get(version.variantId), "Variant");
    this.store.variants.set(variant.id, { ...variant, publishedVersionId: published.id });
    return published;
  }

  createExperiment(stepId: string, allocations: Array<{ variantId: string; weightBasisPoints: number }>): Experiment {
    const step = required(this.store.steps.get(stepId), "Step");
    if (step.kind === "CHECKOUT_HANDOFF") throw new Error("Shopify checkout handoff cannot be A/B tested.");
    if (this.store.values(this.store.experiments).some((experiment) => experiment.stepId === stepId)) throw new Error("This step already has an experiment.");
    this.assertAllocations(stepId, allocations);
    const experiment: Experiment = { id: this.store.id(), stepId, status: "RUNNING", allocationVersion: 1, createdAt: new Date() };
    this.store.experiments.set(experiment.id, experiment);
    for (const allocation of allocations) {
      const id = this.store.id();
      this.store.allocations.set(id, { id, experimentId: experiment.id, ...allocation });
    }
    return experiment;
  }

  setAllocations(experimentId: string, allocations: Array<{ variantId: string; weightBasisPoints: number }>): Experiment {
    const experiment = required(this.store.experiments.get(experimentId), "Experiment");
    this.assertAllocations(experiment.stepId, allocations);
    for (const allocation of this.store.allocationsForExperiment(experimentId)) this.store.allocations.delete(allocation.id);
    for (const allocation of allocations) {
      const id = this.store.id();
      this.store.allocations.set(id, { id, experimentId, ...allocation });
    }
    const updated = { ...experiment, allocationVersion: experiment.allocationVersion + 1 };
    this.store.experiments.set(experimentId, updated);
    return updated;
  }

  assignVariant(shopId: string, visitorKey: string, experimentId: string): Assignment {
    const experiment = required(this.store.experiments.get(experimentId), "Experiment");
    if (experiment.status !== "RUNNING") throw new Error("Only running experiments assign variants.");
    const visitor = this.findOrCreateVisitor(shopId, visitorKey);
    const assignmentKey = `${visitor.id}:${experimentId}`;
    const existing = this.store.assignments.get(assignmentKey);
    if (existing) return existing;
    const allocations = this.store.allocationsForExperiment(experimentId).sort((a, b) => a.variantId.localeCompare(b.variantId));
    const bucket = Number.parseInt(sha256(`${visitor.anonymousKeyHash}:${experimentId}:${experiment.allocationVersion}`).slice(0, 12), 16) % BASIS_POINTS_TOTAL;
    let cursor = 0;
    const selected = allocations.find((allocation) => { cursor += allocation.weightBasisPoints; return bucket < cursor; }) ?? allocations.at(-1);
    const assignment: Assignment = { id: this.store.id(), visitorId: visitor.id, experimentId, variantId: required(selected, "Experiment allocation").variantId, allocationVersion: experiment.allocationVersion, assignedAt: new Date() };
    this.store.assignments.set(assignmentKey, assignment);
    return assignment;
  }

  ingestEvent(input: SyntheticEventInput): { event: FunnelEvent; duplicate: boolean; orderAttribution?: OrderAttribution } {
    const duplicate = this.store.events.get(input.eventKey);
    if (duplicate) return { event: duplicate, duplicate: true };
    if (input.name === "FUNNEL_CTA_CLICKED") this.assertPriorEntry(input);
    if (input.name === "CART_CHECKOUT_STARTED") required(input.checkoutToken, "checkoutToken");
    if (input.name === "CHECKOUT_COMPLETED_OBSERVED" && !input.checkoutToken && !input.orderGid) throw new Error("Observed checkout completion requires a checkout token or order ID.");
    if (input.name === "SHOPIFY_ORDER_PAID") { required(input.orderGid, "orderGid"); required(input.currency, "currency"); if (input.grossAmount === undefined) throw new Error("grossAmount is required."); }
    const event: FunnelEvent = {
      id: this.store.id(), shopId: input.shopId, eventKey: input.eventKey, name: input.name,
      source: input.source ?? "LOCAL_SYNTHETIC", occurredAt: input.occurredAt ?? new Date(), receivedAt: new Date(),
      visitorId: input.visitorId, funnelId: input.funnelId, stepId: input.stepId, variantId: input.variantId,
      checkoutToken: input.checkoutToken, utmSource: input.utmSource, utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign, deviceClass: input.deviceClass, payload: input.payload ?? {}, isTest: input.isTest ?? true,
    };
    this.store.events.set(event.eventKey, event);
    if (event.name === "CART_CHECKOUT_STARTED") this.captureCheckout(event);
    if (event.name !== "SHOPIFY_ORDER_PAID") return { event, duplicate: false };
    return { event, duplicate: false, orderAttribution: this.attributePaidOrder(event, input) };
  }

  ingestShopifyIntegrationEvent(shopId: string, event: ShopifyIntegrationEvent): { event: FunnelEvent; duplicate: boolean; orderAttribution?: OrderAttribution } {
    const input: SyntheticEventInput = {
      shopId,
      eventKey: event.eventKey,
      name: event.name,
      source: event.source,
      isTest: true,
      occurredAt: event.occurredAt,
      visitorId: event.visitorId,
      funnelId: event.funnelId,
      stepId: event.stepId,
      variantId: event.variantId,
      checkoutToken: event.checkoutToken,
      orderGid: event.orderGid,
      currency: event.currency,
      grossAmount: event.grossAmount,
      payload: event.payload,
    };
    return this.ingestEvent(input);
  }

  revenueForFunnel(funnelId: string): number { return this.store.values(this.store.orderAttributions).filter((order) => order.funnelId === funnelId).reduce((sum, order) => sum + order.netRevenueAmount, 0); }

  private assertAllocations(stepId: string, allocations: Array<{ variantId: string; weightBasisPoints: number }>): void {
    if (allocations.length < 2) throw new Error("An experiment needs at least two variants.");
    if (allocations.reduce((sum, item) => sum + item.weightBasisPoints, 0) !== BASIS_POINTS_TOTAL) throw new Error("Allocation weights must total 10,000 basis points.");
    const variants = new Set(this.store.variantsForStep(stepId).map((variant) => variant.id));
    if (allocations.some((item) => !variants.has(item.variantId) || !Number.isInteger(item.weightBasisPoints) || item.weightBasisPoints <= 0)) throw new Error("Every allocation must reference a step variant with a positive whole-number weight.");
  }

  private findOrCreateVisitor(shopId: string, visitorKey: string): Visitor {
    const anonymousKeyHash = sha256(visitorKey);
    const existing = this.store.values(this.store.visitors).find((visitor) => visitor.shopId === shopId && visitor.anonymousKeyHash === anonymousKeyHash);
    if (existing) return existing;
    const visitor: Visitor = { id: this.store.id(), shopId, anonymousKeyHash, createdAt: new Date() };
    this.store.visitors.set(visitor.id, visitor);
    return visitor;
  }

  private assertPriorEntry(input: SyntheticEventInput): void {
    const entered = this.store.values(this.store.events).some((event) => event.name === "FUNNEL_STEP_ENTERED" && event.visitorId === input.visitorId && event.stepId === input.stepId);
    if (!entered) throw new Error("CTA click requires a prior step-entry event for the same visitor and step.");
  }

  private captureCheckout(event: FunnelEvent): void {
    const token = required(event.checkoutToken, "checkoutToken");
    if (this.store.checkoutAttributions.has(token)) return;
    this.store.checkoutAttributions.set(token, { id: this.store.id(), shopId: event.shopId, checkoutToken: token, visitorId: event.visitorId, funnelId: event.funnelId, lastStepId: event.stepId, lastVariantId: event.variantId, startedAt: event.occurredAt, confidence: event.funnelId && event.variantId ? "HIGH" : "LOW" });
  }

  private attributePaidOrder(event: FunnelEvent, input: SyntheticEventInput): OrderAttribution {
    const existing = this.store.values(this.store.orderAttributions).find((order) => order.shopifyOrderGid === input.orderGid);
    if (existing) return existing;
    const checkout = input.checkoutToken ? this.store.checkoutAttributions.get(input.checkoutToken) : undefined;
    const order: OrderAttribution = { id: this.store.id(), shopId: event.shopId, shopifyOrderGid: required(input.orderGid, "orderGid"), checkoutToken: input.checkoutToken, funnelId: checkout?.funnelId, variantId: checkout?.lastVariantId, currency: required(input.currency, "currency"), grossAmount: required(input.grossAmount, "grossAmount"), netRevenueAmount: required(input.grossAmount, "grossAmount"), paidAt: event.occurredAt, confidence: checkout?.funnelId ? checkout.confidence : "UNATTRIBUTED", isTest: event.isTest };
    this.store.orderAttributions.set(order.id, order);
    return order;
  }
}
