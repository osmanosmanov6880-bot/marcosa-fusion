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

def hook(mode:str)->str:
    if mode=="hero":
        script="window.scrollTo(0,0);"
    elif mode=="scene":
        script="document.getElementById('ms-stage').scrollIntoView({block:'start',behavior:'instant'});"
    elif mode=="ending":
        script="""
          document.querySelector('[data-story-id="signal"]').click();
          document.querySelector('#ms-choices .ms-choice').click();
          document.querySelector('#ms-choices .ms-choice').click();
          document.getElementById('ms-stage').scrollIntoView({block:'start',behavior:'instant'});
        """
    elif mode=="creator":
        script="document.getElementById('ms-studio').scrollIntoView({block:'start',behavior:'instant'});"
    else:
        raise ValueError(mode)
    return "<script>window.addEventListener('load',function(){setTimeout(function(){"+script+"},600);});</script>"

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
            (here/"capture.html").write_text(base.replace("</body>",hook(mode)+"</body>"),encoding="utf-8")
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
            if not png.is_file() or png.stat().st_size<1024:
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
