# -*- coding: utf-8 -*-
"""Synonym-expanded harvest, pointed at the shelf the store actually sells.

Wave 2 went looking for new audiences and found one vein with real CJ depth,
head coverings, which is the wrong product for this business. That is settled
and it is not revisited here.

So this goes back to the evidence that was always the strongest thing we know
about the store: 57% of identifiable units sold are facial skincare, and the
best selling product in its history is a face mask. Wave 1 already mined that
shelf, concluded it was mostly repetition, and shipped 94 facial candidates it
judged too similar to what was already listed. But wave 1 asked each concept
exactly one way, and the head-covering exercise proved what that costs:
`satin pillowcase` returns 0 where `mulberry pillowcase` returns 152.

So the same question gets asked again, properly. Every concept below is a form
of facial care, and every one is asked in five to eight phrasings, including
the ones Chinese sellers actually type: "mask pack" as well as "sheet mask",
"ampoule" as well as "serum", "cleansing foam" as well as "face wash".

Nothing regulated is searched for: no sunscreen, no whitening, no baby.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw5")
os.makedirs(RAW, exist_ok=True)

JWT = os.environ["CJ_JWT"]
BASE = "https://developers.cjdropshipping.com/api2.0/v1/product/list"

CONCEPTS = {
    "sheet-mask": ["sheet mask", "facial mask", "mask pack", "face mask skin care",
                   "hydrating sheet mask", "korean face mask", "silk mask face"],
    "wash-mask":  ["clay mask", "mud mask", "purifying mask", "charcoal mask face",
                   "peel off mask", "wash off mask", "bubble mask"],
    "serum":      ["face serum", "facial essence", "ampoule", "skin booster",
                   "essence serum", "concentrate serum", "brightening essence"],
    "eye":        ["eye cream", "eye serum", "eye patch", "eye gel", "eye mask patch",
                   "under eye", "eye essence"],
    "cleanser":   ["facial cleanser", "face wash", "cleansing foam", "cleansing gel",
                   "cleansing balm", "cleansing oil", "makeup remover"],
    "toner":      ["toner", "facial toner", "toner pad", "essence water",
                   "skin softener", "face mist", "facial spray"],
    "moisture":   ["face cream", "moisturizer", "gel cream face", "day cream",
                   "face lotion", "sleeping cream", "barrier cream face"],
    "lip":        ["lip mask", "lip balm", "lip sleeping mask", "lip scrub",
                   "lip oil", "lip plumper", "lip care"],
    "blemish":    ["acne patch", "pimple patch", "blemish patch", "spot patch",
                   "hydrocolloid patch", "acne care"],
    "face-tool":  ["gua sha", "jade roller", "face roller", "facial massager",
                   "ice roller face", "face cleansing brush", "facial cupping"],
    "exfoliate":  ["face scrub", "exfoliating gel", "peeling gel", "aha bha",
                   "blackhead remover strip", "pore strip", "exfoliant face"],
    "body-care":  ["body lotion", "body butter", "hand mask", "foot mask",
                   "foot peel", "hand cream set", "neck cream"],
}


def fetch(token, page):
    url = ("%s?pageNum=%d&pageSize=100&productNameEn=%s"
           % (BASE, page, token.replace(" ", "%20")))
    p = subprocess.run(["curl", "-s", "-g", url, "-H", "CJ-Access-Token: " + JWT],
                       capture_output=True)
    try:
        return json.loads(p.stdout.decode("utf-8", "replace"))
    except Exception:
        return {}


def run():
    seen, rows = set(), []
    for concept, tokens in CONCEPTS.items():
        before, hits = len(rows), []
        for token in tokens:
            got = 0
            for page in (1, 2):
                d = fetch(token, page)
                lst = ((d.get("data") or {}).get("list")) or []
                if not lst:
                    break
                for r in lst:
                    pid = r.get("pid")
                    if not pid or pid in seen:
                        continue
                    seen.add(pid)
                    rows.append({"pid": pid, "sku": r.get("productSku"),
                                 "name": r.get("productNameEn"), "concept": concept,
                                 "token": token, "listed": r.get("listedNum") or 0,
                                 "price": r.get("sellPrice"), "img": r.get("productImage"),
                                 "cat": r.get("categoryName")})
                    got += 1
                if len(lst) < 100:
                    break
                time.sleep(0.3)
            hits.append("%s=%d" % (token, got))
            time.sleep(0.4)
        print("  %-11s +%-5d  %s" % (concept, len(rows) - before, "  ".join(hits)),
              flush=True)

    json.dump(rows, open(os.path.join(RAW, "harvest5.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    n = sum(len(v) for v in CONCEPTS.values())
    print("\n%d unique candidates from %d phrasings across %d concepts"
          % (len(rows), n, len(CONCEPTS)))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
