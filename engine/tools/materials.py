#!/usr/bin/env python3
"""Pack and audit project-owned surface maps. Requires Pillow and NumPy; no GPU.

See references/tour-upgrades.md for the manifest and independent catalogue format.
This tool validates files and declared coverage, never shader compilation or FPS.
"""
import argparse
import hashlib
import io
import json
import math
import re
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


class Invalid(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"),
                      parse_constant=lambda value: (_ for _ in ()).throw(Invalid(f"Invalid JSON number: {value}")))


def dimensions(value, label):
    require(isinstance(value, list) and len(value) == 2 and
            all(type(n) is int and n > 0 for n in value), f"{label}: expected two positive integer dimensions")
    return tuple(value)


def number(value, label, minimum=0, positive=False):
    require(type(value) in (int, float) and math.isfinite(value) and
            (value > minimum if positive else value >= minimum), f"{label}: invalid physical value")


def variants_by_id(entries, label):
    require(isinstance(entries, list) and entries, f"{label}: empty variant list")
    result = {}
    for entry in entries:
        require(isinstance(entry, dict), f"{label}: variant must be an object")
        ident = entry.get("id")
        require(isinstance(ident, str) and ident and ident not in result, f"{label}: missing or duplicate id {ident!r}")
        require(re.fullmatch(r"#[0-9a-fA-F]{6}", entry.get("color", "")) is not None, f"{ident}: expected #rrggbb color")
        result[ident] = entry
    return result


def source_map(root, spec, label):
    require(isinstance(spec, dict), f"{label}: missing map specification")
    relative = spec.get("path")
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute(), f"{label}: use a project-relative path")
    path = (root / relative).resolve()
    require(path.is_relative_to(root), f"{label}: source escapes the project")
    require(spec.get("bitDepth") in (8, 16), f"{label}: specify bitDepth 8 or 16")
    size = dimensions(spec.get("size"), label)
    data = path.read_bytes()
    require(sha(data) == spec.get("sha256"), f"{label}: source hash mismatch")
    with Image.open(io.BytesIO(data)) as image:
        image.load()  # Full decode, not just PNG/JPEG header inspection.
        require(image.size == size, f"{label}: decoded dimensions differ from manifest")
        if spec["bitDepth"] == 8:
            require(image.mode == "L", f"{label}: expected 8-bit grayscale, got {image.mode}")
        else:
            require(image.mode in ("I", "I;16", "I;16L", "I;16B"), f"{label}: expected 16-bit grayscale")
        values = np.asarray(image, dtype=np.float32)
    maximum = (1 << spec["bitDepth"]) - 1
    require(np.isfinite(values).all() and values.min() >= 0 and values.max() <= maximum, f"{label}: invalid data range")
    return values / maximum, path


