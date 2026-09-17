# Free & Near-Free LLM API Pool — NovaHair Concierge

Research compiled 2026-09-02. Every figure below comes from a 2026 source and
should be re-verified before you commit: free tiers move constantly (Google cut
its free quota 50-80% in Dec 2025, GitHub Models is being retired).

## What actually matters for THIS use case

The concierge is a special case that changes the ranking:

- **Prompt is ~1.7K tokens, replies are ~60 tokens.** Cheap and short. An 8K
  free context cap (Cerebras) is fine here, though it would not be for long chats.
- **Shopper free text passes through the model.** Any provider that trains on
  inputs is a privacy problem, not just a quality one.
- **It is a real store (commercial use).** This disqualifies "non-commercial
  only" and "evaluation only" free tiers for production, however good they are.
- **Latency is felt live**, mid-conversation. Time-to-first-token matters more
  than raw throughput.

## Compliance note

Only providers with public, official free tiers are listed. Signup uses your own
authorized accounts. No leaked keys, no quota-bypass, no shared/among-users
credentials. Commercial-use and data-training flags are called out per row
because they are the ones that bite a live store.

---

## TIER 1 — recurring free quota, commercial-safe, fast (the routing pool)

| Provider | Best free model(s) | Free allowance | Rate limit | Speed | Ctx (free) | OpenAI-compat | CC | Commercial | Trains on your data |
|---|---|---|---|---|---|---|---|---|---|
| **Groq** | Llama 3.3 70B, Llama 4 Scout/Maverick, Kimi K2, GPT-OSS 120B | ~1,000 RPD/model | 30 RPM, 6-12K TPM | ~320 tok/s, very low TTFT | 128K | Yes | No | Yes | No |
| **Cerebras** | GPT-OSS 120B, GLM-4.7, Llama 3.3 70B, Qwen3 | ~1M tokens/day | 5-30 RPM, 60K TPM | ~1,000-1,800 tok/s (fastest) | 8K cap | Yes | No | Yes | No |
| **Scaleway** | Mistral, Llama, Qwen (EU-hosted) | 1M tokens (one-time-ish) | moderate | medium | up to 128K | Yes | No | Yes (GDPR) | No |
| **Cloudflare Workers AI** | Llama 3.x/4, Qwen, Gemma, GPT-OSS (~80) | 10,000 neurons/day (shared) | high | medium | 2K-24K | Partial | No | Yes | No |
| **OpenRouter** | glm-5.3-flash (paid, ~$0.00012/turn); free ladder | 50 free/day, 1,000/day after $10 top-up | 20 RPM | varies | up to 1M | Yes | No | Yes | No |

**Cloudflare is special for you:** you already run a Cloudflare Worker
(`shopify-funnel-control`). Workers AI is callable from inside it with an
`env.AI` binding — no extra key, no extra network hop, lowest possible latency.
Worth a live test as a rung.

---

## TIER 2 — free but with a real catch (use with eyes open)

| Provider | Model(s) | Free allowance | The catch |
|---|---|---|---|
| **Google Gemini (AI Studio)** | Gemini 3 Flash, 2.5 Flash/Flash-Lite | 250-1,500 RPD, 1M ctx | **Trains on free-tier inputs.** Commercial OK only outside EU/UK/EEA. Great model, but shopper messages would feed Google. |
| **Mistral La Plateforme** | Small 3.1, Large, Codestral | ~1B tokens/month | Free tier ~1 RPM and requires **data-training opt-in**. Too slow + privacy cost. |
| **NVIDIA NIM (build.nvidia.com)** | 50+ (Llama, Mistral, Qwen, Nemotron) | 40 RPM | **Hosted tier is dev/eval only.** Production needs NVIDIA AI Enterprise. Fine for testing, not for the live store. |
| **Cohere** | Command A / R+ | 20 RPM, 1,000/mo | **Non-commercial only.** Disqualified for a store. |
| **Zhipu GLM Flash** | GLM-4.7-Flash, 4.6V-Flash (vision) | undocumented | Chinese provider; check data-residency terms before shopper PII flows through. |
| **Hugging Face router** | 200+ across 19 backends via one endpoint | ~$0.10/mo free | Free credit is tiny, but it is ONE OpenAI-compatible key that reaches Groq/Cerebras/Together/Fireworks/SambaNova. Good as a fallback aggregator. |

