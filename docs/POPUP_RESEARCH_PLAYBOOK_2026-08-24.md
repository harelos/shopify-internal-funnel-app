# TIGER Popup Research Playbook — 2026-08-24

Status: research input for STAGING experiments only. Nothing in this document authorizes a live discount, fake scarcity, inventory claim, coupon, or storefront deployment.

## Evidence standard

Most public popup case studies are published by popup vendors. They are useful as directional evidence and implementation inspiration, but their reported results are **vendor-reported and not independently audited** unless stated otherwise. We should copy mechanisms, not claims. If a public case-study summary does not disclose a trigger, design detail, audience rule, or offer, this playbook says **not specified** instead of guessing.

## 30 concrete examples

| # | Company | Popup / onsite type | Trigger | Design | Offer / value | Audience | Reported result | Source | Why it likely worked | Reusable principle |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Millie n Me | Smart product recommendation popup | 20s on a product page; visitor had viewed at least 2 product pages | Mobile-friendly modal with dynamic headline + related products | Product discovery, no discount required | Engaged product browsers | 10.25% popup click/conversion; +5.65% revenue; +15.72% ecommerce conversion | https://www.optimonk.com/case-studies/millie-n-me-case-study | Waited for real browsing intent, then reduced choice friction | Do not interrupt immediately; recommend only after behavioral evidence |
| 2 | Lammle's Western Wear | Product recommendations + browsing reminder | Product/category/homepage timing varied; returning-visitor reminder on later session | Contextual recommendation popups | Help finding products, not discounting | New product/category visitors and returning browsers | +23.5% revenue from product-page visitors; +26.3% engaged category shoppers; +17.3% new homepage visitors; +11.9% returning-visitor revenue | https://www.optimonk.com/how-lammles-boosted-online-sales-without-discounting/ | Different context received a different message | Treat popup platform as a routing system, not one universal campaign |
| 3 | BOOM! by Cindy Joseph | Multi-step exit capture + hot-visitor discount | Exit intent after pre-sell engagement; deeper engagement used for hotter segment | Multi-step popup flow | BOOM Club / content; 10% only for hottest visitors | Cold traffic split by observed engagement | $148,297 extra revenue in 30 days; 8,997 subscribers; vendor attributes 18.2% of revenue to popup coupon | https://www.optimonk.com/case-study-how-smart-marketer-boosted-booms-ecommerce-revenue-by-18-percent-using-onsite-retargeting | Secondary offers matched funnel temperature | Discount eligibility should be server-authorized and reserved for defined high-intent segments |
| 4 | eCommerce Fastlane | Timed/scroll lead popup + topic exit popup | 10 seconds OR 15% scroll; separate exit intent on selected articles | Content/offer popup; exit version tailored to article topic | Discount / software offers / trials depending context | Engaged readers and exiting article visitors | 6.02% on timed/scroll campaign; 8.48% on exit campaigns; 3,000+ monthly conversions reported | https://www.optimonk.com/ecommerce-fastlane-case-study | Trigger matched visible engagement instead of instant interruption | Support OR trigger logic and page-specific exit campaigns |
| 5 | Faguo | Lead capture, spin-to-win giveaway, proactive support | Audience/page rules; separate mobile and desktop campaigns | On-brand forest creative; separate device variants; A/B tests | Relevant brand product prize; support guidance | Targeted visitors excluding transactional pages | 5K+ monthly leads; 11x more email leads than prior tool; 4x cheaper acquisition; 17.5% average CTR | https://wisepops.com/customers/faguo | Strong brand fit + device-specific design + exclusions + CRM automation | Templates need brand tokens, device QA, exclusions, and downstream integrations |
| 6 | OddBalls | Lead capture, gamification, recommendations, cart recovery | Multiple behavior/segment rules; separate returning prospects/subscribers | Bright on-brand creative; spin-to-win; recommendation surfaces | Modest discounts, product discovery, launches | New, returning, and existing subscribers separately | £1M+ attributed revenue in six months; 122K+ new leads; 632 purchases from product recommendations; 11% avg CTR | https://wisepops.com/customers/oddballs | Campaign portfolio was segmented rather than generic | Build multiple small contextual campaigns and global frequency arbitration |
| 7 | Blume | New-visitor email/SMS + BOGO/flash promotion | New visitor; campaign swaps during promotions | Mobile-optimized multi-step creative | 20% welcome incentive; BOGO/flash-sale campaigns | First-time mobile + desktop visitors | 5% signup conversion reported | https://wisepops.com/customers/blume | Progressive capture kept the first ask simple and worked on mobile | Email first; SMS only as a later, optional step with separate consent |
| 8 | Mott & Bow | Smart discount list-building popup | Not specified in public summary | Smart discount popup | Discount-for-email | Site visitors | 100,000+ subscribers in six months; 10%+ conversion rate reported | https://www.optimonk.com/reflexshop-case-study/ | Clear value exchange at list scale | Discount capture belongs behind an authorization layer, not hard-coded creative |
| 9 | Nexus Nutrition | Mystery discount, multi-step capture | Not specified in public index | Mystery-discount flow | Discount revealed after engagement | Site visitors | 11.78% email conversion reported | https://www.optimonk.com/case-studies | Curiosity created a micro-commitment before the form | Model reveal mechanics as steps/events; do not use fake “you won” language |
| 10 | Sassy Scents | Conversion popup | Not specified in public index | Not specified | Not specified | Not specified | +25% conversions reported | https://www.optimonk.com/case-studies | Public summary proves outcome, not mechanism | Mark missing implementation facts as unknown instead of reverse-engineering imaginary rules |
| 11 | ParfumeLab | Returning-visitor reminder | Returning visitor | Reminder/personalized continuation | Resume shopping | Returning visitors | +19% returning-visitor sales reported | https://www.optimonk.com/case-studies | Continuity is valuable without a discount | Persist factual browsing context and use it only when it genuinely exists |
| 12 | Craft Spirit Shop | Personalized product recommendation | Behavioral personalization | Product recommendation popup | Relevant products | Browsers with recommendation opportunity | +77.9% revenue reported | https://www.optimonk.com/case-studies | Recommendation adds utility rather than pressure | Product recommender should be a first-class popup type |
| 13 | Selzy | Personalized organic-traffic popup | Organic traffic segment | Personalized popup | Not specified | Organic visitors | +41% popup conversion rate reported | https://www.optimonk.com/case-studies | Acquisition source changed the message | UTM/referrer/source targeting belongs in core engine, not custom code per campaign |
| 14 | Goldelucks | Product-page optimization campaign | Product page context | Not specified | Not specified | Product-page shoppers | +66.2% orders reported in case-study index | https://www.optimonk.com/case-studies | Product-page intent is stronger than generic site traffic | Product/page targeting should be explicit and measurable |
| 15 | Crown & Paw | Three-step ecommerce conversion flow | Not specified in public index | Three-step popup | Progressive value exchange | Ecommerce visitors | 2.5x signup rate reported | https://www.optimonk.com/case-studies | Reduced first-step friction and used progressive commitment | Popup schema should support multi-step flows, even if Phase 1 renders only simple forms |
| 16 | Craft Sportswear NA | SMS acquisition | Not specified in public index | Signup popup | SMS opt-in | Site visitors | 4,088 SMS subscribers; 40.44% sign-up conversion reported | https://www.optimonk.com/case-studies | High-intent value exchange + dedicated capture | Phone collection must be intentional, consented, and separated from general browsing memory |
| 17 | Vegetology | Personalized email signup | Not specified in public index | Personalized signup | Email value exchange | Segmented visitors | +100% signup rate improvement reported | https://www.optimonk.com/case-studies | Personalization improved relevance | Personalization fields need provenance and safe fallbacks |
| 18 | The Turmeric Co. | Email capture | Not specified in public index | Not specified | Email signup value proposition | Site visitors | 10,000+ new email addresses reported | https://www.optimonk.com/case-studies | Large absolute list growth validates lead capture as a durable use case | Track absolute leads and lead quality, not conversion rate alone |
| 19 | Indestructible Shoes | Ecommerce conversion campaign | Not specified in public index | Not specified | Not specified | Ecommerce visitors | +13.2% ecommerce conversion rate reported | https://www.optimonk.com/case-studies | Outcome tied to store conversion, not just popup CTR | Optimize to verified purchase outcome downstream, not vanity interaction metrics |
| 20 | Kiss My Keto | Cart abandonment reduction | Cart/abandonment context | Not specified | Not specified | Cart abandoners | -20% cart abandonment rate reported | https://www.optimonk.com/case-studies | Message was tied to a clear high-intent failure state | Cart rescue needs actual cart context and strict frequency caps |
| 21 | Olive Oil Lovers | Upsell / AOV popup | Product/cart context; details in vendor case study | Upsell recommendation | Complementary/best-selling product incentive | Purchase-intent shoppers | +15% average order value reported | https://www.optimonk.com/case-studies | Relevant adjacent product can outperform generic discounting | Make bundle/cross-sell a dedicated popup type with product restrictions |
| 22 | Obvi | Black Friday conversion popup | Promotional period | Not specified | BFCM offer | Promotional traffic | +25% conversion rate reported | https://www.optimonk.com/case-studies | Campaign aligned to real merchandising event | Campaign dates/offer validity must be server-controlled and expire cleanly |
| 23 | Christopher Cloos | Conversion optimization popup | Not specified in public index | Not specified | Not specified | Site visitors | +37% conversion rate reported | https://www.optimonk.com/case-studies | Result supports testing onsite messages against purchase behavior | Store experiment version + sticky assignment + verified conversion event |
| 24 | SwissWatchExpo | Revenue-focused onsite campaign | Not specified in public index | Not specified | Not specified | Luxury shoppers | +25% revenue reported | https://www.optimonk.com/case-studies | Luxury category can use onsite messaging without defaulting to loud discount UI | Premium stores need calm design templates and revenue metrics, not “coupon popup” aesthetics |
| 25 | BlendJet | Revenue popup / onsite personalization | Not specified in public index | Not specified | Not specified | Ecommerce visitors | +39.2% extra revenue reported | https://www.optimonk.com/case-studies | Revenue lift is the useful outcome | Attribute revenue conservatively and keep popup event data joinable to verified orders |
| 26 | Pierre Hardy | Welcome + AI cart recovery | Timed welcome for first-time visitors; AI-driven exit/cart recovery | Premium multi-step design; category choice | Welcome offer where authorized; cart recovery | First-time visitors and abandoning carts | Wisepops customer index reports 22% attributed revenue | https://wisepops.com/customers | Premium presentation + context-specific recovery | Build premium templates and keep cart rescue separate from welcome capture |
| 27 | Aime | Gamified calendar + personalization + recommendations | Campaign/context dependent | Branded daily gift calendar and personalized experiences | Daily promotion / discovery | Segmented ecommerce visitors | Wisepops customer index reports €300K+ attributed revenue | https://wisepops.com/customers | Gamification was brand/event specific, not generic roulette | Gamification should be a template class with factual offer inventory and date rules |
| 28 | la belle-iloise | Multi-site targeted onsite campaigns | Acquisition/UTM and site context in published case-study summaries | Brand-consistent popups across multiple sites | Contextual campaigns | Visitors across sites/brands | Wisepops customer index reports 7.6% attributed revenue | https://wisepops.com/customers | Central system supported multiple properties while keeping context | Provider-independent config should include shop/site scope and acquisition context |
| 29 | Les Mills | Product-discovery quiz | User intentionally starts/engages quiz | Multi-step quiz | Personalized product/program discovery | Visitors needing help choosing | Customer index reports 36.6% email capture and 9 in 10 quiz engagement | https://wisepops.com/customers | The interaction itself provided value before capture | Quiz/product-finder should give useful value before asking for personal data |
| 30 | Charlotte Bio | Promotional popup / flash-sale execution | Real short promotional window | Campaign creative tied to event | Flash sale | Promotion visitors | Customer index reports 6x sales and 17% of monthly sales attributed to campaigns | https://wisepops.com/customers | Strong message/event alignment | Time windows must reflect a real promotion; never fabricate countdowns or stock pressure |

