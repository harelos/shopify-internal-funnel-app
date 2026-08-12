import { randomUUID } from "node:crypto";
import type { Assignment, CheckoutAttribution, ContentVersion, Experiment, ExperimentAllocation, Funnel, FunnelEvent, OrderAttribution, Shop, Step, Variant, Visitor } from "./types.js";

export class LocalStore {
  readonly shops = new Map<string, Shop>();
  readonly funnels = new Map<string, Funnel>();
  readonly steps = new Map<string, Step>();
  readonly variants = new Map<string, Variant>();
  readonly versions = new Map<string, ContentVersion>();
  readonly experiments = new Map<string, Experiment>();
  readonly allocations = new Map<string, ExperimentAllocation>();
  readonly visitors = new Map<string, Visitor>();
  readonly assignments = new Map<string, Assignment>();
  readonly events = new Map<string, FunnelEvent>();
  readonly checkoutAttributions = new Map<string, CheckoutAttribution>();
  readonly orderAttributions = new Map<string, OrderAttribution>();

  id(): string { return randomUUID(); }
  values<T>(map: Map<string, T>): T[] { return [...map.values()]; }
  assignmentsForExperiment(experimentId: string): Assignment[] { return this.values(this.assignments).filter((item) => item.experimentId === experimentId); }
  variantsForStep(stepId: string): Variant[] { return this.values(this.variants).filter((item) => item.stepId === stepId); }
  versionsForVariant(variantId: string): ContentVersion[] { return this.values(this.versions).filter((item) => item.variantId === variantId); }
  allocationsForExperiment(experimentId: string): ExperimentAllocation[] { return this.values(this.allocations).filter((item) => item.experimentId === experimentId); }
  stepsForFunnel(funnelId: string): Step[] { return this.values(this.steps).filter((item) => item.funnelId === funnelId).sort((a, b) => a.position - b.position); }
}