---

## TIER 3 — introductory credits (one-off eval, NOT a sustainable pool)

| Provider | Grant | Notes |
|---|---|---|
| **Together AI** | up to $100 signup (varies); $15-50K startup program | 200+ models. Real option if you apply to the startup program. |
| **SambaNova** | free dev tier + ~$5 | Only free tier serving **Llama 405B**; fast RDU hardware. |
| **DeepSeek** | 5-10M tokens one-time | Then pay. Strong models, cheap after. |
| **Fireworks / Hyperbolic / Nebius** | signup credits | Fast inference, credits run out. |
| **Vercel AI Gateway** | signup credits + one key to many providers | Convenient aggregator with a credit grant. |

---

## TIER 4 — community aggregators (treat as untrusted for a real store)

`api.airforce`, `LLM7.io`, `Pollinations`, `UnoRouter`, `AnyAPI`, `Chutes`,
`freellmapi`. These expose free OpenAI-compatible endpoints, sometimes to
premium models. **Do not route shopper PII through them:** data handling is
undocumented, reliability is unknown, and several proxy models in ways whose
terms you cannot verify. Fine for your own throwaway testing, wrong for
customers.

---

## DEAD / retiring

- **GitHub Models** — retiring 2026-07-30. Do not build on it.

---

## Self-hosted (free as in "compute you already pay for")

You run Railway + a Cloudflare Worker already. Options:

- **Cloudflare Workers AI** (above) — closest to zero-effort, no server to run.
- **Ollama / llama.cpp / vLLM** on a Railway box — a small model (Qwen2.5 7B,
  Gemma 2 9B) is enough for this short-prompt task. Fully private, no per-call
  cost, but you own uptime and it is slower without a GPU.
- **Ollama Cloud** — hosted Ollama with a free tier, OpenAI-compatible.

For a concierge whose whole value is *fast* and *private*, a tiny self-hosted
Hebrew-capable model is a legitimate endgame rung.

---

## Recommended pool for the concierge (ranked, ladder order)

1. **Groq** (Llama 3.3 70B or Kimi K2) — fast, commercial, 128K, no training. Primary.
2. **Cerebras** (GPT-OSS 120B) — fastest; 8K context is fine for this prompt. Second.
3. **z-ai/glm-5.3-flash via OpenRouter** — paid but ~$0.12/1000 turns, already
   tested at 1.4s and 4/4 valid. Reliable anchor when free rungs are throttled.
4. **Cloudflare Workers AI** — in-Worker, zero extra hop. Test as a rung.
5. **OpenRouter free ladder** (minimax-m2.7, nemotron-nano) — last-resort free.

Deliberately excluded from the live store: Cohere (non-commercial), NVIDIA NIM
hosted (eval-only), Gemini free (trains on shopper data), all Tier-4 aggregators.

## Latency reality (from 2026 reports, verify live)

Cerebras (~1,000-1,800 tok/s) > Groq (lower throughput but very low TTFT, feels
instant on short replies) > SambaNova > Gemini Flash > OpenRouter (varies by
underlying provider) > HF serverless (slow, cold starts).

## What each rung needs from you

Every one of these is a normal signup with your own email; none needs a credit
card for the free tier. You generate the key in each provider's console:

- Groq: console.groq.com → API Keys
- Cerebras: cloud.cerebras.ai → API Keys
- Google AI Studio: aistudio.google.com → Get API key
- Scaleway: console.scaleway.com → Generative APIs
- Cloudflare: dashboard → Workers AI (or the `env.AI` binding, no key)
- Hugging Face: huggingface.co/settings/tokens
