"""Create the imported products in Shopify as drafts on the nova template.

Everything lands unpublished. Nothing here touches an existing product, the
funnel, or the live theme files.

Transport is curl rather than urllib because this machine's Python CA bundle has
expired and fails verification against Shopify.
"""
import json, os, subprocess, sys, time

SHOP = os.environ["SHOP"]
VER = os.environ["VER"]
TOKEN = os.environ["TOKEN"]
ENDPOINT = "https://%s/admin/api/%s/graphql.json" % (SHOP, VER)


def gql(query, variables=None, tries=3):
    payload = json.dumps({"query": query, "variables": variables or {}})
    for attempt in range(tries):
        out = subprocess.run(
            ["curl", "-s", "-X", "POST", ENDPOINT,
             "-H", "X-Shopify-Access-Token: " + TOKEN,
             "-H", "Content-Type: application/json",
             "--data-binary", "@-"],
            input=payload, capture_output=True, text=True,
            encoding="utf-8", errors="replace").stdout
        try:
            d = json.loads(out)
        except Exception:
            time.sleep(1.5 * (attempt + 1))
            continue
        if d.get("errors"):
            msg = json.dumps(d["errors"], ensure_ascii=False)
            if "THROTTLED" in msg.upper() and attempt < tries - 1:
                time.sleep(3.0 * (attempt + 1))
                continue
            raise RuntimeError("GraphQL errors: " + msg[:600])
        return d["data"]
    raise RuntimeError("no valid response after %d tries" % tries)


STAGED = """
mutation stage($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}"""


def upload_image(path, filename):
    """Push a local JPEG into Shopify's staging bucket, return its resourceUrl."""
    size = str(os.path.getsize(path))
    d = gql(STAGED, {"input": [{
        "filename": filename, "mimeType": "image/jpeg",
        "resource": "IMAGE", "httpMethod": "POST", "fileSize": size,
    }]})
    r = d["stagedUploadsCreate"]
    if r["userErrors"]:
        raise RuntimeError("staged upload: %s" % r["userErrors"])
    t = r["stagedTargets"][0]

    args = ["curl", "-s", "-o", os.devnull, "-w", "%{http_code}", "-X", "POST", t["url"]]
    for p in t["parameters"]:
        args += ["-F", "%s=%s" % (p["name"], p["value"])]
    args += ["-F", "file=@%s" % path]
    code = subprocess.run(args, capture_output=True, text=True).stdout.strip()
    if code not in ("200", "201", "204"):
        raise RuntimeError("image POST returned %s" % code)
    return t["resourceUrl"]


CREATE = """
mutation create($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product { id handle title templateSuffix status
              variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}"""

VARIANTS = """
mutation vars($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id price compareAtPrice }
    userErrors { field message }
  }
}"""

MEDIA = """
mutation media($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    media { ... on MediaImage { id } }
    mediaUserErrors { field message }
  }
}"""

METAFIELDS = """
mutation mf($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}"""


def create_product(p):
    """p carries the finished Hebrew copy and pricing. Returns the product gid."""
    product = {
        "title": p["title"],
        "descriptionHtml": p["body_html"],
        "vendor": p.get("vendor", "NovaHair"),
        "productType": p["product_type"],
        "tags": p.get("tags", []),
        "status": "DRAFT",
        "templateSuffix": "nova",
        "seo": {"title": p["seo_title"], "description": p["seo_description"]},
    }
    # A Latin handle keeps the URL readable and shareable. Shopify would
    # otherwise derive a percent-encoded Hebrew one from the title.
    if p.get("handle"):
        product["handle"] = p["handle"]
    d = gql(CREATE, {"product": product})
    r = d["productCreate"]
    if r["userErrors"]:
        raise RuntimeError("productCreate: %s" % r["userErrors"])
    gid = r["product"]["id"]
    vid = r["product"]["variants"]["nodes"][0]["id"]

    v = {
        "id": vid,
        "price": "%.2f" % p["price"],
        "inventoryItem": {"tracked": False, "cost": "%.2f" % p["cost_usd"]},
    }
    if p.get("compare_at"):
        v["compareAtPrice"] = "%.2f" % p["compare_at"]
    d = gql(VARIANTS, {"productId": gid, "variants": [v]})
    if d["productVariantsBulkUpdate"]["userErrors"]:
        raise RuntimeError("variants: %s" % d["productVariantsBulkUpdate"]["userErrors"])

    if p.get("tile") and os.path.exists(p["tile"]):
        res = upload_image(p["tile"], os.path.basename(p["tile"]))
        d = gql(MEDIA, {"productId": gid, "media": [{
            "originalSource": res, "mediaContentType": "IMAGE",
            "alt": p.get("image_alt", p["title"]),
        }]})
        errs = d["productCreateMedia"]["mediaUserErrors"]
        if errs:
            raise RuntimeError("media: %s" % errs)

    # The PDP only shows a struck-through price when this is set, so a compare-at
    # that is not a real former price stays hidden.
    if p.get("compare_at_verified"):
        gql(METAFIELDS, {"metafields": [{
            "ownerId": gid, "namespace": "nova", "key": "compare_at_verified",
            "type": "boolean", "value": "true",
        }]})

    return gid, r["product"]["handle"]
