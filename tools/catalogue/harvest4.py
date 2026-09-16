# -*- coding: utf-8 -*-
"""Third pass: the same concepts, asked many ways.

Harel's correction, and it is the important one. CJ listings are written by
thousands of Chinese sellers with inconsistent English, so the catalogue is not
indexed by concept, it is indexed by whatever words each seller happened to
type. One phrasing per concept reaches one seller's vocabulary and misses the
rest.

The evidence was immediate and unambiguous:

    hijab undercap      0 results
    hijab cap         199 results
    turban cap women    0 results
    headscarf women   200 results

Same object. Same shelf. Two phrasings return nothing and two return the
maximum the endpoint will give. My first two harvests used one phrasing per
concept, which is why the yield looked like CJ had no supply when what it
actually had was no supply *under the words I chose*.

So every concept below is asked several ways, including the awkward phrasings
sellers use: "wig head" as well as "wig stand", "flea comb" as well as "nit
comb", "hair ring" as well as "scrunchie". Where a term is ambiguous in
English, the noise filter downstream earns its keep rather than the query being
narrowed to compensate.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw4")
os.makedirs(RAW, exist_ok=True)

JWT = os.environ["CJ_JWT"]
BASE = "https://developers.cjdropshipping.com/api2.0/v1/product/list"

# concept -> the several ways sellers spell it
CONCEPTS = {
    "wig-care": ["wig shampoo", "wig care", "wig conditioner", "wig spray",
                 "hairpiece care", "synthetic hair shampoo", "wig cleaning"],
    "wig-tool": ["wig stand", "wig head", "wig holder", "wig tripod",
                 "wig display", "mannequin head wig", "wig storage bag"],
    "wig-cap":  ["wig cap", "wig net", "stocking cap wig", "dome cap wig",
                 "mesh wig cap", "wig grip band", "elastic band wig"],
    "bonnet":   ["satin bonnet", "silk bonnet", "hair bonnet", "sleeping cap",
                 "night cap hair", "double layer bonnet", "bonnet women hair"],
    "hair-towel": ["hair towel wrap", "microfiber hair turban", "hair drying cap",
                   "quick dry hair towel", "coral fleece hair towel"],
    "scrunchie": ["scrunchie", "satin hair tie", "silk hair ring",
                  "elastic hair band satin", "hair scrunchies set"],
    "pillowcase": ["silk pillowcase", "satin pillowcase", "mulberry pillowcase"],
    "lice-comb": ["lice comb", "nit comb", "flea comb", "fine tooth comb",
                  "double sided comb steel", "stainless steel hair comb teeth"],
    "wide-comb": ["wide tooth comb", "detangling comb", "afro comb",
                  "shower comb", "rake comb", "wooden wide comb"],
    "extension": ["clip in hair", "hair piece clip", "ponytail hairpiece",
                  "hair bun chignon", "hair topper", "invisible hair filler",
                  "halo hair extension"],
    "headscarf": ["hijab", "hijab cap", "headscarf", "headscarf women",
                  "head wrap", "turban women", "bandana women", "kerchief",
                  "underscarf", "jersey hijab", "chiffon hijab", "instant hijab"],
    "volumizer": ["hair volumizer", "khaleeji volumizer", "hijab volumizer",
                  "scrunchie volume hijab", "hair bump maker"],
    "braid":    ["braid tool", "braiding tool hair", "twist braid tool",
                 "hair braider", "french braid tool"],
    "beard":    ["beard oil", "beard balm", "beard comb", "beard brush men",
                 "beard kit", "beard wax", "mustache wax"],
    "kids-tool": ["kids hair brush", "detangling brush kids", "baby hair brush soft",
                  "children hair comb", "toddler hair brush"],
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
        before = len(rows)
        hits = []
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

    json.dump(rows, open(os.path.join(RAW, "harvest4.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    n = sum(len(v) for v in CONCEPTS.values())
    print("\n%d unique candidates from %d phrasings across %d concepts"
          % (len(rows), n, len(CONCEPTS)))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
