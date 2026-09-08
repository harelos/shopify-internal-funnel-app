"""Pure NovaHair order-manifest construction and comparison helpers."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import math
import re
from typing import Any


BUNDLE_SKU_RE = re.compile(r"^NOVASALE-(2|4|6)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$")

COMPONENTS = (
    ("black", "2412030839551624000", "CJYD223160001AZ"),
    ("dark_brown", "2412030839551624200", "CJYD223160002BY"),
    ("light_brown", "2412030839551624400", "CJYD223160003CX"),
    ("purple", "2412030839551624700", "CJYD223160005EV"),
    ("red", "2412030839551624600", "CJYD223160004DW"),
)
GIFT = ("free_kit", "ED56BD86-3AF9-4E8E-9855-FBD046D33613", "CJBJMRPF00756-Suit")

# Only mappings verified against both the Shopify order data and CJ's exact
# variant endpoint belong here. A generic product SKU with multiple CJ variants
# must stay unmapped until the merchant deliberately selects one.
PHYSICAL_ADDONS: dict[str, dict[str, str]] = {
    "50459892580647": {
        "key": "hair_gloss_100ml",
        "shopify_sku": "CJJT228873001AZ",
        "cj_vid": "2502110727121606600",
        "cj_sku": "CJJT228873001AZ",
    },
    "52010595320103": {
        "key": "argan_hair_mask_500g",
        "shopify_sku": "CJYD231269201AZ",
        "cj_vid": "2503011116441608900",
        "cj_sku": "CJYD231269201AZ",
    },
    "52010652401959": {
        "key": "keratin_hair_serum_50ml",
        "shopify_sku": "CJYD268780701AZ",
        "cj_vid": "2512250315511638400",
        "cj_sku": "CJYD268780701AZ",
    },
    "51885840400679": {
        "key": "beauty_headband_cc05_230",
        "shopify_sku": "CJYD3055354",
        "cj_vid": "2608130207121632101",
        "cj_sku": "CJYD305535402BY",
    },
}

SHOPIFY_ONLY_VARIANTS: dict[str, dict[str, str]] = {
    "51878069535015": {"key": "vip_priority_service", "kind": "service"},
    "51880636875047": {"key": "hair_recovery_guide", "kind": "digital"},
    "51880681472295": {"key": "glass_skin_guide", "kind": "digital"},
}


class ManifestError(ValueError):
    """Order lines cannot be projected into an exact physical manifest."""


class NeedsMappingError(ManifestError):
    """A physical Shopify line has no exact, approved CJ variant mapping."""


def _quantity(line: dict[str, Any]) -> int:
    try:
        quantity = int(line.get("quantity") or 0)
    except (TypeError, ValueError) as exc:
        raise ManifestError("Shopify line quantity is invalid") from exc
    if quantity < 0:
        raise ManifestError("Shopify line quantity cannot be negative")
    return quantity


def _line_id(line: dict[str, Any]) -> str:
    return str(line.get("id") or "").strip()


def _item(
    key: str,
    vid: str,
    sku: str,
    quantity: int,
    source_kind: str,
    source_line_ids: list[str],
    *,
    store_line_item_id: str = "",
) -> dict[str, Any]:
    return {
        "key": key,
        "vid": vid,
        "sku": sku,
        "quantity": quantity,
        "source_kind": source_kind,
        "source_line_ids": sorted(value for value in source_line_ids if value),
        "store_line_item_id": store_line_item_id,
    }


def build_order_manifest(order: dict[str, Any]) -> dict[str, Any]:
    """Return the complete physical CJ manifest for one Shopify order.

    Known nonphysical lines are recorded as ignored. Every unknown physical line
    fails closed so the worker cannot silently create an incomplete CJ order.
    """
    lines = list(order.get("line_items") or [])
    bundle_indexes = [
        index
        for index, line in enumerate(lines)
        if str(line.get("sku") or "").startswith("NOVASALE-")
    ]
    if len(bundle_indexes) != 1:
        raise ManifestError("Expected exactly one NovaHair bundle line")

    bundle_index = bundle_indexes[0]
    bundle_line = lines[bundle_index]
    bundle_sku = str(bundle_line.get("sku") or "")
    match = BUNDLE_SKU_RE.fullmatch(bundle_sku)
    if not match:
        raise ManifestError(f"Unsupported bundle SKU {bundle_sku}")

    bundle_size, *shade_counts = (int(value) for value in match.groups())
    if sum(shade_counts) != bundle_size:
        raise ManifestError("Shade quantities do not equal bundle size")
    bundle_quantity = _quantity(bundle_line)
    if bundle_quantity < 1:
        raise ManifestError("Bundle quantity must be positive")

    bundle_line_id = _line_id(bundle_line)
    items: list[dict[str, Any]] = []
    for (key, vid, sku), count in zip(COMPONENTS, shade_counts):
        quantity = count * bundle_quantity
        if quantity:
            items.append(
                _item(
                    key,
                    vid,
                    sku,
                    quantity,
                    "bundle_component",
                    [bundle_line_id],
                )
            )
    items.append(
        _item(
            GIFT[0],
            GIFT[1],
            GIFT[2],
            bundle_quantity,
            "bundle_gift",
            [bundle_line_id],
        )
    )

    ignored: list[dict[str, Any]] = []
    addon_totals: dict[str, dict[str, Any]] = {}
    for index, line in enumerate(lines):
        if index == bundle_index:
            continue
        quantity = _quantity(line)
        if quantity == 0:
            continue
        variant_id = str(line.get("variant_id") or "").strip()
        sku = str(line.get("sku") or "").strip()
        line_id = _line_id(line)

        shopify_only = SHOPIFY_ONLY_VARIANTS.get(variant_id)
        if shopify_only:
            ignored.append(
                {
                    "key": shopify_only["key"],
                    "kind": shopify_only["kind"],
                    "variant_id": variant_id,
                    "sku": sku,
                    "quantity": quantity,
                    "source_line_id": line_id,
                }
            )
            continue

        mapping = PHYSICAL_ADDONS.get(variant_id)
        if mapping:
            if sku != mapping["shopify_sku"]:
                raise NeedsMappingError(
                    "NEEDS_MAPPING Shopify SKU mismatch for "
                    f"variant_id={variant_id}: expected {mapping['shopify_sku']}, got {sku or 'missing'}"
                )

            aggregate = addon_totals.setdefault(
                variant_id,
                {
                    "mapping": mapping,
                    "quantity": 0,
                    "source_line_ids": [],
                },
            )
            aggregate["quantity"] += quantity
            if line_id:
                aggregate["source_line_ids"].append(line_id)
            continue

        if line.get("requires_shipping") is False:
            ignored.append(
                {
                    "key": "nonshipping_line",
                    "kind": "nonshipping",
                    "variant_id": variant_id,
                    "sku": sku,
                    "quantity": quantity,
                    "source_line_id": line_id,
                }
            )
            continue

        if not mapping:
            raise NeedsMappingError(
                "NEEDS_MAPPING physical Shopify line "
                f"variant_id={variant_id or 'missing'} sku={sku or 'missing'}"
            )

    for variant_id in sorted(addon_totals):
        aggregate = addon_totals[variant_id]
        mapping = aggregate["mapping"]
        source_line_ids = sorted(set(aggregate["source_line_ids"]))
        items.append(
            _item(
                mapping["key"],
                mapping["cj_vid"],
                mapping["cj_sku"],
                aggregate["quantity"],
                "physical_addon",
                source_line_ids,
                store_line_item_id=source_line_ids[0] if source_line_ids else "",
            )
        )

    composition: dict[str, int] = {}
    for item in items:
        composition[item["key"]] = composition.get(item["key"], 0) + int(item["quantity"])

    manifest = {
        "bundle_sku": bundle_sku,
        "bundle_size": bundle_size,
        "bottle_count": bundle_size * bundle_quantity,
        "composition": composition,
        "items": items,
        "ignored": ignored,
        "has_physical_addons": any(item["source_kind"] == "physical_addon" for item in items),
    }
    manifest["fingerprint"] = source_fingerprint(items)
    manifest["product_fingerprint"] = product_fingerprint(expected_products(items))
    return manifest


def expected_products(items: list[dict[str, Any]]) -> dict[str, int]:
    products: dict[str, int] = {}
    for item in items:
        vid = str(item.get("vid") or "")
        quantity = int(item.get("quantity") or 0)
        if vid and quantity:
            products[vid] = products.get(vid, 0) + quantity
    return dict(sorted(products.items()))


def actual_products(product_list: list[dict[str, Any]]) -> dict[str, int]:
    products: dict[str, int] = {}
    for item in product_list or []:
        vid = str(item.get("vid") or item.get("variantId") or "")
        quantity = int(item.get("quantity") or 0)
        if vid and quantity:
            products[vid] = products.get(vid, 0) + quantity
    return dict(sorted(products.items()))


def source_fingerprint(items: list[dict[str, Any]]) -> str:
    canonical = [
        {
            "vid": str(item.get("vid") or ""),
            "sku": str(item.get("sku") or ""),
            "quantity": int(item.get("quantity") or 0),
            "source_line_ids": sorted(str(value) for value in (item.get("source_line_ids") or [])),
        }
        for item in items
    ]
    canonical.sort(key=lambda item: (item["vid"], item["sku"], item["source_line_ids"]))
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def product_fingerprint(products: dict[str, int]) -> str:
    encoded = json.dumps(dict(sorted(products.items())), separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def manifest_diff(
    items: list[dict[str, Any]], product_list: list[dict[str, Any]]
) -> dict[str, Any]:
    expected = expected_products(items)
    actual = actual_products(product_list)
    return {
        "matches": expected == actual,
        "expected": expected,
        "actual": actual,
        "expected_product_fingerprint": product_fingerprint(expected),
        "actual_product_fingerprint": product_fingerprint(actual),
    }


def order_age_seconds(
    order: dict[str, Any], *, now: dt.datetime | None = None
) -> float | None:
    value = str(order.get("created_at") or "").strip()
    if not value:
        return None
    try:
        created = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=dt.timezone.utc)
    current = now or dt.datetime.now(dt.timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=dt.timezone.utc)
    return max(0.0, (current - created).total_seconds())


def settle_remaining_seconds(
    order: dict[str, Any], settle_seconds: int, *, now: dt.datetime | None = None
) -> int | None:
    age = order_age_seconds(order, now=now)
    if age is None:
        return None
    return max(0, int(math.ceil(settle_seconds - age)))
