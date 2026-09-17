"""Verify the model ladder end to end against live OpenRouter.

Mirrors the fallthrough logic in server/ai-concierge.ts: try each rung, skip
on transport failure, and reject a reply that trips a quality gate.

Usage:
    set OPENROUTER_API_KEY, then:
    python popup-engine/ai-popup/harness/verify_ladder.py
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

KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
if not KEY:
    sys.exit("OPENROUTER_API_KEY is not set")

src = io.open(ROUTE, encoding="utf-8").read()

# Pull the ladder and the prompt straight out of the route so this can never
# test something different from what ships.
# Match any model id, not just :free ones. The earlier pattern silently
# skipped the paid rung at the top of the ladder.
LADDER = re.findall(r'"([\w.\-]+/[\w.\-:]+)"',
                    re.search(r"const MODEL_LADDER = \[(.*?)\];", src, re.S).group(1))
SYSTEM = re.search(r"const SYSTEM_PROMPT = `(.*?)`;", src, re.S).group(1)
ALLOWED = re.findall(r'"(\w+)"', re.search(r"const ALLOWED_NEXT = new Set\(\[(.*?)\]\)", src, re.S).group(1))
SYSTEM = SYSTEM.replace('${Array.from(ALLOWED_NEXT).join(", ")}', ", ".join(ALLOWED))

FOREIGN = re.compile("[　-鿿가-힯؀-ۿ]")
MASC = re.compile(r"(?:^|\s)(אתה|תוכל|בוא)(?:\s|$|[.,?!])")
CODE = re.compile(r"\b\d\.\d\b|\b\d[BbNn]\b")


def gate(reply):
    if not reply.strip():
        return "empty"
    if FOREIGN.search(reply):
        return "foreign-script"
    if MASC.search(reply):
        return "masculine-address"
    if CODE.search(reply):
        return "invented-shade-code"
    return None


def strip_fence(s):
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
    return re.sub(r"\s*```$", "", s).strip()


def extract_json(raw):
    s = strip_fence(raw)
    i = s.find("{")
    if i == -1:
        return s
    depth, in_str, esc = 0, False, False
    for k in range(i, len(s)):
        c = s[k]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return s[i:k + 1]
    return s


def ask(model, msg):
    body = json.dumps({
        "model": model, "max_tokens": 700, "temperature": 0.6,
        "reasoning": {"effort": "low"},
        "response_format": {"type": "json_object"},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": "היא כתבה: " + msg}],
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json",
                 "HTTP-Referer": "https://tigerbrandsglobal.com", "X-Title": "NovaHair ladder"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def run_ladder(msg):
    """Returns (served_by, reply, next, trace)."""
    trace = []
    for model in LADDER:
        try:
            raw = ask(model, msg) or ""
        except urllib.error.HTTPError as e:
            trace.append(f"{model}: HTTP {e.code}")
            continue
        except Exception as e:
            trace.append(f"{model}: {str(e)[:40]}")
            continue
        if not raw:
            trace.append(f"{model}: empty")
            continue
        try:
            j = json.loads(extract_json(raw))
            reply, nxt = str(j.get("reply", "")), str(j.get("next", ""))
        except Exception:
            m = re.search(r'"reply"\s*:\s*"([^"]*)', strip_fence(raw))
            reply, nxt = (m.group(1) if m else raw)[:400], ""
        bad = gate(reply)
        if bad:
            trace.append(f"{model}: REJECTED {bad}")
            continue
        if nxt not in ALLOWED:
            nxt = ""
        trace.append(f"{model}: SERVED")
        return model, reply, nxt, trace
    return None, "", "", trace


QUESTIONS = [
    "כמה עולה מארז של 4 ואיזה גוון מתאים לחום כהה",
    "באמת זה עובד או שזה שטות",
    "יש לכם סניף בתל אביב",
]


def main():
    out = [f"ladder loaded from route: {len(LADDER)} rungs", ""]
    served = 0
    for q in QUESTIONS:
        model, reply, nxt, trace = run_ladder(q)
        out.append(f"### {q}")
        for t in trace:
            out.append("   " + t)
        if model:
            served += 1
            out.append(f"  -> served by {model}")
            out.append(f"  -> next: {nxt or '(none)'}")
            out.append(f"  -> {reply}")
        else:
            out.append("  -> WHOLE LADDER FAILED, client uses keyword fallback")
        out.append("")
        time.sleep(3)
    out.append(f"RESULT: {served}/{len(QUESTIONS)} answered by the ladder")
    p = pathlib.Path(__file__).with_name("_ladder_run.txt")
    io.open(p, "w", encoding="utf-8").write("\n".join(out))
    print(f"{served}/{len(QUESTIONS)} served -> wrote {p.name}")


if __name__ == "__main__":
    main()