## Aggregate evidence that should influence the platform

### 1. Timing and behavior matter more than “pretty popup” design

Wisepops' 2026 behavioral-popup research reports click-triggered campaigns as especially strong and URL-targeted popups outperforming untargeted campaigns. The exact rates vary by study/sample, but the engineering implication is robust: **trigger and audience rules belong in the core data model**.

Source: https://wisepops.com/blog/behavioral-popups

### 2. Shopify stores increasingly run several campaigns, not one popup

Wisepops' 2026 study of 500 Shopify stores reports 69% using popups, 38% running more than one campaign, 48% using multi-step campaigns, 41% showing popups on mobile, and only 8% running a separate campaign for returning visitors.

Source: https://wisepops.com/blog/state-of-visitor-engagement-on-shopify-stores

Engineering implication: we need campaign arbitration/frequency rules eventually; a single global modal configuration is not enough.

### 3. Cart recovery needs segmentation and mobile support

Wisepops' 2026 Shopify cart-popup study reports 4,574 recovered orders in its sample, with 79% of recovered orders from mobile. It reports average conversion of 6.88% for its AI-powered cart campaigns vs 2.12% for exit-intent, and 3.80% for cart-value segmented campaigns.

Source: https://wisepops.com/blog/cart-popups-study

Engineering implication: mobile cannot be a desktop afterthought; cart state/value and behavior should be targeting inputs.

