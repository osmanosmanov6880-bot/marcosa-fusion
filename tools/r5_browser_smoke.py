#!/usr/bin/env python3
"""R5 real browser smoke of branching story, language, opt-in QA, creator brief and deep link.
Software/browser QA only. This is NOT proof of physical GPU FPS, live users or deployment.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DIST=ROOT/"dist"
CHROME=next((p for name in ("google-chrome","google-chrome-stable","chromium","chromium-browser")
             if (p:=shutil.which(name))),None)

STORY_TEST=r"""<script>
window.addEventListener('load',function(){
  window.setTimeout(function(){
    try{
      const by=id=>document.getElementById(id);
      if(document.querySelectorAll('.ms-story-card').length!==3)throw Error('STORY_LIST');
      const signal=document.querySelector('[data-story-id="signal"]');
      if(!signal)throw Error('SIGNAL_CARD');
      const qa=by('ms-qa-opt');qa.checked=true;qa.dispatchEvent(new Event('change',{bubbles:true}));
      signal.click();
      let choices=document.querySelectorAll('.ms-choice');
      if(choices.length!==2)throw Error('CHOICES_ONE');
      choices[0].click();
      choices=document.querySelectorAll('.ms-choice');
      if(choices.length!==2)throw Error('CHOICES_TWO');
      choices[0].click();
      if(by('ms-finish').hidden)throw Error('OUTCOME_HIDDEN');
      if(by('ms-project-name').textContent!=='ProofOS')throw Error('RECOMMENDATION');
      if(!by('ms-project-link').href.endsWith('#network-product=proofos'))throw Error('DEEP_LINK');
      if(by('ms-qa-download').disabled)throw Error('QA_OPTIN_NOT_CAPTURED');
      document.querySelector('[data-ms-lang="zh"]').click();
      if(!by('ms-end-title').textContent||document.documentElement.lang!=='zh')throw Error('LANGUAGE');
      by('ms-brief-brand').value='MARCOSA ORIGINAL';
      by('ms-brief-audience').value='Independent creative studios';
      by('ms-brief-goal').value='Prepare a transparent branded story ending with voluntary continuation.';
      by('ms-brief-product').value='proofos';
      by('ms-brief-rights').checked=true;
      by('ms-brief-disclose').checked=true;
      by('ms-brief-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      if(by('ms-brief-preview').hidden||by('ms-brief-download').disabled)throw Error('BRIEF_EXPORT');
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='PASS-STORY-BRIEF-LINK';
      document.head.append(m);
    }catch(e){
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='FAIL-'+String(e.message||e).slice(0,90);
      document.head.append(m);
    }
  },600);
});
</script>"""

ROUTE_TEST=r"""<script>
window.addEventListener('load',function(){
  window.setTimeout(function(){
    try{
      const dialog=document.getElementById('mn-dialog');
      const search=document.getElementById('mn-search');
      const tab=document.querySelector('[data-mn-tab="products"]');
      if(!dialog||!dialog.open)throw Error('DIALOG_NOT_OPEN');
      if(search.value!=='ProofOS')throw Error('PRODUCT_NOT_FILTERED');
      if(tab.getAttribute('aria-pressed')!=='true')throw Error('PRODUCT_TAB');
      if(document.querySelectorAll('#mn-grid .mn-card').length!==1)throw Error('CARD_FILTER');
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='PASS-PRODUCT-DEEP-LINK';
      document.head.append(m);
    }catch(e){
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='FAIL-'+String(e.message||e).slice(0,90);
      document.head.append(m);
    }
  },750);
});
</script>"""

def run_case(here:Path,filename:str,hook:str,fragment:str="")->bool:
    html=(DIST/filename).read_text(encoding="utf-8")
    if "</body>" not in html:
        raise RuntimeError("Missing HTML body: "+filename)
    output=here/("test-"+filename)
    output.write_text(html.replace("</body>",hook+"</body>"),encoding="utf-8")
    cmd=[CHROME,"--headless=new","--no-sandbox","--disable-dev-shm-usage",
         "--allow-file-access-from-files","--enable-unsafe-swiftshader","--use-angle=swiftshader",
         "--disable-background-networking","--virtual-time-budget=4500",
         "--window-size=1440,900","--dump-dom",output.as_uri()+fragment]
    try:
        proc=subprocess.run(cmd,capture_output=True,text=True,timeout=50)
    except subprocess.TimeoutExpired:
        print("R5 browser smoke timed out:",filename,file=sys.stderr)
        return False
    match=re.search(r'<meta name="r5-browser-smoke" content="([^"]+)">',proc.stdout)
    outcome=match.group(1) if match else "FAIL-NO-RESULT-MARKER"
    print("R5 Chromium",filename,outcome)
    if not outcome.startswith("PASS-"):
        print(proc.stderr[-1800:],file=sys.stderr)
    return outcome.startswith("PASS-")

def main()->int:
    if not CHROME:
        print("R5 browser smoke: SKIP, Chromium binary unavailable; no claims about browser interaction")
        return 0
    with tempfile.TemporaryDirectory(prefix="marcosa-r5-chrome-") as temp:
        here=Path(temp)
        for filename in ("index.html","network.css","network.js","immersive.css","immersive.js",
                         "stories.html","stories.css","stories.js"):
            shutil.copyfile(DIST/filename,here/filename)
        ok1=run_case(here,"stories.html",STORY_TEST)
        ok2=run_case(here,"index.html",ROUTE_TEST,"#network-product=proofos")
        return 0 if ok1 and ok2 else 3

if __name__=="__main__":
    raise SystemExit(main())
