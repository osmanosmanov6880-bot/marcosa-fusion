#!/usr/bin/env python3
"""R5 visual QA captures of the actual public story pilot in Chromium.
Software rendered snapshots only; no fabricated physical-device results.
"""
from __future__ import annotations
import json
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/"dist"
OUTPUT=ROOT/"qa-r5"
CHROME=next((p for n in ("google-chrome","google-chrome-stable","chromium","chromium-browser")
             if (p:=shutil.which(n))),None)
FILES=("stories.html","stories.css","stories.js","network.js","index.html","network.css","immersive.css","immersive.js")

def hook(mode:str)->tuple[str,str]:
    # Instead of JS scrollIntoView (which can produce a blank headless snapshot
    # under virtual time), present the true component at the top of a *temporary
    # screenshot copy*. No styles in the production app are modified.
    if mode=="hero":
        script=""
        styles=""
    elif mode=="scene":
        script=""
        styles="""header.ms-topbar,.ms-hero,.ms-ticker,.ms-stories,
            .ms-values,.ms-studio,.ms-privacy,.ms-footer{display:none!important}
            .ms-stage{margin:14px auto!important;max-width:1320px!important}"""
    elif mode=="ending":
        script="""
          document.querySelector('[data-story-id="signal"]').click();
          document.querySelector('#ms-choices .ms-choice').click();
          document.querySelector('#ms-choices .ms-choice').click();
        """
        styles="""header.ms-topbar,.ms-hero,.ms-ticker,.ms-stories,
            .ms-values,.ms-studio,.ms-privacy,.ms-footer{display:none!important}
            .ms-stage{margin:14px auto!important;max-width:1320px!important}"""
    elif mode=="creator":
        script=""
        styles="""header.ms-topbar,.ms-hero,.ms-ticker,.ms-stories,.ms-stage,
            .ms-values,.ms-privacy,.ms-footer{display:none!important}
            .ms-studio{margin:0 auto!important;padding-top:18px!important}"""
    else:
        raise ValueError(mode)
    js="<script>window.addEventListener('load',function(){setTimeout(function(){"+script+"},350);});</script>"
    return js,"<style>"+styles+"</style>"
def main()->None:
    if not CHROME:
        print("R5 browser visual QA SKIP: Chrome binary not available")
        return
    OUTPUT.mkdir(exist_ok=True)
    cases=[
        ("desktop-portal",1440,900,"hero"),
        ("desktop-first-choice",1440,900,"scene"),
        ("desktop-outcome",1440,900,"ending"),
        ("mobile-portal",390,844,"hero"),
        ("mobile-choice",390,844,"scene"),
        ("mobile-outcome",390,844,"ending"),
        ("mobile-creator",390,844,"creator")
    ]
    reports=[]
    with tempfile.TemporaryDirectory(prefix="marcosa-r5-visual-") as temp:
        here=Path(temp)
        for name in FILES:
            shutil.copyfile(DIST/name,here/name)
        base=(here/"stories.html").read_text(encoding="utf-8")
        for label,width,height,mode in cases:
            js,styles=hook(mode)
            custom=base.replace("</head>",styles+"</head>").replace("</body>",js+"</body>")
            (here/"capture.html").write_text(custom,encoding="utf-8")
            png=OUTPUT/(label+".png")
            cmd=[CHROME,"--headless=new","--no-sandbox","--disable-dev-shm-usage",
                 "--allow-file-access-from-files","--disable-background-networking",
                 "--force-device-scale-factor=1","--virtual-time-budget=3500",
                 "--hide-scrollbars","--window-size={},{}".format(width,height),
                 "--screenshot="+str(png),(here/"capture.html").as_uri()]
            try:
                done=subprocess.run(cmd,capture_output=True,text=True,timeout=48)
            except subprocess.TimeoutExpired:
                reports.append({"case":label,"status":"timeout"})
                continue
            if not png.is_file() or png.stat().st_size<(14000 if width>700 else 7500):
                reports.append({"case":label,"status":"missing","exit":done.returncode})
                continue
            raw=png.read_bytes()
            if raw[:8]!=bytes((137,80,78,71,13,10,26,10)):
                reports.append({"case":label,"status":"not_png"})
                continue
            w,h=struct.unpack(">II",raw[16:24])
            reports.append({"case":label,"status":"captured","width":w,"height":h,"bytes":len(raw)})
    (OUTPUT/"summary.json").write_text(json.dumps(reports,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("R5 visual captures:",reports)
    if len([x for x in reports if x["status"]=="captured"])<5:
        raise SystemExit("R5 critical browser snapshots missing")

if __name__=="__main__":
    main()
