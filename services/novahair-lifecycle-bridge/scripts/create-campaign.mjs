// Creates a segment and a campaign in production by running the real campaign
// code against the production D1 over its HTTP API.
//
//   node scripts/create-campaign.mjs verify   -> audience is the owner only
//   node scripts/create-campaign.mjs real     -> the lapsed NovaHair buyers
//
// Creating a campaign leaves it in DRAFT. Pass --approve to build the audience
// and release it to cron, which is the step that eventually sends mail.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { productionEnv } from "./remote-d1.mjs";
import { saveSegment, countSegment, parseSegmentFilter, previewSegment } from "../src/segments.ts";
import { createCampaign, approveCampaign, getCampaign } from "../src/campaigns.ts";

const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const html = readFileSync(join(root, "content", "campaign-lapsed-novahair.html"), "utf8");

const mode = process.argv[2] ?? "verify";
const approve = process.argv.includes("--approve");
const env = productionEnv();

const PLANS = {
  // Engagement score 100 with 5+ orders is the shop owner and nobody else.
  verify: {
    segmentName: "Internal send check",
    description: "The owner only. Used to prove the pipeline end to end before a real send.",
    filter: { minScore: 100, minOrders: 5 },
    campaignName: "Send check lapsed novahair",
    subject: "{{FIRST_NAME}}, השורשים תמיד חוזרים",
  },
  real: {
    segmentName: "Lapsed NovaHair 60d",
    description: "Bought a NovaHair product, no order in the last 60 days, still reachable.",
    filter: { novahairBuyer: true, lastOrderOlderThanDays: 60 },
    campaignName: "Lapsed NovaHair reintroduction",
    subject: "{{FIRST_NAME}}, השורשים תמיד חוזרים",
  },
};

const plan = PLANS[mode];
if (!plan) throw new Error(`unknown mode ${mode}`);

const filter = parseSegmentFilter(plan.filter);
const count = await countSegment(env, filter);
const preview = await previewSegment(env, filter, new Date(), 5);
console.log(`mode:      ${mode}`);
console.log(`filter:    ${JSON.stringify(filter)}`);
console.log(`audience:  ${count}`);
console.log("sample:");
for (const person of preview.sample) {
  console.log(`  ${person.email}  name=${person.firstName ?? "-"} orders=${person.orderCount} score=${person.engagementScore} last=${person.lastOrderAt ?? "-"}`);
}

if (process.argv.includes("--dry-run")) {
  console.log("\ndry run, nothing written");
  process.exit(0);
}

const segment = await saveSegment(env, {
  name: plan.segmentName,
  description: plan.description,
  filter: plan.filter,
  createdBy: "AGENT",
});
console.log(`\nsegment:   ${segment.segmentId} (${segment.count} people)`);

// The sender renders {{FIRST_NAME}} in the subject per recipient, so it is
// stored with the placeholder intact.
const subject = plan.subject;

const created = await createCampaign(env, {
  name: plan.campaignName,
  segmentId: segment.segmentId,
  subject,
  preheader: "כתבתי לך כי הזמנת מאיתנו פעם, ורציתי להזכיר מה יש אצלנו.",
  html,
  ctaUrl: "https://tigerbrandsglobal.com/pages/novahair-sales-staging",
  kind: "marketing",
  proposedBy: "AGENT",
  proposalReason: plan.description,
});
console.log(`campaign:  ${created.campaignId}`);
console.log(`subject:   ${subject}`);
console.log(`status:    ${created.status}  estimate=${created.audienceEstimate}`);

if (!approve) {
  console.log("\nleft in DRAFT. Nothing will send until it is approved.");
  process.exit(0);
}

const approved = await approveCampaign(env, created.campaignId, "harel");
const row = await getCampaign(env, created.campaignId);
console.log(`\napproved:  ${approved.recipients} recipients frozen, status=${row.status}`);
console.log("cron will send it in batches on the next tick.");
