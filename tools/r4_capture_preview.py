#!/usr/bin/env python3
"""Capture the *actual* R4 static preview using CI's Chromium software renderer.

Snapshots are local CI evidence; they cannot certify user-device GPU FPS.
"""
from __future__ import annotations

import json
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
OUTPUT = ROOT / "qa-r4"
BROWSER = next((path for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
                if (path := shutil.which(name))), None)


def main() -> None:
    if not BROWSER:
        print("Browser screenshot QA skipped: Chrome/Chromium absent")
        return
    OUTPUT.mkdir(exist_ok=True)
    cases = [
        ("desktop-webgl", 1440, 900, False, False),
        ("desktop-catalog", 1440, 900, False, True),
        ("mobile-webgl", 390, 844, False, False),
        ("mobile-catalog", 390, 844, False, True),
        ("mobile-static", 390, 844, True, False),
    ]
    reports = []
    with tempfile.TemporaryDirectory(prefix="marcosa-r4-snap-") as tmp:
        here = Path(tmp)
        # R22: evidence must render the real deployed brand/layout and sourced
        # artwork, not the unstyled HTML produced by copying only 5 R4 assets.
        needed = (
            "index.html", "network.js", "network.css", "immersive.js", "immersive.css",
            "marcosa-brand.css", "marcosa-brand.js", "marcosa-gateway.js",
            "marcosa-cinematic.css", "marcosa-quiet.css", "marcosa-quiet.js", "marcosa-nocturne.css", "marcosa-mark.svg",
            "visual-station.webp", "visual-city.webp", "visual-cascade.webp",
            "visual-hero.webp", "visual-archive.webp", "visual-control.webp",
            "visual-operator.webp", "visual-earthrise.webp",
        )
        for filename in needed:
            shutil.copyfile(DIST / filename, here / filename)
        # Screenshots of the actual existing catalogue, not a mock-up.
        original = (here / "index.html").read_text(encoding="utf-8")
        catalog_hook = """<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    var button=document.querySelector('[data-mn-open]');
    if(button) button.click();
  },450);
});
</script>"""
        (here / "catalog.html").write_text(original.replace("</body>",catalog_hook+"</body>"),encoding="utf-8")
        for label, width, height, disable_gl, catalog in cases:
            target = OUTPUT / (label + ".png")
            cmd = [
                BROWSER, "--headless=new", "--no-sandbox",
                "--disable-dev-shm-usage", "--allow-file-access-from-files",
                "--disable-background-networking", "--enable-unsafe-swiftshader",
                "--use-angle=swiftshader", "--hide-scrollbars",
                "--force-device-scale-factor=1", "--virtual-time-budget=3000",
                "--window-size={},{}".format(width,height),
                "--screenshot={}".format(target),
            ]
            if disable_gl:
                cmd += ["--disable-webgl", "--disable-gpu"]
            cmd.append((here / ("catalog.html" if catalog else "index.html")).as_uri())
            try:
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
            except subprocess.TimeoutExpired:
                reports.append({"case":label,"result":"browser_timeout"})
                continue
            if not target.is_file() or target.stat().st_size < 1024:
                reports.append({"case":label,"result":"capture_unavailable","exit_code":p.returncode})
                continue
            data = target.read_bytes()
            if data[:8] != bytes((137,80,78,71,13,10,26,10)):
                reports.append({"case":label,"result":"invalid_png"})
                continue
            pw,ph = struct.unpack(">II",data[16:24])
            reports.append({"case":label,"result":"captured","size":[pw,ph],"bytes":len(data)})
    (OUTPUT / "summary.json").write_text(json.dumps(reports,indent=2)+"\n",encoding="utf-8")
    for row in reports:
        print("R4 browser screenshot",row)

if __name__ == "__main__":
    main()
