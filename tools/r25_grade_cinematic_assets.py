#!/usr/bin/env python3
"""R25 — deterministic digital color grade for user-owned cinema stills.

Input: R22's byte-verified 1600x900 extracted WebP frames. Output: compressed
high-quality WebP variants with moderate local sharpness, improved tonal separation,
and controlled saturation. No new scenes, no AI upscaling, no remote content.
Pillow is pinned in GitHub Actions. Original stills remain separately shipped.
This improves presentation; it does NOT invent native 4K details.
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

SHOTS = {
    "visual-city.webp": ("visual-city-director.webp", 1.09, 1.03, 1.10),
    "visual-cascade.webp": ("visual-cascade-director.webp", 1.07, 1.05, 1.09),
    "visual-hero.webp": ("visual-hero-director.webp", 1.10, 1.00, 1.08),
    "visual-archive.webp": ("visual-archive-director.webp", 1.09, 1.06, 1.10),
    "visual-control.webp": ("visual-control-director.webp", 1.10, 1.04, 1.10),
    "visual-station.webp": ("visual-station-director.webp", 1.09, 1.04, 1.11),
}


def grade(raw: bytes, contrast: float, color: float, sharpness: float) -> bytes:
    with Image.open(io.BytesIO(raw)) as im:
        if im.format != "WEBP" or im.size != (1600, 900):
            raise RuntimeError("R25 refusing unsupported source frame; originals required")
        image = im.convert("RGB")
        # Conservative film-grade operations. Graded and original must remain
        # identifiable as the very same composition; avoid fake detail.
        image = ImageEnhance.Color(image).enhance(color)
        image = ImageEnhance.Contrast(image).enhance(contrast)
        image = ImageEnhance.Brightness(image).enhance(1.015)
        image = image.filter(ImageFilter.UnsharpMask(radius=1.35, percent=150, threshold=3))
        image = ImageEnhance.Sharpness(image).enhance(sharpness)
        out = io.BytesIO()
        image.save(out, "WEBP", quality=95, method=6, exact=False)
        result = out.getvalue()
        if not (100_000 <= len(result) <= 750_000):
            raise RuntimeError("R25 derived visual size out of safe bounds")
        return result


def place(dest: Path, manifest: dict) -> dict[str, str]:
    digests = {}
    for original, (name, contrast, color, sharpness) in SHOTS.items():
        source = dest / original
        if not source.is_file() or source.is_symlink():
            raise RuntimeError("R25 missing original still: " + original)
        original_raw = source.read_bytes()
        result = grade(original_raw, contrast, color, sharpness)
        if result == original_raw:
            raise RuntimeError("R25 grader did not alter original: " + original)
        (dest / name).write_bytes(result)
        digest = hashlib.sha256(result).hexdigest()
        digests[name] = digest
        manifest["files"][name] = digest
    return digests


if __name__ == "__main__":
    import json
    import sys

    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dist")
    result = place(target, {"files": {}})
    print(json.dumps(result, indent=2))
