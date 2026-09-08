"""Benchmark every free OpenRouter model for the concierge use case.

Measures, per model: availability, latency, whether it returns parseable JSON,
whether it writes Hebrew, and whether it obeys the no-emoji / two-sentence
rules. Output is an ordered ladder the route can fall through.

Usage:
    set OPENROUTER_API_KEY, then:
    python popup-engine/ai-popup/harness/bench_models.py
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

OUT = pathlib.Path(__file__).with_name("_ladder.json")
REPORT = pathlib.Path(__file__).with_name("_ladder.txt")

KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
if not KEY:
    sys.exit("OPENROUTER_API_KEY is not set")

ALLOWED = ["root_choice", "shade_open", "shade_result", "price_open", "price_bundle",
           "proof_roots", "proof_how", "offer", "capture", "graceful", "escalate"]

SYSTEM = (
    "את נעמה, יועצת של NovaHair, צבע שורשים לבית בישראל.\n"
    "עברית ישראלית, גוף שני נקבה, קצר. שתי שורות לכל היותר.\n"
    "בלי אימוג'ים. אסור להמציא מחירים או נתונים.\n"
    "מארז 4 בקבוקים 239 שקל וזה המומלץ.\n"
    'החזירי JSON בלבד: {"reply": "<עברית>", "next": "<שלב>"}\n'
    "שלבים: " + ", ".join(ALLOWED)
)
PROBE = "כמה עולה מארז של 4 ואיזה גוון מתאים לחום כהה"

HEBREW = re.compile("[֐-׿]")
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")

# Hard-fail patterns found in real free-model output during benchmarking.
# The generic "is it Hebrew / has no emoji" check passed all of these.
FOREIGN = re.compile("[　-鿿가-힯؀-ۿ]")   # CJK, Hangul, Arabic
MASCULINE = re.compile(r"(?:^|\s)(אתה|תוכל|רוצה אתה|שלך הוא|בוא)(?:\s|$|[.,?!])")
# Professional colourist codes (4.0, 3.0, 1B, 2B). NovaHair sells five NAMED
# shades and no codes at all, so any of these is an invented fact.
SHADE_CODE = re.compile(r"\b\d\.\d\b|\b\d[BbNn]\b")
REAL_SHADES = ["שחור טבעי", "חום כהה", "חום בהיר", "סגול חציל", "אדום יין"]


def quality_flags(reply: str) -> list:
    """The checks that actually matter. Each one was written because a real
    free model failed it during benchmarking."""
    bad = []
    if FOREIGN.search(reply):
        bad.append("foreign-script")
    if MASCULINE.search(reply):
        bad.append("masculine-address")
    if SHADE_CODE.search(reply):
        bad.append("invented-shade-code")
    if EMOJI.search(reply):
        bad.append("emoji")
    if "—" in reply or "–" in reply:
        bad.append("dash")
    sentences = [s for s in re.split(r"(?<=[.?!])\s+", reply) if s.strip()]
    if len(sentences) > 2:
        bad.append("too-long")
    return bad


def strip_fence(s):
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
    return re.sub(r"\s*```$", "", s).strip()


def extract_json(raw):
    s = strip_fence(raw)
    start = s.find("{")
    if start == -1:
        return s
    depth, in_str, esc = 0, False, False
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


def all_free():
    with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30) as r:
        data = json.loads(r.read())["data"]
    return [m["id"] for m in data if m["id"].endswith(":free")]


def probe(model):
    body = json.dumps({
        "model": model, "max_tokens": 300, "temperature": 0.4,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": "היא כתבה: " + PROBE}],
    }).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json",
                 "HTTP-Referer": "https://tigerbrandsglobal.com", "X-Title": "NovaHair bench"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=60) as r:
        payload = json.loads(r.read())
    return time.time() - t0, payload["choices"][0]["message"]["content"].strip()


def main():
    models = all_free()
    rows = []
    for m in models:
        rec = {"model": m, "ok": False, "latency": None, "json": False,
               "hebrew": False, "clean": False, "error": "", "sample": ""}
        try:
            latency, raw = probe(m)
            rec["ok"] = True
            rec["latency"] = round(latency, 2)
            try:
                j = json.loads(extract_json(raw))
                reply = str(j.get("reply", ""))
                rec["json"] = True
                rec["hebrew"] = bool(HEBREW.search(reply))
                rec["flags"] = quality_flags(reply)
                rec["clean"] = not rec["flags"]
                rec["sample"] = reply[:110]
                rec["next_ok"] = str(j.get("next", "")) in ALLOWED
            except Exception:
                rec["sample"] = raw[:110]
                rec["hebrew"] = bool(HEBREW.search(raw))
        except urllib.error.HTTPError as e:
            rec["error"] = f"HTTP {e.code}"
        except Exception as e:
            rec["error"] = str(e)[:60]
        rows.append(rec)
        line = (f"{m:52} ok={rec['ok']!s:5} {str(rec['latency']):>6}s "
                f"json={rec['json']!s:5} heb={rec['hebrew']!s:5} clean={rec['clean']!s:5} {rec['error']}")
        sys.stdout.buffer.write(line.encode("utf-8", "replace") + b"\n")
        sys.stdout.flush()
        time.sleep(2)

    # Ladder: usable models first, fastest first. Usable = answered, valid
    # JSON, wrote Hebrew. Everything else is a last resort.
    # Only models with ZERO quality flags qualify. A fast model that writes
    # Chinese or invents shade codes is worse than no model at all, because
    # the keyword fallback is at least always correct.
    usable = [r for r in rows if r["ok"] and r["json"] and r["hebrew"] and r.get("clean")]
    usable.sort(key=lambda r: r["latency"])
    partial = [r for r in rows if r["ok"] and r not in usable]
    partial.sort(key=lambda r: r["latency"] or 999)

    ladder = [r["model"] for r in usable] + [r["model"] for r in partial]
    json.dump({"ladder": ladder, "rows": rows}, io.open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    rep = ["LADDER (try in this order)", "=" * 60]
    for i, r in enumerate(usable, 1):
        rep.append(f"{i}. {r['model']}  {r['latency']}s")
        rep.append(f"     {r['sample']}")
    rep.append("")
    rep.append("REJECTED (answered but failed quality gates)")
    for r in partial:
        rep.append(f"  - {r['model']}  {r['latency']}s  flags={r.get('flags') or 'no-json/no-hebrew'}")
        rep.append(f"       {r['sample'][:90]}")
    rep.append("")
    rep.append("UNAVAILABLE")
    for r in rows:
        if not r["ok"]:
            rep.append(f"  - {r['model']}  {r['error']}")
    io.open(REPORT, "w", encoding="utf-8").write("\n".join(rep))
    print(f"\nusable: {len(usable)}/{len(rows)}  -> wrote {OUT.name} and {REPORT.name}")


if __name__ == "__main__":
    main()
