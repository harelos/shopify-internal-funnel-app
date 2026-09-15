# הראשונות — a customer club for this store

## The number the club exists to move

**324 of 2,663 subscribers have ordered more than once. That is 12%.**

Everything below is aimed at that one figure. Not at rewarding the loyal, who
are already loyal, but at converting first-time buyers into second-time buyers.
At AOV ₪178, moving 12% to 20% is roughly **+213 repeat customers and +₪38,000
a year**, before any increase in frequency.

---

## What Rihanna actually does

Fenty runs **Fenty Fam**, and four mechanics do the work:

1. **A name, not a points balance.** You are in the Fam. Identity, not currency.
2. **Early access to drops** before they reach anyone else. Fenty calls these
   "money-can't-buy" rewards, and they cost the brand nothing.
3. **A fixed monthly date.** A 15% member code lands on the **second Tuesday of
   every month**, every month. Predictable enough to become a habit.
4. **A birthday reward** in the member's birthday month.

Sephora's Beauty Insider adds the structural insight that matters most here:
**beauty is consumable**, so the highest-value mechanic is not points at all, it
is **replenishment** — being the place the refill is bought from. Sephora's
members spend 2 to 3 times what non-members do.

**What does not transfer.** Fenty's app gamification, AR try-on and quizzes.
Sephora's three spend tiers. A points ledger of any kind: with 324 repeat
customers the complexity is not earned, and every points app is a monthly fee
against a problem that a fixed date and free shipping solve for nothing.

---

## The club

### Name
**הראשונות.** Not "מועדון לקוחות", which describes a mechanism rather than a
membership. הראשונות says the benefit out loud: members see everything first.
It works in a subject line, on a badge, and spoken aloud.

### Joining
Free, automatic with the first order. No form, no separate sign-up. A customer
who buys is in.

### What members get

**1 · 48 שעות לפני.** Every new product and every promotion opens to members two
days before anyone else. This is the Fenty mechanic and it is the cheapest thing
on the list: it costs nothing and it is the only benefit a non-member cannot buy.
The store now has a real drop cadence to attach it to, which it did not have
three weeks ago.

**2 · ה-11 בכל חודש.** One members-only offer, on the 11th, every month. Fixed
date, no exceptions, no announcement needed after the first few months. Fenty
uses the second Tuesday; a fixed number is easier to hold in Hebrew and easier
to say. This is the habit-former, and the reason to stay subscribed in a month
with no other reason.

**3 · משלוח חינם, תמיד.** At an AOV of ₪178, shipping is the largest remaining
friction on a second order. Removing it permanently for members is worth more
than a discount of the same value, because it applies to the small refill order
as well as the large one, and the small refill order is exactly the behaviour
the club is trying to create.
*Price this against your actual per-parcel cost before committing.*

**4 · מתנה בהזמנה השלישית.** Not the first. Rewarding order one does nothing
for a 12% repeat rate, because order one already happened. Order three is where
a customer stops being a buyer and becomes a habit, and it is the cheapest place
in the whole funnel to spend a gift. The gift should be a real product from the
catalogue, not a sample: the hand cream at ₪45 or the comb set at ₪49.

### The replenishment engine

This is the Sephora lesson and it is the part that earns the most.

Every product page already carries how long the product lasts, because I wrote
it into the copy from the real volumes:

| product | lasts | reminder at |
|---|---|---|
| שמפו צבע 200 מ"ל | 8 to 12 colour washes | 5 weeks |
| מסכת קרטין 47 גרם | about 3 treatments | 3 weeks |
| שמן ארגן 100 מ"ל | months at 3 drops | 10 weeks |
| שמן בטאנה 50 מ"ל | 6 to 8 weekly treatments | 7 weeks |
| סרום קרקפת 30 מ"ל | daily use | 6 weeks |
| ספריי כיסוי שורשים 75 מ"ל | 2 to 3 months | 9 weeks |

A Shopify Messaging **automation** fires at that interval after the order, to
that customer, about that product. One line: the bottle is about finished, here
it is again.

Two reasons this is the best thing in the document. It is an **automation, not a
campaign**, so it runs forever without anyone scheduling it and without eating
the monthly campaign allowance the same way. And it arrives at the one moment
the customer actually wants to hear from the store.

---

## What it takes to build

**Needs nothing new:**
- the 48-hour early access (publish to a members-only collection first, or just
  send the email two days earlier)
- the 11th-of-the-month offer (a discount code, a segment, a recurring automation)
- the replenishment automations (Shopify Messaging → Automations → Create)

**Needs a customer tag:**
- free shipping for members and the third-order gift both need members
  identified. **Shopify Flow** (free) can tag a customer `club` when their order
  count reaches 1, and `club-plus` at 3. Then an automatic discount limited to
  that tag does the rest.

**Deliberately not building:**
- a points app. Monthly fee, a balance nobody checks, and it solves a problem
  this store does not yet have.
- tiers beyond the two. 324 repeat customers cannot support three.

---

## Suggested launch

Not in September. The catalogue relaunch and thirteen daily sends are already
running, and a club launched into that noise gets ignored.

**1 October**, as the thing that follows the promotion: the sale ends, the club
begins, and the first members-only offer lands on **11 October**. That gives the
club a reason to exist on day one rather than being an announcement about a
future benefit.

---

## The one measurement

Repeat rate, checked monthly, for members against non-members. Not sign-ups, not
email opens. If the club is working, members buy a second time more often than
non-members do, and the gap widens. If after three months the gap is not there,
the benefits are wrong and no amount of promotion will fix that.

Today's baseline, to measure against: **12%**.
