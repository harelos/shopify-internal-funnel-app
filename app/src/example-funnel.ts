import { FunnelService } from "./funnel-service.js";
import type { Funnel, Shop, Step, Variant } from "./types.js";

export interface ExampleFunnel {
  funnel: Funnel;
  presell: { step: Step; advertorial: Variant; listicle: Variant };
  sales: { step: Step; storyProof: Variant; offerValue: Variant };
  checkout: Step;
}

const advertorialHtml = `<article data-example-copy="advertorial"><p class="eyebrow">EDITORIAL NOTE</p><h1>The small detail that can make a football shirt feel like yours</h1><p><strong>The shirt in the wardrobe was not the problem. It was the feeling that it could have belonged to anybody.</strong></p><p>The scarf comes out. The same jacket goes on. The group chat fills with predictions. But when the matchday photo happens, there is nothing in the outfit that carries the story of the day.</p><h2>What changes when the detail is personal?</h2><p>Choose the available style, size, name, and number, check the details, then continue to Shopify checkout. The shirt becomes something you can explain without saying a word.</p><ul><li>Available style: [OWNER TO CONFIRM]</li><li>Size and fit: [OWNER TO CONFIRM]</li><li>Name and number: [OWNER TO CONFIRM]</li><li>Delivery and returns: [OWNER TO CONFIRM]</li></ul><a href="#sales">See the shirt, choose my name and number</a></article>`;
const listicleHtml = `<article data-example-copy="listicle"><p class="eyebrow">7-REASONS LISTICLE</p><h1>7 reasons supporters are choosing a more personal matchday shirt</h1><p>The difference between a shirt you own and a shirt you remember is often one small detail.</p><ol><li><strong>It becomes your shirt.</strong> The same colours feel different when the back carries your name or a number with a story.</li><li><strong>It makes a clearer gift.</strong> Choose a detail connected to the supporter who will wear it.</li><li><strong>It belongs in the photo.</strong> A personal detail keeps the shirt from disappearing into the crowd.</li><li><strong>The options are visible.</strong> Review style, size, personalisation, and terms before payment.</li><li><strong>It fits different stories.</strong> Surname, favourite number, special year, or your own name.</li><li><strong>The offer is clearer.</strong> Price, personalisation, and shipping should not appear as surprises.</li><li><strong>The reason is yours.</strong> The strongest detail is the one only you can explain.</li></ol><a href="#sales">Show me the available shirts</a></article>`;
const storyProofHtml = `<article data-example-copy="sales-story-proof"><p class="eyebrow">SALES PAGE / STORY AND PROOF</p><h1>The shirt that carries your matchday detail</h1><p>You are choosing the available style, size, name, and number, reviewing the exact price, and continuing through Shopify checkout.</p><h2>Choose your shirt</h2><p>Style: [AVAILABLE OPTIONS]</p><p>Size: [SIZE RANGE]</p><p>Name and number: [PERSONALISATION RULE]</p><p>Price: [VERIFIED PRICE]</p><p>Shipping and returns: [OWNER TO CONFIRM]</p><h2>What happens next</h2><ol><li>Select the shirt and size.</li><li>Add the name and number, then review.</li><li>Continue to native Shopify checkout.</li></ol><p>Verified reviews, customer photos, and policy details appear here after owner approval. This example does not invent proof.</p><a href="#checkout">Choose my shirt and continue</a></article>`;
const offerValueHtml = `<article data-example-copy="sales-offer-value"><p class="eyebrow">SALES PAGE / OFFER AND VALUE</p><h1>One shirt. Your detail. No guesswork.</h1><h2>Your order can include</h2><ul><li>[SHIRT STYLE]</li><li>[SIZE]</li><li>[NAME]</li><li>[NUMBER]</li></ul><p><strong>[VERIFIED TOTAL]</strong></p><p>Personalisation: [INCLUDED OR VERIFIED ADD-ON]. Shipping: [VERIFIED TERMS].</p><h2>Why choose the personalised version?</h2><p><strong>A clearer gift.</strong> Choose a name or number connected to the person.</p><p><strong>A stronger memory.</strong> The shirt carries a detail you recognise when you wear it again.</p><p><strong>A simpler decision.</strong> Options and policies are visible before the handoff.</p><a href="#checkout">Build my shirt</a></article>`;

function variant(service: FunnelService, stepId: string, name: string, html: string): Variant {
  const created = service.createVariant(stepId, name);
  service.importHtml(created.id, html);
  return created;
}

export function seedExampleFunnel(service: FunnelService, shop: Shop): ExampleFunnel {
  const existing = service.listFunnels(shop.id).find((item) => item.slug === "custom-matchday-shirt-example");
  if (existing) {
    const steps = service.store.stepsForFunnel(existing.id);
    const presellStep = steps.find((item) => item.kind === "ADVERTORIAL")!;
    const salesStep = steps.find((item) => item.kind === "SALES")!;
    const checkout = steps.find((item) => item.kind === "CHECKOUT_HANDOFF")!;
    const presellVariants = service.store.variantsForStep(presellStep.id);
    const salesVariants = service.store.variantsForStep(salesStep.id);
    return { funnel: existing, presell: { step: presellStep, advertorial: presellVariants[0]!, listicle: presellVariants[1]! }, sales: { step: salesStep, storyProof: salesVariants[0]!, offerValue: salesVariants[1]! }, checkout };
  }

  const funnel = service.createFunnel(shop.id, "Example: Custom Matchday Shirt", "custom-matchday-shirt-example");
  const presellStep = service.addStep(funnel.id, "Pre-sell: Advertorial vs. 7 Reasons", "ADVERTORIAL");
  const advertorial = variant(service, presellStep.id, "A · Advertorial", advertorialHtml);
  const listicle = variant(service, presellStep.id, "B · 7 Reasons Listicle", listicleHtml);
  service.createExperiment(presellStep.id, [{ variantId: advertorial.id, weightBasisPoints: 5_000 }, { variantId: listicle.id, weightBasisPoints: 5_000 }]);

  const salesStep = service.addStep(funnel.id, "Sales page: Story vs. Offer", "SALES");
  const storyProof = variant(service, salesStep.id, "A · Story & Proof", storyProofHtml);
  const offerValue = variant(service, salesStep.id, "B · Offer & Value", offerValueHtml);
  service.createExperiment(salesStep.id, [{ variantId: storyProof.id, weightBasisPoints: 5_000 }, { variantId: offerValue.id, weightBasisPoints: 5_000 }]);

  const checkout = service.addStep(funnel.id, "Checkout handoff: Native Shopify", "CHECKOUT_HANDOFF");
  return { funnel, presell: { step: presellStep, advertorial, listicle }, sales: { step: salesStep, storyProof, offerValue }, checkout };
}
