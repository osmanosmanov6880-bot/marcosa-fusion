#!/usr/bin/env python3
"""R22: extract EXACT original WebP frames from owner's already-reviewed offline cinemas.

No image synthesis, generative model, network downloads or third-party assets.
Compiled film snapshots in site/ are the only inputs. The source R19 approval
is verified upstream by build_webroot.py. Output assets are deterministic.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
from pathlib import Path

PLAN = {
    "visual-station.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "station.webp"),
    "visual-city.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "city.webp"),
    "visual-cascade.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "cascade.webp"),
    "visual-hero.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "hero.webp"),
    "visual-archive.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "archive.webp"),
    "visual-control.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "control.webp"),
    "visual-operator.webp": ("film-opspilot.html", "MARCOSA_CINEMA_ART", "operator.webp"),
    "visual-earthrise.webp": ("film-intentgraph.html", "CINEMA_EMBEDDED_PLATES", "earthrise-1600"),
}


def extract(source: Path) -> dict[str, bytes]:
    bundles = {}
    output = {}
    for name, (file, global_name, image_key) in PLAN.items():
        if (source / file).is_symlink():
            raise RuntimeError("R22 symlink source forbidden: " + file)
        if file not in bundles:
            html = (source / file).read_text(encoding="utf-8")
            expr = r"window\\." + re.escape(global_name) + r"=(\\{.*?\\});"
            match = re.search(expr, html, flags=re.S)
            if not match:
                raise RuntimeError("R22 source image map missing: " + global_name)
            bundles[file] = json.loads(match.group(1))
        image = bundles[file].get(image_key)
        if not isinstance(image, str) or not image.startswith("data:image/webp;base64,"):
            raise RuntimeError("R22 original WebP frame missing: " + image_key)
        raw = base64.b64decode(image.partition(",")[2], validate=True)
        if not (15_000 <= len(raw) <= 260_000 and raw[:4] == b"RIFF"
                and raw[8:12] == b"WEBP"):
            raise RuntimeError("R22 unexpected image signature/size: " + image_key)
        output[name] = raw
    if len(output) != 8:
        raise RuntimeError("R22 incorrect sourced artwork count")
    return output


def place(source: Path, destination: Path, manifest: dict) -> None:
    for name, raw in extract(source).items():
        (destination / name).write_bytes(raw)
        manifest["files"][name] = hashlib.sha256(raw).hexdigest()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1] / "site")
    args = parser.parse_args()
    for k, v in extract(args.source).items():
        print(k, len(v), hashlib.sha256(v).hexdigest())
