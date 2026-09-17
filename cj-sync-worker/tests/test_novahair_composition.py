import unittest

from novahair_composition import COMPONENTS, parse_bundle_sku


class NovaHairCompositionTests(unittest.TestCase):
    def test_legacy_five_shade_sku_remains_compatible(self):
        parsed = parse_bundle_sku("NOVASALE-4-1-1-1-1-0")
        self.assertEqual(parsed, (4, (1, 1, 0, 1, 1, 0)))

    def test_six_shade_sku_maps_medium_brown_in_third_position(self):
        parsed = parse_bundle_sku("NOVASALE-4-1-0-2-1-0-0")
        self.assertEqual(parsed, (4, (1, 0, 2, 1, 0, 0)))

    def test_unbalanced_sku_is_rejected(self):
        self.assertIsNone(parse_bundle_sku("NOVASALE-4-0-0-2-0-0-0"))

    def test_medium_brown_cj_mapping_is_exact(self):
        medium = next(component for component in COMPONENTS if component[0] == "medium_brown")
        self.assertEqual(medium, ("medium_brown", "2507140803121609000", "CJYD223160006FU"))


if __name__ == "__main__":
    unittest.main()
