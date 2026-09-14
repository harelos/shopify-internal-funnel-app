"""For each shortlisted product: pull its full image set, pick the one usable
packshot, cut the background out and lay it on the standard store tile.

Products whose whole image set is banners, models or before/after grids are
dropped here. That filter is the point: it is what keeps the catalogue from
looking like a marketplace dump.
"""
import json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import images, pickimage

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")
TILES = os.path.join(HERE, "tiles")
DET = os.path.join(HERE, "raw", "detail")
os.makedirs(TILES, exist_ok=True)
os.makedirs(DET, exist_ok=True)

JWT = os.environ["CJ_JWT"]


def detail(pid):
    p = os.path.join(DET, "%s.json" % pid)
    if os.path.exists(p) and os.path.getsize(p) > 200:
        return json.load(open(p, encoding="utf-8"))
    url = "https://developers.cjdropshipping.com/api2.0/v1/product/query?pid=%s" % pid
    out = subprocess.run(["curl", "-s", "-H", "CJ-Access-Token: " + JWT, url],
                         capture_output=True, text=True, encoding="utf-8",
                         errors="replace").stdout
    try:
        d = json.loads(out)
    except Exception:
        return {}
    open(p, "w", encoding="utf-8").write(json.dumps(d, ensure_ascii=False))
    time.sleep(0.25)
    return d


def run(rows, out_json, verbose=True):
    kept, dropped = [], []
    for i, r in enumerate(rows):
        d = detail(r["pid"])
        data = (d.get("data") or {}) if isinstance(d, dict) else {}
        urls = data.get("productImageSet") or []
        if isinstance(urls, str):
            try:
                urls = json.loads(urls)
            except Exception:
                urls = [urls]
        if not urls:
            urls = [r["img"]]

        src, s, why = pickimage.best(urls, CACHE)
        if not src:
            dropped.append((r["name"], why))
            if verbose:
                print("  DROP %-54s %s" % (r["name"][:54], why))
            continue

        tile = os.path.join(TILES, "%s.jpg" % r["pid"])
        try:
            sub, why2 = images.cutout(src)
        except Exception as e:
            sub, why2 = None, "cutout error %s" % e
        if sub is None:
            dropped.append((r["name"], why2))
            if verbose:
                print("  DROP %-54s %s" % (r["name"][:54], why2))
            continue
        composed = images.compose(sub)
        if composed is None:
            dropped.append((r["name"], "subject too small on the tile"))
            if verbose:
                print("  DROP %-54s %s" % (r["name"][:54], "subject too small on the tile"))
            continue
        composed.save(tile, "JPEG", quality=88, optimize=True)

        r = dict(r)
        r["tile"] = tile
        r["src_image"] = src
        r["img_score"] = round(s, 1)
        r["img_why"] = why
        r["images_available"] = len(urls)
        r["detail"] = {
            "desc": data.get("description") or "",
            "suggest": data.get("suggestSellPrice"),
            "weight": data.get("productWeight"),
            "category": data.get("categoryName"),
            "variants": data.get("variants") or [],
        }
        kept.append(r)
        if verbose:
            print("  KEEP %-54s %s" % (r["name"][:54], why))
        sys.stdout.flush()

    json.dump(kept, open(out_json, "w", encoding="utf-8"), ensure_ascii=False)
    print("\nkept %d / dropped %d" % (len(kept), len(dropped)))
    return kept


if __name__ == "__main__":
    sl = json.load(open(os.path.join(HERE, "shortlist.json"), encoding="utf-8"))
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    run(sl[:n], os.path.join(HERE, "tiles_test.json"))
