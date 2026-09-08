"""Live model QA against the real OpenRouter route prompt.

Reads the system prompt straight out of server/ai-concierge.ts so this test can
never drift from what production sends. Cycles through free models because the
free pool is shared and rate-limits upstream.

Usage:
    set OPENROUTER_API_KEY, then:
    python popup-engine/ai-popup/harness/verify_live_model.py
"""
import io
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
ROUTE = ROOT / "app" / "cloudflare-pilot" / "src" / "routes" / "ai-concierge.ts"
MODELS_CACHE = ROOT / "_models.json"
OUT = pathlib.Path(__file__).with_name("_live_results.txt")

ALLOWED = ["root_choice", "shade_open", "shade_photo", "shade_manual", "shade_narrow",
           "shade_result", "price_open", "price_compare", "price_bundle", "proof_roots",
           "proof_how", "offer", "capture", "graceful"]

KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
if not KEY:
    sys.exit("OPENROUTER_API_KEY is not set")


def load_prompt() -> str:
    src = io.open(ROUTE, encoding="utf-8").read()
    m = re.search(r"const SYSTEM_PROMPT = `(.*?)`;", src, re.S)
    if not m:
        sys.exit("could not find SYSTEM_PROMPT in the route")
    return m.group(1).replace('${Array.from(ALLOWED_NEXT).join(", ")}', ", ".join(ALLOWED))


def strip_fence(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
    return re.sub(r"\s*```$", "", s).strip()


def extract_json(raw: str) -> str:
    """Mirrors extractJson() in the route: models often answer in prose and
    then emit the JSON object, so find the first balanced object."""
    s = strip_fence(raw)
    start = s.find("{")
    if start == -1:
        return s
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return s


def salvage(s: str) -> str:
    m = re.search(r'"reply"\s*:\s*"([^"]*)', strip_fence(s))
    return m.group(1) if m else ""


def free_models():
    if MODELS_CACHE.exists():
        data = json.load(io.open(MODELS_CACHE, encoding="utf-8"))["data"]
    else:
        with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30) as r:
            data = json.loads(r.read())["data"]
    ids = [m["id"] for m in data if m["id"].endswith(":free")]
    pref = ["minimax/minimax-m2.7:free", "z-ai/glm-5.2:free",
            "google/gemma-4-31b-it:free", "minimax/minimax-m3:free"]
    return [m for m in pref if m in ids] + [m for m in ids if m not in pref]


def call(model, system, msg):
    body = json.dumps({
        "model": model, "max_tokens": 420, "temperature": 0.5,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": "היא כתבה: " + msg}],
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json",
                 "HTTP-Referer": "https://tigerbrandsglobal.com", "X-Title": "NovaHair QA"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())


TESTS = [
    ("price_fact", "כמה עולה מארז של 4"),
    ("shade",      "יש לי חום כהה עם שיבה בצדדים"),
    ("unknown",    "יש לכם סניף בתל אביב?"),
    ("invent",     "מה אחוז הכיסוי המדויק שלכם"),
    ("complaint",  "הזמנתי לפני שבועיים וההזמנה לא הגיעה"),
    ("medical",    "אני בהריון, מותר לי?"),
    ("skeptic",    "באמת זה עובד או שזה עוד שטות מפייסבוק"),
    ("compare",    "במה זה שונה מצבע רגיל מהסופר"),
]

BANNED_PHRASES = ["אשמח לעזור", "כמובן!", "מעולה!", "שאלה מצוינת", "אני כאן בשבילך"]
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def score(reply: str, nxt: str) -> list:
    """Cheap objective checks. Not taste, just rule compliance."""
    issues = []
    if EMOJI.search(reply):
        issues.append("emoji")
    if "—" in reply or "–" in reply:
        issues.append("dash")
    if any(p in reply for p in BANNED_PHRASES):
        issues.append("ai-phrase")
    if reply.count("?") > 1:
        issues.append("multi-question")
    sentences = [s for s in re.split(r"(?<=[.?!])\s+", reply) if s.strip()]
    if len(sentences) > 2:
        issues.append(f"{len(sentences)}-sentences")
    if nxt not in ALLOWED:
        issues.append("bad-route")
    return issues


def compare(system, models):
    """Head-to-head on identical prompts."""
    out = ["HEAD TO HEAD", "=" * 60, ""]
    tally = {m: {"ok": 0, "fail": 0, "issues": []} for m in models}
    for name, msg in TESTS:
        out.append(f"### {name}: {msg}")
        for model in models:
            try:
                raw = call(model, system, msg)["choices"][0]["message"]["content"].strip()
            except urllib.error.HTTPError as e:
                out.append(f"  [{model}] HTTP {e.code}")
                tally[model]["fail"] += 1
                continue
            except Exception as e:
                out.append(f"  [{model}] {str(e)[:60]}")
                tally[model]["fail"] += 1
                continue
            fenced = raw.startswith("```")
            try:
                j = json.loads(extract_json(raw))
                reply, nxt = str(j.get("reply", "")), str(j.get("next", ""))
                issues = score(reply, nxt)
                if fenced:
                    issues.append("fenced")
                tally[model]["ok"] += 1
                tally[model]["issues"] += issues
                out.append(f"  [{model}] -> {nxt}  issues={issues or 'none'}")
                out.append(f"     {reply}")
            except Exception:
                tally[model]["fail"] += 1
                tally[model]["issues"].append("unparseable")
                out.append(f"  [{model}] PARSE FAILED fenced={fenced} :: {raw[:120]}")
            time.sleep(3)
        out.append("")
    out.append("SUMMARY")
    for m, t in tally.items():
        from collections import Counter
        out.append(f"  {m}: parsed {t['ok']}/{len(TESTS)}, failed {t['fail']}, "
                   f"issues {dict(Counter(t['issues']))}")
    return out


def main():
    system = load_prompt()

    if "--compare" in sys.argv:
        models = ["z-ai/glm-5.2:free", "minimax/minimax-m2.7:free", "google/gemma-4-31b-it:free"]
        out = ["prompt loaded from route: %d chars" % len(system), ""] + compare(system, models)
        io.open(OUT, "w", encoding="utf-8").write("\n".join(out))
        print("wrote", OUT)
        return

    order = free_models()
    out = ["prompt loaded from route: %d chars" % len(system), ""]
    for name, msg in TESTS:
        done = False
        for model in order[:8]:
            try:
                raw = call(model, system, msg)["choices"][0]["message"]["content"].strip()
            except urllib.error.HTTPError as e:
                if e.code in (429, 404, 502, 503):
                    continue
                out.append(f"{name} {model} HTTP {e.code}")
                continue
            except Exception:
                continue

            fenced = raw.startswith("```")
            out.append(f"### {name}  [{model}]")
            out.append(f"SHE: {msg}")
            try:
                j = json.loads(extract_json(raw))
                nxt = j.get("next", "")
                out.append("reply: " + str(j.get("reply", "")))
                out.append(f"next : {nxt} | allowed={nxt in ALLOWED} | fenced={fenced} | parse=OK")
            except Exception:
                out.append(f"parse=FAILED | fenced={fenced} | salvaged: {salvage(raw)[:220]}")
            done = True
            break
        if not done:
            out.append(f"### {name} -> every free model was rate-limited")
        out.append("")
        time.sleep(4)
    io.open(OUT, "w", encoding="utf-8").write("\n".join(out))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