def prepare(manifest_path, catalogue_path):
    manifest_path, catalogue_path = Path(manifest_path).resolve(), Path(catalogue_path).resolve()
    manifest, catalogue = read_json(manifest_path), read_json(catalogue_path)
    require(manifest.get("schema") == "interiors-materials/1", "Unknown material manifest schema")
    require(catalogue.get("schema") == "interiors-catalogue/1", "Unknown catalogue schema")
    expected = variants_by_id(catalogue.get("variants"), "Original catalogue")
    variants = variants_by_id(manifest.get("variants"), "Material manifest")
    require(expected.keys() == variants.keys(),
            f"Catalogue coverage mismatch; missing={sorted(expected.keys()-variants.keys())}, extra={sorted(variants.keys()-expected.keys())}")
    profiles = manifest.get("profiles")
    require(isinstance(profiles, dict) and profiles, "No surface profiles")
    used = set()
    for ident, variant in variants.items():
        require(variant["color"].lower() == expected[ident]["color"].lower(), f"{ident}: original catalogue color changed")
        require(variant.get("profile") in profiles, f"{ident}: unknown surface profile")
        used.add(variant["profile"])
    require(used == profiles.keys(), "Unused profiles: split optional assets from the shipped bundle")
    prepared, sources = {}, {manifest_path, catalogue_path}
    for ident, profile in profiles.items():
        require(re.fullmatch(r"[a-z0-9][a-z0-9_-]*", ident) is not None, f"Unsafe profile id: {ident}")
        provenance = profile.get("provenance", {})
        require(provenance.get("kind") in ("procedural", "provided", "licensed") and
                isinstance(provenance.get("reference"), str) and provenance["reference"].strip(), f"{ident}: record map provenance")
        tile = profile.get("tileMillimeters")
        require(isinstance(tile, list) and len(tile) == 2, f"{ident}: specify physical tile size")
        for n in tile:
            number(n, f"{ident}.tileMillimeters", positive=True)
        number(profile.get("depthMeters"), f"{ident}.depthMeters")
        target = dimensions(profile.get("webSize"), f"{ident}.webSize")
        maps = profile.get("maps", {})
        require(set(maps) == {"height", "roughness", "variation"}, f"{ident}: provide height, roughness, variation data maps")
        channels, native = [], None
        for role in ("height", "roughness", "variation"):
            values, path = source_map(manifest_path.parent, maps[role], f"{ident}.{role}")
            sources.add(path)
            size = (values.shape[1], values.shape[0])
            require(native is None or native == size, f"{ident}: source maps have different dimensions")
            native = size
            require(all(a <= b for a, b in zip(target, native)), f"{ident}: upscaling is not a source-resolution upgrade")
            resized = Image.fromarray(values).resize(target, Image.Resampling.LANCZOS)
            channels.append(np.asarray(resized))
        pixels = np.round(np.clip(np.stack(channels, axis=-1), 0, 1) * 255).astype(np.uint8)
        prepared[ident] = {"pixels": pixels, "nativeSize": native, "webSize": target,
                          "tileMillimeters": tile, "depthMeters": profile["depthMeters"]}
    return manifest, expected, prepared, sources


def encoded(pixels, format_name):
    stream = io.BytesIO()
    options = {"lossless": True, "method": 6} if format_name == "WEBP" else {}
    Image.fromarray(pixels).save(stream, format=format_name, **options)
    data = stream.getvalue()
    with Image.open(io.BytesIO(data)) as check:
        check.load()
        require(check.mode == "RGB" and np.array_equal(np.asarray(check), pixels), f"{format_name}: encoded pixel mismatch")
    return data


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".surface-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        require(temporary.read_bytes() == data, f"Write verification failed: {path.name}")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def pack(manifest_path, catalogue_path, out):
    manifest, expected, prepared, sources = prepare(manifest_path, catalogue_path)
    out = Path(out).resolve()
    destinations = [out / f"{ident}.{ext}" for ident in prepared for ext in ("webp", "png")] + [out / "bundle.json"]
    require(not any(p.resolve() in sources for p in destinations), "Output would overwrite a source file")
    receipt = {"schema": "interiors-material-bundle/1", "manifestSha256": sha(Path(manifest_path).read_bytes()),
               "catalogueSha256": sha(Path(catalogue_path).read_bytes()),
               "channels": {"R": "height", "G": "roughness", "B": "variation"},
               "colorSpace": "data-linear", "packedBitDepth": 8, "profiles": {}}
    out.mkdir(parents=True, exist_ok=True)
    # Encode and decode every pair before publishing. Receipt is written last.
    with tempfile.TemporaryDirectory(prefix=".materials-", dir=out) as temp:
        staging = Path(temp)
        for ident, data in prepared.items():
            record = {k: v for k, v in data.items() if k != "pixels"}
            record["files"] = {}
            for ext, fmt in (("webp", "WEBP"), ("png", "PNG")):
                name = f"{ident}.{ext}"
                blob = encoded(data["pixels"], fmt)
                atomic_write(staging / name, blob)
                record["files"][ext] = {"path": name, "sha256": sha(blob), "bytes": len(blob)}
            record["estimatedRgbaMipBytes"] = math.ceil(math.prod(data["webSize"]) * 4 * 4 / 3)
            receipt["profiles"][ident] = record
        for path in staging.iterdir():
            atomic_write(out / path.name, path.read_bytes())
    atomic_write(out / "bundle.json", (json.dumps(receipt, ensure_ascii=False, indent=2) + "\n").encode())
    return check(manifest_path, catalogue_path, out)


