"""Try one specific model against the real concierge prompt.

Resolves the model id (stealth models are often absent from the public
catalogue and need to be called directly), then runs the concierge probes.

Usage:
    set OPENROUTER_API_KEY, then:
    python popup-engine/ai-popup/harness/try_model.py stealth/ox-alpha
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
OUT = pathlib.Path(__file__).with_name("_try_model.txt")

KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
if not KEY:
    sys.exit("OPENROUTER_API_KEY is not set")

WANTED = sys.argv[1] if len(sys.argv) > 1 else "stealth/ox-alpha"

src = io.open(ROUTE, encoding="utf-8").read()
SYSTEM = re.search(r"const SYSTEM_PROMPT = `(.*?)`;", src, re.S).group(1)
ALLOWED = re.findall(r'"(\w+)"',
                     re.search(r"const ALLOWED_NEXT = new Set\(\[(.*?)\]\)", src, re.S).group(1))
SYSTEM = SYSTEM.replace('${Array.from(ALLOWED_NEXT).join(", ")}', ", ".join(ALLOWED))

FOREIGN = re.compile("[　-鿿가-힯؀-ۿ]")
MASC = re.compile(r"(?:^|\s)(אתה|תוכל|בוא)(?:\s|$|[.,?!])")
CODE = re.compile(r"\b\d\.\d\b|\b\d[BbNn]\b")
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


def flags(reply):
    bad = []
    if FOREIGN.search(reply):
        bad.append("foreign-script")
    if MASC.search(reply):
        bad.append("masculine-address")
    if CODE.search(reply):
        bad.append("invented-shade-code")
    if EMOJI.search(reply):
        bad.append("emoji")
    if "—" in reply or "–" in reply:
        bad.append("dash")
    if len([s for s in re.split(r"(?<=[.?!])\s+", reply) if s.strip()]) > 2:
        bad.append("too-long")
    return bad


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


def ask(model, msg, tokens=1500):
    body = json.dumps({
        "model": model, "max_tokens": tokens, "temperature": 0.6,
        # Some endpoints make reasoning mandatory. It cannot be switched off,
        # so keep it minimal and leave headroom: with max_tokens too low the
        # reasoning consumes the whole budget and content comes back null.
        "reasoning": {"effort": "low"},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": "היא כתבה: " + msg}],
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json",
                 "HTTP-Referer": "https://tigerbrandsglobal.com", "X-Title": "NovaHair try"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        return time.time() - t0, json.loads(r.read())


QUESTIONS = [
    ("price_shade", "כמה עולה מארז של 4 ואיזה גוון מתאים לחום כהה"),
    ("skeptic",     "באמת זה עובד או שזה עוד שטות מפייסבוק"),
    ("unknown",     "יש לכם סניף בתל אביב"),
    ("invent",      "מה אחוז הכיסוי המדויק"),
]


def main():
    candidates = [WANTED, WANTED + ":free", WANTED.split("/")[-1]]
    out = []
    live = None
    for mid in candidates:
        try:
            lat, d = ask(mid, "בדיקה", 800)
            out.append(f"ID WORKS: {mid}  ({lat:.1f}s)   usage={d.get('usage', {})}")
            live = mid
            break
        except urllib.error.HTTPError as e:
            out.append(f"ID FAILED: {mid} -> HTTP {e.code} :: {e.read().decode()[:200]}")
        except Exception as e:
            out.append(f"ID FAILED: {mid} -> {str(e)[:100]}")

    if live:
        out.append("")
        lats = []
        for name, msg in QUESTIONS:
            try:
                lat, d = ask(live, msg)
                lats.append(lat)
                m = d["choices"][0]["message"]
                # Some reasoning models put everything in `reasoning` and
                # leave `content` null even with reasoning disabled.
                raw = (m.get("content") or m.get("reasoning") or "").strip()
                out.append(f"### {name}  ({lat:.1f}s)")
                out.append(f"SHE: {msg}")
                try:
                    j = json.loads(extract_json(raw))
                    reply, nxt = str(j.get("reply", "")), str(j.get("next", ""))
                    out.append(f"reply: {reply}")
                    out.append(f"next : {nxt} allowed={nxt in ALLOWED} | flags={flags(reply) or 'none'}")
                except Exception:
                    out.append(f"PARSE FAILED :: {raw[:300]}")
            except Exception as e:
                out.append(f"### {name} ERROR {str(e)[:140]}")
            out.append("")
            time.sleep(3)
        if lats:
            out.append(f"avg latency: {sum(lats)/len(lats):.1f}s")
    io.open(OUT, "w", encoding="utf-8").write("\n".join(out))
    print("wrote", OUT.name, "| live id:", live)


if __name__ == "__main__":
    main()
