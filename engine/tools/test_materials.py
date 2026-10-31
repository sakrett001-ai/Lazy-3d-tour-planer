#!/usr/bin/env python3
"""CPU tests of corruption handling, coverage and lossless surface packing."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

import materials


class MaterialBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.out = self.root / "out"
        self.manifest = self.root / "materials.json"
        self.catalogue = self.root / "catalogue.json"
        self.maps = {}
        for name, pixels, bits in (
            ("height", np.arange(64, dtype=np.uint16).reshape(8, 8) * 1000, 16),
            ("roughness", np.full((8, 8), 173, dtype=np.uint8), 8),
            ("variation", np.arange(64, dtype=np.uint8).reshape(8, 8) * 4, 8),
        ):
            path = self.root / (name + ".png")
            Image.fromarray(pixels).save(path)
            self.maps[name] = {"path": path.name, "bitDepth": bits, "size": [8, 8],
                               "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        self.cat = {"schema": "interiors-catalogue/1", "variants": [
            {"id": "seat-light", "color": "#c0b8aa"}, {"id": "seat-dark", "color": "#303238"},
            {"id": "panel", "color": "#adb0b8"}]}
        profile = {"provenance": {"kind": "procedural", "reference": "Synthetic test fields"},
                   "tileMillimeters": [80, 120], "depthMeters": 0.0002, "webSize": [8, 8], "maps": self.maps}
        self.spec = {"schema": "interiors-materials/1", "profiles": {"woven": profile, "coating": copy.deepcopy(profile)},
                     "variants": [{**v, "profile": "coating" if v["id"] == "panel" else "woven"} for v in self.cat["variants"]]}
        self.save()

    def save(self):
        self.manifest.write_text(json.dumps(self.spec))
        self.catalogue.write_text(json.dumps(self.cat))

    def pack(self):
        return materials.pack(self.manifest, self.catalogue, self.out)

    def test_round_trip_has_correct_channels_and_no_gpu_claim(self):
        result = self.pack()
        self.assertEqual(result["declaredCoverage"], "3/3")
        self.assertEqual(result["profiles"], 2)
        self.assertEqual(result["packedWebpAndPngPixels"], "identical")
        self.assertIsNone(result["runtimeObservationCoverage"])
        self.assertEqual(result["webgl"], "UNVERIFIED")
        with Image.open(self.out / "woven.png") as image:
            pixels = np.asarray(image)
        expected = np.round(np.arange(64).reshape(8, 8) * 1000 / 65535 * 255).astype(np.uint8)
        np.testing.assert_array_equal(pixels[:, :, 0], expected)
        np.testing.assert_array_equal(pixels[:, :, 1], np.full((8, 8), 173))
        np.testing.assert_array_equal(pixels[:, :, 2], np.arange(64).reshape(8, 8) * 4)

    def test_every_original_variant_is_required(self):
        self.spec["variants"].pop()
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "coverage mismatch"):
            self.pack()

    def test_duplicate_and_original_color_change_fail(self):
        self.spec["variants"].append(copy.deepcopy(self.spec["variants"][0]))
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "duplicate"):
            self.pack()
        self.spec["variants"].pop()
        self.spec["variants"][0]["color"] = "#ffffff"
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "color changed"):
            self.pack()

    def test_source_tamper_fails(self):
        (self.root / "height.png").write_bytes(b"not an image")
        with self.assertRaisesRegex(materials.Invalid, "hash mismatch"):
            self.pack()

    def test_full_decode_rejects_truncated_source_even_with_matching_hash(self):
        path = self.root / "height.png"
        path.write_bytes(path.read_bytes()[:45])
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        for p in self.spec["profiles"].values():
            p["maps"]["height"]["sha256"] = digest
        self.save()
        with self.assertRaises(OSError):
            self.pack()

    def test_packed_corruption_and_changed_manifest_fail(self):
        self.pack()
        path = self.out / "woven.webp"
        path.write_bytes(path.read_bytes()[:20])
        with self.assertRaisesRegex(materials.Invalid, "packed file changed"):
            materials.check(self.manifest, self.catalogue, self.out)
        self.pack()
        self.spec["profiles"]["woven"]["depthMeters"] = 0.001
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "another manifest"):
            materials.check(self.manifest, self.catalogue, self.out)

    def test_no_upscaling_and_honest_downsample_dimensions(self):
        self.spec["profiles"]["woven"]["webSize"] = [16, 16]
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "upscaling"):
            self.pack()
        self.spec["profiles"]["woven"]["webSize"] = [4, 4]
        self.save()
        self.pack()
        receipt = materials.read_json(self.out / "bundle.json")
        self.assertEqual(receipt["profiles"]["woven"]["nativeSize"], [8, 8])
        self.assertEqual(receipt["profiles"]["woven"]["webSize"], [4, 4])

    def test_runtime_report_checks_new_instances_and_exact_source_map(self):
        self.pack()
        receipt = materials.read_json(self.out / "bundle.json")
        report = {"schema": "interiors-material-observations/1", "variants": [
            {**v, "packedSha256": receipt["profiles"][v["profile"]]["files"]["webp"]["sha256"],
             "existing": True, "fresh": True, "cacheIdentity": True} for v in self.spec["variants"]]}
        path = self.root / "observations.json"
        path.write_text(json.dumps(report))
        result = materials.check(self.manifest, self.catalogue, self.out, path)
        self.assertEqual(result["runtimeObservationCoverage"], "3/3")
        self.assertEqual(result["webgl"], "UNVERIFIED")
        report["variants"][0]["fresh"] = False
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(materials.Invalid, "incomplete"):
            materials.check(self.manifest, self.catalogue, self.out, path)
        report["variants"][0]["fresh"] = True
        report["variants"][0]["packedSha256"] = "0" * 64
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(materials.Invalid, "another packed map"):
            materials.check(self.manifest, self.catalogue, self.out, path)

    def test_encoding_failure_keeps_previous_bundle(self):
        self.pack()
        before = {p.name: p.read_bytes() for p in self.out.iterdir()}
        original = materials.encoded
        def broken(pixels, fmt):
            if fmt == "PNG":
                raise OSError("encoder interrupted")
            return original(pixels, fmt)
        with patch.object(materials, "encoded", side_effect=broken):
            with self.assertRaisesRegex(OSError, "interrupted"):
                self.pack()
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.out.iterdir()})

    def test_source_escape_and_invalid_scale_fail(self):
        self.spec["profiles"]["woven"]["maps"]["height"]["path"] = "../outside.png"
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "escapes"):
            self.pack()
        self.spec["profiles"]["woven"]["maps"]["height"]["path"] = "height.png"
        self.spec["profiles"]["woven"]["tileMillimeters"] = [0, 60]
        self.save()
        with self.assertRaisesRegex(materials.Invalid, "physical value"):
            self.pack()


if __name__ == "__main__":
    unittest.main()
