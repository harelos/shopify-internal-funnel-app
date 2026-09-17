"""Pure NovaHair bundle composition parsing shared by the CJ sync worker."""

from __future__ import annotations

import re


LEGACY_SKU_RE = re.compile(r"^NOVASALE-(2|4|6)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$")
SIX_SHADE_SKU_RE = re.compile(r"^NOVASALE-(2|4|6)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$")

COMPONENTS = (
    ("black", "2412030839551624000", "CJYD223160001AZ"),
    ("dark_brown", "2412030839551624200", "CJYD223160002BY"),
    ("medium_brown", "2507140803121609000", "CJYD223160006FU"),
    ("light_brown", "2412030839551624400", "CJYD223160003CX"),
    ("purple", "2412030839551624700", "CJYD223160005EV"),
    ("red", "2412030839551624600", "CJYD223160004DW"),
)


def parse_bundle_sku(sku: str) -> tuple[int, tuple[int, ...]] | None:
    """Decode old five-shade and new six-shade bundle SKUs.

    Legacy counts are expanded with a zero in the medium-brown position so all
    downstream code works with one stable six-component order.
    """
    value = str(sku or "").strip()
    match = SIX_SHADE_SKU_RE.fullmatch(value)
    if match:
        bundle_size, *counts = (int(part) for part in match.groups())
    else:
        match = LEGACY_SKU_RE.fullmatch(value)
        if not match:
            return None
        bundle_size, black, dark_brown, light_brown, purple, red = (
            int(part) for part in match.groups()
        )
        counts = [black, dark_brown, 0, light_brown, purple, red]
    if sum(counts) != bundle_size:
        return None
    return bundle_size, tuple(counts)
