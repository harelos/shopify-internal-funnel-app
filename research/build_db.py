# -*- coding: utf-8 -*-
"""Turn the 120-brand research JSON into a queryable SQLite database.

The research arrives as one flat JSON array, which is fine to read and useless
to ask questions of. Four of its fields are lists (navigation, site features,
sources) or a nested object (subscription), so those become their own tables and
the rest stays on `brands`. That way "which brands run a loyalty programme and
also a shade finder" is a join rather than a script.

Nulls are kept as nulls on purpose. The research was told not to guess, and an
unverified traffic figure must stay distinguishable from a verified zero.
"""
import json, os, sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "brands.json")
DB = os.path.join(HERE, "brands.db")

SCHEMA = """
DROP TABLE IF EXISTS brands;
DROP TABLE IF EXISTS nav;
DROP TABLE IF EXISTS features;
DROP TABLE IF EXISTS sources;

CREATE TABLE brands (
  id                        INTEGER PRIMARY KEY,
  name                      TEXT NOT NULL,
  country                   TEXT,
  website_url               TEXT,
  primary_category          TEXT,
  hair_skin_or_both         TEXT,
  hero_product              TEXT,
  hero_price_local          TEXT,
  price_range               TEXT,
  loyalty_program           TEXT,     -- null means none found, not none existing
  subscription_available    INTEGER,  -- 1/0/null
  subscription_discount     TEXT,
  monthly_traffic_estimate  TEXT,
  traffic_source            TEXT,
  confidence                TEXT,
  platform                  TEXT,
  shipping_promise          TEXT,
  hebrew_site               INTEGER,
  own_site_or_retail        TEXT,
  price_positioning         TEXT,
  delivery_language         TEXT,
  notes                     TEXT
);

CREATE TABLE nav      (brand_id INTEGER, item TEXT);
CREATE TABLE features (brand_id INTEGER, item TEXT);
CREATE TABLE sources  (brand_id INTEGER, url  TEXT);

CREATE INDEX idx_brands_country  ON brands(country);
CREATE INDEX idx_brands_category ON brands(primary_category);
CREATE INDEX idx_nav_item        ON nav(item);
CREATE INDEX idx_features_item   ON features(item);
"""


def flatten_loyalty(v):
    """Loyalty arrives as a string, an object, or null depending on the brand."""
    if v is None:
        return None
    if isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


def scalar(v):
    """SQLite takes scalars. A few fields arrive as objects on the minority of
    brands where a value was actually verified, so those keep their structure as
    JSON text rather than being flattened into a lossy string."""
    if v is None or isinstance(v, (str, int, float)):
        return v
    return json.dumps(v, ensure_ascii=False)


def truthy(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, str):
        return 1 if v.strip().lower() in ("yes", "true", "1") else 0
    return None


def run():
    rows = json.load(open(SRC, encoding="utf-8"))
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)

    for i, r in enumerate(rows, 1):
        sub = r.get("subscription")
        if isinstance(sub, dict):
            sub_av, sub_disc = truthy(sub.get("available")), sub.get("discount")
        else:
            sub_av, sub_disc = truthy(sub), None
        if sub_disc is not None and not isinstance(sub_disc, str):
            sub_disc = json.dumps(sub_disc, ensure_ascii=False)

        con.execute(
            "INSERT INTO brands VALUES (" + ",".join("?" * 22) + ")",
            (i, r.get("name"), r.get("country"), r.get("website_url"),
             r.get("primary_category"), r.get("hair_skin_or_both"),
             scalar(r.get("hero_product")), scalar(r.get("hero_price_local")),
             scalar(r.get("price_range")),
             flatten_loyalty(r.get("loyalty_program")), sub_av, sub_disc,
             scalar(r.get("monthly_traffic_estimate")), scalar(r.get("traffic_source")),
             scalar(r.get("confidence")), scalar(r.get("platform")),
             scalar(r.get("shipping_promise")),
             truthy(r.get("hebrew_site")), scalar(r.get("own_site_or_retail")),
             scalar(r.get("price_positioning")), scalar(r.get("delivery_language")),
             scalar(r.get("notes"))))

        for tbl, key, col in (("nav", "nav_structure", "item"),
                              ("features", "site_features", "item"),
                              ("sources", "sources", "url")):
            for v in (r.get(key) or []):
                if isinstance(v, (dict, list)):
                    v = json.dumps(v, ensure_ascii=False)
                con.execute("INSERT INTO %s (brand_id, %s) VALUES (?, ?)" % (tbl, col),
                            (i, v))

    con.commit()

    q = lambda s: con.execute(s).fetchall()
    print("brands            %d" % q("SELECT count(*) FROM brands")[0][0])
    print("nav items         %d" % q("SELECT count(*) FROM nav")[0][0])
    print("site features     %d" % q("SELECT count(*) FROM features")[0][0])
    print("sources           %d" % q("SELECT count(*) FROM sources")[0][0])
    print()
    print("by category:")
    for cat, n in q("SELECT primary_category, count(*) FROM brands "
                    "GROUP BY 1 ORDER BY 2 DESC"):
        print("  %-42s %d" % (cat, n))
    print()
    print("loyalty programmes found  %d of %d"
          % (q("SELECT count(*) FROM brands WHERE loyalty_program IS NOT NULL")[0][0],
             len(rows)))
    print("subscription offered      %d"
          % q("SELECT count(*) FROM brands WHERE subscription_available = 1")[0][0])
    print("traffic verified          %d   (the rest were left null on purpose)"
          % q("SELECT count(*) FROM brands "
              "WHERE monthly_traffic_estimate IS NOT NULL")[0][0])
    print()
    print("most common site features:")
    for item, n in q("SELECT lower(item), count(*) FROM features "
                     "GROUP BY 1 ORDER BY 2 DESC LIMIT 12"):
        print("  %-34s %d" % (item, n))
    con.close()
    print("\nwrote %s" % DB)


if __name__ == "__main__":
    run()
