"""Multi-turn conversation simulator against the live model.

Plays several shopper personas turn by turn, threading history, and prints the
transcript so the Hebrew and the selling can be judged like a real shopper.
Reads the system prompt from the production route so it tests what ships.

Usage: set OPENROUTER_API_KEY, then run.
"""
import io
import json
import os
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[3]
ROUTE = ROOT / "app" / "cloudflare-pilot" / "src" / "routes" / "ai-concierge.ts"
OUT = pathlib.Path(__file__).with_name("_sim.txt")
KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
if not KEY:
    sys.exit("OPENROUTER_API_KEY not set")

src = io.open(ROUTE, encoding="utf-8").read()
SYSTEM = re.search(r"const SYSTEM_PROMPT = `(.*?)`;", src, re.S).group(1)
ALLOWED = re.findall(r'"(\w+)"', re.search(r"const ALLOWED_NEXT = new Set\(\[(.*?)\]\)", src, re.S).group(1))
SYSTEM = SYSTEM.replace('${Array.from(ALLOWED_NEXT).join(", ")}', ", ".join(ALLOWED))
MODEL = "z-ai/glm-5.3-flash"


def strip_fence(s):
    s = s.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.I)
    return re.sub(r"\s*```$", "", s).strip()


def extract(raw):
    s = strip_fence(raw)
    i = s.find("{")
    if i == -1:
        return {"reply": s, "next": ""}
    depth = 0
    for k in range(i, len(s)):
        if s[k] == "{":
            depth += 1
        elif s[k] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(s[i:k + 1])
                except Exception:
                    break
    m = re.search(r'"reply"\s*:\s*"([^"]*)', s)
    return {"reply": m.group(1) if m else s, "next": ""}


def turn(history, with_history=True):
    """history: list of (role, text). Returns reply dict."""
    msgs = [{"role": "system", "content": SYSTEM}]
    if with_history:
        for role, text in history:
            msgs.append({"role": role, "content": text if role == "assistant" else "היא כתבה: " + text})
    else:
        role, text = history[-1]
        msgs.append({"role": "user", "content": "היא כתבה: " + text})
    body = json.dumps({"model": MODEL, "max_tokens": 700, "temperature": 0.6,
                       "reasoning": {"effort": "low"}, "response_format": {"type": "json_object"},
                       "messages": msgs}).encode()
    req = urllib.request.Request("https://openrouter.ai/api/v1/chat/completions", data=body,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        d = json.loads(r.read())
    m = d["choices"][0]["message"]
    raw = (m.get("content") or m.get("reasoning") or "").strip()
    return extract(raw)


PERSONAS = {
    "A_price_resistance": [
        "כמה עולה מארז של 4",
        "יקר לי, במספרה אני משלמת פחות",
        "לא יודעת, אולי אחשוב על זה",
    ],
    "B_ready_buyer": [
        "יש לי חום כהה עם קצת שיבה, איזה גוון מתאים",
        "נשמע טוב, איך מזמינים",
    ],
    "C_skeptic": [
        "באמת זה עובד או שזה עוד שטות",
        "וזה לא ייראה מלאכותי על השיער",
    ],
    "D_complaint": [
        "הזמנתי לפני שבועיים וההזמנה לא הגיעה",
    ],
    "E_curious_not_ready": [
        "סתם מסתכלת, לא בטוחה שאני צריכה את זה",
        "אולי בפעם אחרת",
    ],
}


def main():
    out = [f"model: {MODEL}  |  with conversation history: YES", "=" * 66, ""]
    for name, lines in PERSONAS.items():
        out.append(f"########## {name} ##########")
        history = []
        for line in lines:
            history.append(("user", line))
            try:
                r = turn(history, with_history=True)
            except Exception as e:
                out.append(f"  שופרת: {line}\n  [ERROR {str(e)[:80]}]")
                break
            reply = r.get("reply", "")
            nxt = r.get("next", "")
            history.append(("assistant", reply))
            out.append(f"  שופרת: {line}")
            out.append(f"  נעמה : {reply}")
            out.append(f"         [next={nxt}]")
            time.sleep(2)
        out.append("")
    io.open(OUT, "w", encoding="utf-8").write("\n".join(out))
    print("wrote", OUT.name)


if __name__ == "__main__":
    main()
