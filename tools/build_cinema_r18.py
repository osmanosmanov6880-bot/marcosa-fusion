#!/usr/bin/env python3
"""R18 deterministic offline bundles built from pinned, independent GitHub cinemas."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import re
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
PINS = {
    "protocol-zero": "0f1841c0e56e47f7413bea9948e66200409e7a7a",
    "adverse-judge": "f48a00510984a3da2d5527cd01ef8a51f102881e",
}

def read(base: Path, rel: str) -> str:
    p = base / rel
    if not p.is_file() or p.is_symlink():
        raise RuntimeError("Missing/unsafe source file: " + str(p))
    return p.read_text("utf-8")

def check_revision(repo: Path, slug: str) -> None:
    r = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"],
                       check=True, capture_output=True, text=True)
    if r.stdout.strip() != PINS[slug]:
        raise RuntimeError("Source revision changed: " + slug)

def data_uri(p: Path, mime: str) -> str:
    if not p.is_file() or p.is_symlink() or p.stat().st_size > 300_000:
        raise RuntimeError("Missing/unsafe keyframe: " + str(p))
    return "data:" + mime + ";base64," + base64.b64encode(p.read_bytes()).decode("ascii")

def replace_once(text: str, old: str, new: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError("Source structure changed: " + old[:100])
    return text.replace(old, new)

def finish(html: str, slug: str, frames: int) -> str:
    if html.count("</body>") != 1 or html.count("</html>") != 1:
        raise RuntimeError("Incomplete " + slug)
    if re.search(r"<script\b[^>]*\bsrc\s*=", html, re.I):
        raise RuntimeError("Remote script in " + slug)
    if re.search(r"<link\b[^>]*\brel\s*=\s*['\"]stylesheet", html, re.I):
        raise RuntimeError("External stylesheet in " + slug)
    if html.count("data:image/webp;base64,") < frames:
        raise RuntimeError("Source WebP images are missing for " + slug)
    if not html.lower().startswith("<!doctype html>"):
        raise RuntimeError("Doctype missing in " + slug)
    return "<!-- MARCOSA R18 | owner-supplied independent cinema | offline source snapshot -->\n" + html

def protocol(base: Path) -> str:
    html = read(base, "index.html")
    css = read(base, "src/main.css")
    order = ("story/scenes.mjs", "story/prototype.mjs", "story/engine.mjs",
             "story/site-config.mjs", "src/audio.mjs", "src/particles.mjs",
             "src/reality.mjs", "src/app.mjs")
    modules = []
    for rel in order:
        body = read(base, rel)
        body = re.sub(r"^import .*?;\s*$", "", body, flags=re.M)
        body = re.sub(r"^export (?=(?:const|function|class)\b)", "", body, flags=re.M)
        if re.search(r"^\s*(?:import|export)\s", body, re.M):
            raise RuntimeError("Unexpected module syntax in " + rel)
        modules.append("// " + rel + "\n" + body)
    js = "\n;\n".join(modules)
    pictures = {p.name: data_uri(p, "image/webp")
                for p in sorted((base / "assets/keyframes").glob("*.webp"))}
    if len(pictures) != 18:
        raise RuntimeError("Protocol Zero: expected all 18 keyframes")
    template = chr(96)
    variable = chr(36)
    image_expr = (template + "assets/keyframes/" + variable + "{scene.image}-"
                  + variable + "{device}.webp" + template)
    old = "function imageUrl(scene,device){return " + image_expr + ";}"
    new = ("const _offlineImages=" + json.dumps(pictures, separators=(",", ":")) + ";\n"
           + "function imageUrl(scene,device){return _offlineImages["
           + template + variable + "{scene.image}-" + variable + "{device}.webp"
           + template + "]||_offlineImages['city_dawn-desktop.webp'];}")
    js = replace_once(js, old, new)
    html = replace_once(html, '<script type="module" src="src/app.mjs"></script>', "")
    html = replace_once(html, '<link rel="stylesheet" href="src/main.css"/>',
                        "<style>\n" + css + "\n</style>")
    html = re.sub(r'<link rel="preload"[^>]*>', "", html)
    for name in ("city_dawn-desktop.webp", "city_dawn-mobile.webp"):
        html = html.replace("assets/keyframes/" + name, pictures[name])
    html = replace_once(html, 'href="assets/ui/sigil.svg"',
                        'href="' + data_uri(base / "assets/ui/sigil.svg", "image/svg+xml") + '"')
    html = replace_once(html, "</body>",
                        '<script>\n"use strict";\n' + js.replace("</script", "<\\/script") + "\n</script>\n</body>")
    if "class RealityBridge" not in html or "network-continuation" not in html:
        raise RuntimeError("Finale or RealityBridge source missing in PROTOCOL ZERO")
    return finish(html, "protocol-zero", 18)

def adverse(base: Path) -> str:
    html = read(base, "index.html")
    css = read(base, "src/style.css")
    html = replace_once(html, '<link rel="stylesheet" href="src/style.css">',
                        "<style>\n" + css + "\n</style>")
    pictures = {p.name: data_uri(p, "image/webp")
                for p in sorted((base / "assets").glob("*.webp"))}
    if len(pictures) != 20:
        raise RuntimeError("Adverse Judge: expected all 20 keyframes")
    asset_script = ("<script>window.CINEMA_ASSETS=" +
                    json.dumps(pictures, separators=(",", ":")) + ";</script>")
    for rel in ("data", "engine", "sound", "app"):
        code = read(base, "src/" + rel + ".js").replace("</script", "<\\/script")
        embedded = "<script>\n" + code + "\n</script>"
        if rel == "data":
            embedded = asset_script + "\n" + embedded
        html = replace_once(html, '<script src="src/' + rel + '.js"></script>', embedded)
    html = replace_once(
        html, '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
        '<link rel="icon" href="' + data_uri(base / "assets/favicon.svg", "image/svg+xml") + '" type="image/svg+xml">'
    )
    if "networkContinuation()" not in html or "scene_015" not in html:
        raise RuntimeError("Adverse Judge final scene source missing")
    return finish(html, "adverse-judge", 20)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--protocol-repo", type=Path, required=True)
    parser.add_argument("--adverse-repo", type=Path, required=True)
    a = parser.parse_args()
    check_revision(a.protocol_repo, "protocol-zero")
    check_revision(a.adverse_repo, "adverse-judge")
    records = []
    for slug, checkout, build in (
        ("protocol-zero", a.protocol_repo, protocol),
        ("adverse-judge", a.adverse_repo, adverse),
    ):
        data = build(checkout / "cinema").encode("utf-8")
        if len(data) > 4_000_000:
            raise RuntimeError("Cinema source exceeds 4 MB release cap: " + slug)
        path = PROJECT / "site" / ("film-" + slug + ".html")
        path.write_bytes(data)
        records.append({"slug": slug, "source_commit": PINS[slug],
                        "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                        "public_file": path.relative_to(PROJECT).as_posix()})
    print(json.dumps({"schema": "marcosa-cinema-build/v1", "films": records}))

if __name__ == "__main__":
    main()
