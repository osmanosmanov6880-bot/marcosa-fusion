#!/usr/bin/env python3
"""R4 offline Chrome/Chromium smoke: try WebGL2 shader compilation via a software renderer.

This is a CI browser smoke test, NOT a physical GPU benchmark.
It never opens external URLs, tracks users or changes production files.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
CHROME = next((p for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
               if (p := shutil.which(n))), None)

INJECT = """<script>
(function () {
  window.setTimeout(function () {
    var canvas = document.getElementById('mi-world-canvas');
    var stage = document.getElementById('mi-stage');
    var dialog = document.getElementById('mn-dialog');
    var gl = canvas && canvas.getContext('webgl2');
    var pass = !!(stage && dialog && window.MarcosaNetworkPreview && window.MarcosaImmersive);
    if (gl) pass = pass && stage.classList.contains('mi-webgl-active');
    var result = document.createElement('meta');
    result.name = 'r4-smoke-result';
    result.content = pass ? (gl ? 'PASS-WEBGL2' : 'PASS-2D-FALLBACK') : 'FAIL-INITIALIZATION';
    document.head.appendChild(result);
  }, 1000);
})();
</script>"""

def run() -> int:
    if not CHROME:
        print("R4 browser smoke: SKIP, no Chromium/Chrome binary available")
        return 0
    if not (DIST / "index.html").is_file():
        print("R4 browser smoke: missing built dist/index.html", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="marcosa-r4-browser-") as work:
        target = Path(work)
        for name in ("network.css", "network.js", "immersive.css", "immersive.js"):
            shutil.copyfile(DIST / name, target / name)
        html = (DIST / "index.html").read_text(encoding="utf-8")
        if "</body>" not in html:
            raise SystemExit("R4 browser smoke: malformed preview HTML")
        (target / "index.html").write_text(html.replace("</body>", INJECT + "</body>"),
                                          encoding="utf-8")
        cmd = [CHROME, "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
               "--allow-file-access-from-files", "--enable-unsafe-swiftshader",
               "--use-angle=swiftshader", "--disable-background-networking",
               "--virtual-time-budget=4000", "--window-size=1400,900",
               "--dump-dom", (target / "index.html").as_uri()]
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
        except subprocess.TimeoutExpired:
            print("R4 browser smoke: timed out", file=sys.stderr)
            return 3
        match = re.search(r'<meta name="r4-smoke-result" content="([^"]+)">', proc.stdout)
        if not match:
            print("R4 browser smoke: browser did not complete the check (exit {})".format(proc.returncode),
                  file=sys.stderr)
            print(proc.stderr[-1300:], file=sys.stderr)
            return 4
        status = match.group(1)
        print("R4 Chromium software-renderer check:", status)
        if status == "PASS-2D-FALLBACK":
            print("WebGL2 unavailable here; shader compilation NOT verified. Physical hardware test still required.")
        if status == "PASS-WEBGL2":
            print("WebGL2 shader initialization confirmed on runner; physical GPU FPS still unmeasured.")
        return 0 if status.startswith("PASS-") else 5

if __name__ == "__main__":
    raise SystemExit(run())
