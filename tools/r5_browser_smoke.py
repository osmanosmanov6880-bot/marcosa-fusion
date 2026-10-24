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
      if(by('ms-brief-preview').hidden||by('ms-brief-download').disabled||by('ms-brief-html').disabled)throw Error('BRIEF_EXPORT');
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='PASS-STORY-BRIEF-LINK';
      document.head.append(m);
    }catch(e){
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='FAIL-'+String(e.message||e).slice(0,90);
      document.head.append(m);
    }
  },600);
});
</script>"""

STORY_ROUTE_TEST=r"""<script>
window.addEventListener('load',function(){
  window.setTimeout(function(){
    try{
      const by=id=>document.getElementById(id);
      if(by('ms-finish').hidden)throw Error('SHARED_OUTCOME_NOT_LOADED');
      if(document.querySelector('[data-story-id="signal"]').getAttribute('aria-pressed')!=='true')throw Error('SHARED_STORY_NOT_SELECTED');
      if(by('ms-project-name').textContent!=='ProofOS')throw Error('SHARED_RECOMMENDATION');
      if(by('ms-back').disabled)throw Error('SHARED_HISTORY_NOT_RESTORED');
      if(by('ms-share-copy').hidden)throw Error('SHARE_ACTION_HIDDEN');
      const expected=window.MarcosaStoryPilot.encodeStoryRoute({storyId:'signal',answers:[0,0]});
      if(location.hash!==expected)throw Error('SHARE_URL_MISMATCH');
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='PASS-R7-END-TO-END-DEEP-LINK';
      document.head.append(m);
    }catch(e){
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='FAIL-R7-'+String(e.message||e).slice(0,90);
      document.head.append(m);
    }
  },650);
});
</script>"""

CREATOR_TEST=r"""<script>
window.addEventListener('load',function(){
  window.setTimeout(function(){
    try{
      const by=id=>document.getElementById(id);
      const studio=window.MarcosaCreatorStudio;
      if(!studio||!studio.FIELDS||studio.FIELDS.length!==22)throw Error('EDITOR_NOT_MOUNTED');
      if(document.querySelectorAll('#mc-fields .mc-field').length!==22)throw Error('EDITOR_FIELDS');
      if(document.querySelectorAll('#mc-choice-list .mc-choice').length!==2)throw Error('OPENING_CHOICE_COUNT');
      document.querySelectorAll('#mc-choice-list .mc-choice')[1].click();
      if(document.querySelectorAll('#mc-choice-list .mc-choice').length!==2)throw Error('BRANCH_CHOICE_COUNT');
      document.querySelectorAll('#mc-choice-list .mc-choice')[0].click();
      if(by('mc-play-title').textContent!=='Открытый маяк')throw Error('WRONG_BRANCH_ENDING');
      if(by('mc-choice-list').children.length!==0)throw Error('ENDING_CHOICES_VISIBLE');
      by('mc-back').click();
      if(by('mc-play-index').textContent!=='02 / 03')throw Error('BACK');
      by('mc-restart').click();
      if(by('mc-play-index').textContent!=='01 / 03')throw Error('RESTART');
      const title=by('mc-field-title');
      title.value='Новая тестовая история';
      title.dispatchEvent(new Event('input',{bubbles:true}));
      if(by('mc-dirty').hidden||!by('mc-download').disabled)throw Error('STALE_EXPORT_NOT_BLOCKED');
      for(const id of ['mc-rights','mc-disclose']){
        const x=by(id);x.checked=true;x.dispatchEvent(new Event('change',{bubbles:true}));
      }
      by('mc-apply').click();
      if(by('mc-play-title').textContent!=='Новая тестовая история')throw Error('PREVIEW_NOT_UPDATED');
      if(by('mc-download').disabled)throw Error('VALID_EXPORT_BLOCKED');
      document.querySelector('[data-mc-lang="en"]').click();
      if(!by('mc-main-title').textContent.includes('Your story'))throw Error('TRANSLATION_MISSING');
      if(title.value!=='Новая тестовая история')throw Error('LANGUAGE_LOST_CONTENT');
      if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)throw Error('HORIZONTAL_OVERFLOW');
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='PASS-R8-STORY-BUILDER';
      document.head.append(m);
    }catch(e){
      const m=document.createElement('meta');m.name='r5-browser-smoke';m.content='FAIL-R8-'+String(e.message||e).slice(0,90);
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


SOURCE_ATLAS_TEST=r"""<script>
window.addEventListener('load',function(){
  setTimeout(function(){
    try{
      const $=id=>document.getElementById(id);
      const api=window.MarcosaSourceAtlas;
      if(!api||api.RECORDS.length!==33)throw Error('SOURCE_DATA_NOT_LOADED');
      if(document.querySelectorAll('#sh-grid .sh-card').length!==33)throw Error('SOURCE_GRID_COUNT');
      const first=api.RECORDS.filter(x=>x.kind==='github');
      if(first.length!==20)throw Error('REPO_COUNT');
      if(api.RECORDS.filter(x=>x.kind==='archive').length!==13)throw Error('ZIP_COUNT');
      document.querySelector('[data-sh-filter="cinema"]').click();
      const cinemaCount=document.querySelectorAll('#sh-grid .sh-card').length;
      if(cinemaCount<4||cinemaCount>10)throw Error('CINEMA_FILTER');
      const search=$('sh-search');search.value='protocol-zero';
      search.dispatchEvent(new Event('input',{bubbles:true}));
      if(document.querySelectorAll('#sh-grid .sh-card').length!==1)throw Error('SOURCE_SEARCH');
      const link=document.querySelector('#sh-grid a.sh-link');
      if(!link||link.href!=='https://github.com/osmanosmanov6880-bot/protocol-zero')
        throw Error('SOURCE_REAL_GITHUB_LINK');
      if(link.getAttribute('rel')!=='noopener noreferrer')throw Error('OUTBOUND_LINK_SECURITY');
      document.querySelector('[data-sh-filter="archives"]').click();
      search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
      if(document.querySelectorAll('#sh-grid .sh-card').length!==13)throw Error('ZIP_FILTER');
      // R19: precisely three reviewed archive CINEMA copies are now playable.
      // Only links to the six-film theater are permitted: never the private ZIP itself.
      const links=Array.from(document.querySelectorAll('#sh-grid a.sh-link'));
      const expected=['./cinema-pilot.html#signal-worlds',
                      './cinema-pilot.html#opspilot',
                      './cinema-pilot.html#intentgraph'];
      const destinations=links.map(a=>a.getAttribute('href')).sort();
      if(JSON.stringify(destinations)!==JSON.stringify(expected.sort()))
        throw Error('PRIVATE_ARCHIVE_GOT_DOWNLOAD_LINK');
      if(links.some(a=>a.hasAttribute('download')||a.href.endsWith('.zip')))
        throw Error('PRIVATE_ARCHIVE_DOWNLOAD_FORBIDDEN');
      if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)throw Error('HORIZONTAL_SCROLL');
      const meta=document.createElement('meta');meta.name='r5-browser-smoke';meta.content='PASS-R15-SOURCE-ATLAS';
      document.head.append(meta);
    }catch(e){
      const meta=document.createElement('meta');meta.name='r5-browser-smoke';
      meta.content='FAIL-R15-'+String(e.message||e).slice(0,65);
      document.head.append(meta);
    }
  },650);
});
</script>"""

def run_case(here:Path,filename:str,hook:str,fragment:str="",viewport:str="1440,900")->bool:
    html=(DIST/filename).read_text(encoding="utf-8")
    if "</body>" not in html:
        raise RuntimeError("Missing HTML body: "+filename)
    output=here/("test-"+filename)
    output.write_text(html.replace("</body>",hook+"</body>"),encoding="utf-8")
    cmd=[CHROME,"--headless=new","--no-sandbox","--disable-dev-shm-usage",
         "--allow-file-access-from-files","--enable-unsafe-swiftshader","--use-angle=swiftshader",
         "--disable-background-networking","--virtual-time-budget=4500",
         "--window-size="+viewport,"--dump-dom",output.as_uri()+fragment]
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
                         "stories.html","stories.css","stories.js",
                         "creator.html","creator.css","creator.js","creator-vault.js","creator-backup.js","creator-crypto.js","creator-standalone.js","creator-playtest.js",
                         "source-hub.html","source-hub.css","source-hub.js"):
            shutil.copyfile(DIST/filename,here/filename)
        ok1=run_case(here,"stories.html",STORY_TEST)
        ok2=run_case(here,"index.html",ROUTE_TEST,"#network-product=proofos")
        ok3=run_case(here,"stories.html",STORY_ROUTE_TEST,"#story=signal.00")
        ok4=run_case(here,"creator.html",CREATOR_TEST)
        ok5=run_case(here,"creator.html",CREATOR_TEST,viewport="390,844")
        ok6=run_case(here,"source-hub.html",SOURCE_ATLAS_TEST)
        ok7=run_case(here,"source-hub.html",SOURCE_ATLAS_TEST,viewport="390,844")
        return 0 if all((ok1,ok2,ok3,ok4,ok5,ok6,ok7)) else 3

if __name__=="__main__":
    raise SystemExit(main())
