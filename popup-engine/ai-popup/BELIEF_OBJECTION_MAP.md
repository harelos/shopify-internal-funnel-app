# BELIEF / OBJECTION MAP — NovaHair AI Concierge (exit conversation)

PAGE: AI exit-intent concierge, mobile-first, Hebrew, women 18-65 IL
PRIMARY BELIEF SHIFT: "צביעת שורשים בבית היא פשרה" → "זו עבודה אחרת מהמספרה, ואפשר לעשות אותה טוב בבית בין התורים"

## BARRIER TABLE

| BARRIER | TYPE | CURRENT BELIEF | DESIRED BELIEF | BEST ANSWER FORM | PROOF | LOCATION | STATUS |
|---|---|---|---|---|---|---|---|
| לא אדע לבחור גוון | FIT GAP | "אני אפספס ויראה נורא" | "אפשר לצמצם את זה בשניות" | guided choice | photo match + swatch card | `shade_*` | built |
| זה יקר | ECONOMIC | "מוצר מול לא לעשות כלום" | "מול תחזוקה חוזרת" | fair comparison | cost card | `price_*` | built |
| לא יכסה שיבה | VEHICLE | "בבית לא באמת מכסה" | "בנוי לשורשים בין תורים" | mechanism + honest limit | roots card | `proof_roots` | built |
| ייראה מלאכותי | VEHICLE | "רואים מרחוק שצבעתי" | "התוצאה מתמזגת" | demonstration | shade discs | `proof_roots` | built |
| לא אצליח לבד | SKILL GAP | "זה מסובך ומלכלך" | "שלושה שלבים" | steps | how card | `proof_how` | built |
| מי אתם בכלל | TRUST GAP | "עוד מותג באינטרנט" | "יש עם מי לדבר" | named human + escalation | advisor identity | header + `escalate` | built |
| אני לקוחה ויש לי בעיה | FRICTION | — | — | **do not sell. route out** | Shopify contact | `escalate` | built |
| אני עוד חושבת | INERTIA | "אין סיבה עכשיו" | "אפשר לצאת עם משהו בידיים" | low-risk choice | guide/coupon | `graceful` | built |

## THREE-BELIEF CORE

- **VEHICLE**: צבע שורשים בבית פותר עבודה מוגדרת, לא מחליף מספרה.
- **INTERNAL**: אני מסוגלת לבחור גוון ולבצע בלי להסתבך.
- **EXTERNAL**: זה נכנס לשגרה שלי בלי לתאם כלום מראש.

## SPIN MAP (internal planner — NOT a script to read aloud)

- **SITUATION**: צובעת במספרה, השורשים חוזרים תוך שבועות.
- **PROBLEM**: החלון שבין הצבע לתור הבא הוא התקופה שהיא הכי לא אוהבת איך שהיא נראית.
- **IMPLICATION**: התלות בתור, בזמן ובזמינות של מישהו אחר. זה חוזר כל חודש.
- **NEED-PAYOFF**: שליטה על מתי זה קורה, בלי לתאם.

Per §4 and §20 of the skill: the Implication is **stated as an observation**, never asked as a rhetorical question. In a chat, real branching questions are the medium, but leading questions read as manipulative and get one shot each.

## SELF-PERSUASION SEQUENCE (§5)

1. RECOGNITION — `situation` names the in-between window she already lives in.
2. STATUS-QUO DISADVANTAGE — `implication` states the recurring cost once, flatly.
3. INFERENCE SPACE — no conclusion is drawn for her; the branch buttons let her draw it.
4. CREDIBLE ALTERNATIVE — `proof_*` with an explicit honest limit (§19 Pattern E).
5. LOW-RISK CHOICE — every node keeps an exit that costs her nothing.

## REACTANCE GUARDRAIL (§7) — what was REMOVED from the original brief

The original concept proposed behaviour-mirroring lines:

> "I noticed you spent time looking at the product but didn't move forward."
> "Let me guess — you're probably leaving because…"

**Both are cut.** Surveillance-flavoured openers are the single fastest way to feel creepy, and the "let me guess" gambit is a fake-binary that triggers reactance. The engine knows her scroll depth and dwell time; the conversation must never reveal that it does.

## FINAL UNRESOLVED BARRIER

Trust. It is answered structurally, not with copy: a named advisor, an honest limit stated out loud, no fake scarcity, and a real escalation path for anyone who is already a customer.