def check(manifest_path, catalogue_path, out, runtime_path=None):
    manifest, expected, prepared, _ = prepare(manifest_path, catalogue_path)
    out = Path(out).resolve()
    receipt = read_json(out / "bundle.json")
    require(receipt.get("schema") == "interiors-material-bundle/1", "Unknown bundle schema")
    require(receipt.get("manifestSha256") == sha(Path(manifest_path).read_bytes()), "Bundle was built from another manifest")
    require(receipt.get("catalogueSha256") == sha(Path(catalogue_path).read_bytes()), "Bundle was built from another catalogue")
    require(receipt.get("channels") == {"R": "height", "G": "roughness", "B": "variation"} and
            receipt.get("colorSpace") == "data-linear" and receipt.get("packedBitDepth") == 8, "Packed channel contract changed")
    require(set(receipt.get("profiles", {})) == set(prepared), "Bundle profile coverage mismatch")
    download_bytes, gpu_bytes = 0, 0
    for ident, data in prepared.items():
        record = receipt["profiles"][ident]
        for key in ("nativeSize", "webSize", "tileMillimeters", "depthMeters"):
            expected_value = list(data[key]) if isinstance(data[key], tuple) else data[key]
            require(record.get(key) == expected_value, f"{ident}: packed {key} changed")
        for ext in ("webp", "png"):
            file = record["files"][ext]
            require(file.get("path") == f"{ident}.{ext}", f"{ident}: unexpected packed path")
            blob = (out / file["path"]).read_bytes()
            require(sha(blob) == file.get("sha256") and len(blob) == file.get("bytes"), f"{ident}.{ext}: packed file changed")
            with Image.open(io.BytesIO(blob)) as image:
                image.load()
                require(image.mode == "RGB" and np.array_equal(np.asarray(image), data["pixels"]), f"{ident}.{ext}: packed pixels differ from source channels")
            if ext == "webp":
                download_bytes += len(blob)
        gpu_bytes += math.ceil(math.prod(data["webSize"]) * 4 * 4 / 3)
    runtime_coverage = None
    if runtime_path:
        observation = read_json(runtime_path)
        require(observation.get("schema") == "interiors-material-observations/1", "Unknown runtime observation schema")
        observed = variants_by_id(observation.get("variants"), "Runtime observations")
        require(observed.keys() == expected.keys(), "Runtime material coverage mismatch")
        for ident, variant in variants_by_id(manifest["variants"], "Manifest").items():
            actual = observed[ident]
            require(actual.get("profile") == variant["profile"] and actual["color"].lower() == variant["color"].lower(), f"{ident}: runtime assignment changed")
            require(actual.get("packedSha256") == receipt["profiles"][variant["profile"]]["files"]["webp"]["sha256"], f"{ident}: runtime uses another packed map")
            require(all(actual.get(k) is True for k in ("existing", "fresh", "cacheIdentity")), f"{ident}: existing/fresh/cache material checks incomplete")
        runtime_coverage = f"{len(observed)}/{len(expected)}"
    return {"result": "PASS", "scope": "files-and-catalogue", "declaredCoverage": f"{len(expected)}/{len(expected)}",
            "profiles": len(prepared), "runtimeObservationCoverage": runtime_coverage,
            "browserMapBytes": download_bytes, "estimatedRgbaMipBytes": gpu_bytes,
            "packedWebpAndPngPixels": "identical", "webgl": "UNVERIFIED", "fps": "UNMEASURED"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("pack", "check"))
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--catalogue", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--runtime", type=Path, help="Recorded factory observations; only for check")
    args = parser.parse_args()
    try:
        require(args.command == "check" or args.runtime is None, "--runtime is only valid with check")
        result = pack(args.manifest, args.catalogue, args.out) if args.command == "pack" else check(args.manifest, args.catalogue, args.out, args.runtime)
    except (Invalid, OSError, KeyError, TypeError, ValueError) as error:
        print(json.dumps({"result": "FAIL", "error": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