### 4. Format depends on funnel stage

Wisepops' 2026 A/B-test analysis across 1.8M sessions reports full-screen desktop capture/CTR improvements in its tests, but an 18% reduction in paid-plan conversions when full-screen treatments were used mid-funnel. Centered popups beat cornered campaigns in the cited tests.

Source: https://wisepops.com/blog/personalized-popup-campaigns

Engineering implication: template format should be selectable by funnel stage; never assume the most visually dominant format is best.

## Platform rules derived from the research

1. **Behavior first.** Page, product, funnel, cart, source, UTM, returning state, time, scroll and inactivity are core inputs.
2. **Sticky experiments.** Visitor assignment must remain stable for a campaign experiment version.
3. **Mobile is first-class.** Preview and QA at ~390px before staging approval.
4. **Progressive capture.** Useful interaction first; email when there is a benefit; phone only for an explicit reason/consent.
5. **No generic discount engine in the browser.** Creative may request an authorized offer, but issuance/eligibility belongs server-side.
6. **No fabricated urgency.** Countdown/stock/“you won” mechanics require real, authorized facts.
7. **Returning visitors deserve different treatment.** Continue/reorder/recommend only from factual history.
8. **Recommendation is a core popup type.** Product discovery can increase revenue without margin erosion.
9. **Frequency arbitration matters.** Multiple campaigns require suppression and caps so the store never becomes a popup maze.
10. **Revenue truth is downstream.** Popup interaction metrics are useful, but purchase/revenue must ultimately come from verified Shopify order events.
11. **Never sacrifice page usability.** Close mechanics are synchronous and local; telemetry is best-effort and asynchronous.
12. **Test mechanisms, not vendor claims.** Every case above becomes a hypothesis in TIGER, not a promised lift.

## Recommended first TIGER experiments after the runtime is proven safe

These are **future staging hypotheses**, not production instructions:

- **Control / no intervention** versus a helpful product-finder prompt after meaningful product-page engagement.
- **Returning browser reminder** showing factual recently viewed products, without a discount.
- **Cart rescue** using actual cart context; start with reassurance/recommendation before requesting any authorized offer.
- **Traffic-source creative** for paid social versus organic search while keeping the underlying product facts identical.
- **Two-step lead capture** where value is delivered before requesting email; phone remains optional and separately consented.

Do not start with a giant sitewide welcome popup. The research favors context, segmentation, and stage-appropriate formats over one universal interruption.
