# -*- coding: utf-8 -*-
"""Second CJ harvest, searched from demand rather than from supply.

The first harvest asked CJ what it had and filtered down. Every one of its 46
queries sat inside one frame: a woman covering grey roots at home, plus generic
skincare. That frame produced 4,133 candidates and, once repetition and
regulated goods were removed, almost nothing that was not another oil or another
serum.

This one starts from what Israelis actually type into Google, taken from
keyword discovery, and then goes looking for it:

  wig care        558 Hebrew variants, including "how do you wash a wig",
                  "which shampoo is recommended for washing a wig", and
                  "wig AliExpress" - they are already buying this from China
  lice combs      482 variants, with the comb itself the second suggestion
  curly at night  303 variants, including "how to sleep with curly hair" and
                  "how to protect it at night", which are bonnet, silk and
                  scrunchie questions wearing a different hat

Plus three audiences the store has never addressed at all: men, children, and
women who cover their hair.

Nothing regulated is searched for. No lice treatment (a pesticide claim), no
baby cosmetics (a sensitive category under Israel's notification track), no
minoxidil, no sunscreen. Tools and accessories carry no such burden, which is
part of why this vein is attractive.
"""
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw2")
os.makedirs(RAW, exist_ok=True)

JWT = os.environ["CJ_JWT"]
BASE = "https://developers.cjdropshipping.com/api2.0/v1/product/list"

QUERIES = [
    # --- A. wig and hairpiece care -------------------------------------
    # the religious market buys wigs and has nowhere Hebrew to buy the care
    ("wig", "wig shampoo"), ("wig", "wig conditioner"), ("wig", "wig care"),
    ("wig", "wig brush"), ("wig", "wig comb"), ("wig", "wig stand"),
    ("wig", "wig cap"), ("wig", "wig detangler"), ("wig", "lace wig glue remover"),
    ("wig", "hair topper women"), ("wig", "wig storage"),

    # --- B. night protection and curls ---------------------------------
    # "how to sleep with curly hair" is a product question
    ("night", "satin bonnet"), ("night", "silk bonnet"), ("night", "sleep cap hair"),
    ("night", "satin scrunchie"), ("night", "silk scrunchie"),
    ("night", "silk pillowcase hair"), ("night", "hair wrap sleep"),
    ("curl", "curl cream"), ("curl", "curl defining gel"), ("curl", "curly hair diffuser"),
    ("curl", "wide tooth comb"), ("curl", "curl brush define"),
    ("curl", "microfiber hair towel curly"), ("curl", "hair plopping towel"),

    # --- C. lice combs, the tool only ----------------------------------
    ("lice", "lice comb"), ("lice", "nit comb stainless"),

    # --- D. extensions, volume, no chemistry ---------------------------
    ("piece", "clip in hair extension"), ("piece", "ponytail extension"),
    ("piece", "hair volumizer clip"), ("piece", "hair bun maker"),
    ("piece", "braid tool hair"), ("piece", "hair filler fiber"),

    # --- E. head covering ----------------------------------------------
    ("cover", "turban head wrap women"), ("cover", "wide headband women"),
    ("cover", "hair scarf silk"), ("cover", "volumizing scrunchie headscarf"),

    # --- F. men, an audience this store has never spoken to -------------
    ("men", "beard oil"), ("men", "beard balm"), ("men", "beard brush"),
    ("men", "beard comb wood"), ("men", "beard growth serum"),
    ("men", "men hair wax matte"), ("men", "men shampoo anti dandruff"),

    # --- G. children, tools only ----------------------------------------
    ("kids", "kids detangling brush"), ("kids", "hair detangler spray kids"),
    ("kids", "kids hair accessories set"),
]


def fetch(token, page):
    """One page of CJ results. curl, because this machine's CA bundle is stale."""
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
    for theme, token in QUERIES:
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
                rows.append({
                    "pid": pid,
                    "sku": r.get("productSku"),
                    "name": r.get("productNameEn"),
                    "theme": theme,
                    "token": token,
                    "listed": r.get("listedNum") or 0,
                    "price": r.get("sellPrice"),
                    "img": r.get("productImage"),
                    "cat": r.get("categoryName"),
                })
                got += 1
            if len(lst) < 100:
                break
            time.sleep(0.4)
        print("  %-8s %-34s %4d new" % (theme, token, got), flush=True)
        time.sleep(0.5)

    json.dump(rows, open(os.path.join(RAW, "harvest2.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    print("\n%d unique candidates across %d queries" % (len(rows), len(QUERIES)))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    run()
