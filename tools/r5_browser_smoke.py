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
import functools
import threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
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


VAULT_TEST=r"""<script>
window.addEventListener('load',function(){
  window.setTimeout(async function(){
    const by=id=>document.getElementById(id);
    const pause=ms=>new Promise(resolve=>window.setTimeout(resolve,ms));
    const until=async(predicate,why)=>{
      for(let n=0;n<110;n++){if(predicate())return;await pause(55);}
      throw Error('TIMEOUT-'+why);
    };
    try{
      const api=window.MarcosaLocalVault;
      if(!api||!window.indexedDB||!window.MarcosaCreatorRuntime)throw Error('VAULT_NOT_MOUNTED');
      await until(()=>by('mc-vault-feedback').textContent.includes('Локальный архив доступен'),'STORAGE_BOOT');
      if(by('mc-save-revision').disabled)throw Error('VAULT_SAVE_DISABLED');
      by('mc-project-name').value='R9 Test Story';
      by('mc-save-revision').click();
      await until(()=>document.querySelectorAll('#mc-version-list .mc-version-row').length===1,'FIRST_SAVE');
      if(document.querySelectorAll('#mc-project-list .mc-project-card').length!==1)throw Error('NO_PROJECT_CARD');
      const store=api.createVault(window.indexedDB,window.crypto);
      let list=await store.list();
      if(list.length!==1||list[0].revisions[0].draft.title!=='R9 Test Story')throw Error('STORAGE_FIRST_VERSION');
      const opening=by('mc-field-opening-scene'),original=opening.value;
      opening.value=original+' Система получила вторую редакцию текста.';
      opening.dispatchEvent(new Event('input',{bubbles:true}));
      if(by('mc-export-review').disabled!==true)throw Error('REVIEW_STALE_NOT_BLOCKED');
      by('mc-version-note').value='Second revision';
      by('mc-save-revision').click();
      await until(()=>document.querySelectorAll('#mc-version-list .mc-version-row').length===2,'SECOND_SAVE');
      const firstRow=document.querySelector('#mc-version-list .mc-version-row');
      if(!firstRow.textContent.includes('2'))throw Error('NO_SECOND_REVISION');
      firstRow.querySelector('.mc-version-actions button').click();
      if(!by('mc-revision-diff').textContent.includes('opening.scene'))throw Error('DIFF_MISSING');
      window.confirm=()=>true;
      const rows=document.querySelectorAll('#mc-version-list .mc-version-row');
      rows[rows.length-1].querySelector('.mc-version-actions button:last-child').click();
      if(opening.value!==original)throw Error('RESTORE_WRONG_VERSION');
      if(!by('mc-export-review').disabled)throw Error('RESTORED_OLD_VERSION_REVIEWED');
      by('mc-save-revision').click();
      await until(()=>document.querySelectorAll('#mc-version-list .mc-version-row').length===3,'RESTORE_AS_REVISION');
      for(const name of ['authorship','sponsorship','editorial','privacy']){
        const field=by('mc-review-'+name);
        field.checked=true;field.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if(by('mc-export-review').disabled)throw Error('REVIEW_NOT_AVAILABLE_AFTER_SELF_CHECK');
      by('mc-export-review').click();
      if(!by('mc-export-review').disabled)throw Error('SELF_CHECK_NOT_RESET');
      if(!by('mc-vault-feedback').textContent.includes('Пакет'))throw Error('NO_REVIEW_FEEDBACK');
      list=await store.list();
      if(list.length!==1||list[0].revisions.length!==3||list[0].revisions[0].revision!==1)
        throw Error('INDEXEDDB_NOT_PERSISTED');
      by('mc-delete-project').click();
      await until(()=>document.querySelectorAll('#mc-project-list .mc-project-card').length===0,'DELETE');
      if((await store.list()).length!==0)throw Error('DELETION_NOT_DURABLE');
      if(document.documentElement.scrollWidth>document.documentElement.clientWidth+3)
        throw Error('HORIZONTAL_OVERFLOW');
      const m=document.createElement('meta');m.name='r5-browser-smoke';
      m.content='PASS-R9-INDEXEDDB-3-VERSIONS-REVIEW-DELETE';document.head.append(m);
    }catch(e){
      const m=document.createElement('meta');m.name='r5-browser-smoke';
      m.content='FAIL-R9-'+String(e.message||e).slice(0,90);document.head.append(m);
    }
  },200);
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

def run_case(here:Path,filename:str,hook:str,fragment:str="",viewport:str="1440,900",origin:str="")->bool:
    html=(DIST/filename).read_text(encoding="utf-8")
    if "</body>" not in html:
        raise RuntimeError("Missing HTML body: "+filename)
    output=here/("test-"+filename)
    output.write_text(html.replace("</body>",hook+"</body>"),encoding="utf-8")
    cmd=[CHROME,"--headless=new","--no-sandbox","--disable-dev-shm-usage",
         "--allow-file-access-from-files","--enable-unsafe-swiftshader","--use-angle=swiftshader",
         "--disable-background-networking","--virtual-time-budget="+("12500" if origin else "4500"),
         "--window-size="+viewport,"--dump-dom",(origin+"/"+output.name if origin else output.as_uri())+fragment]
    try:
        proc=subprocess.run(cmd,capture_output=True,text=True,timeout=50)
    except subprocess.TimeoutExpired:
        print("R5 browser smoke timed out:",filename,file=sys.stderr)
        return False
    match=re.search(r'<meta name="r5-browser-smoke" content="([^"]+)">',proc.stdout)
    outcome=match.group(1) if match else "FAIL-NO-RESULT-MARKER"
    print("R5 Chromium",filename,outcome)
    if not outcome.startswith("PASS-"):
        if filename=="creator.html":
            for key in ("mc-vault-feedback","mc-project-list","mc-version-list","mc-save-revision"):
                location=proc.stdout.find('id="'+key+'"')
                if location>=0:
                    print("R9 DOM diagnostic",key,repr(proc.stdout[location:location+260]),file=sys.stderr)
        print(proc.stderr[-900:],file=sys.stderr)
    return outcome.startswith("PASS-")

def main()->int:
    if not CHROME:
        print("R5 browser smoke: SKIP, Chromium binary unavailable; no claims about browser interaction")
        return 0
    with tempfile.TemporaryDirectory(prefix="marcosa-r5-chrome-") as temp:
        here=Path(temp)
        for filename in ("index.html","network.css","network.js","immersive.css","immersive.js",
                         "stories.html","stories.css","stories.js",
                         "creator.html","creator.css","creator.js","creator-vault.js"):
            shutil.copyfile(DIST/filename,here/filename)
        ok1=run_case(here,"stories.html",STORY_TEST)
        ok2=run_case(here,"index.html",ROUTE_TEST,"#network-product=proofos")
        ok3=run_case(here,"stories.html",STORY_ROUTE_TEST,"#story=signal.00")
        ok4=run_case(here,"creator.html",CREATOR_TEST)
        ok5=run_case(here,"creator.html",CREATOR_TEST,viewport="390,844")
        class QuietStaticServer(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                return
        handler=functools.partial(QuietStaticServer,directory=str(here))
        with ThreadingHTTPServer(("127.0.0.1",0),handler) as server:
            runner=threading.Thread(target=server.serve_forever,daemon=True)
            runner.start()
            try:
                origin="http://127.0.0.1:"+str(server.server_port)
                ok6=run_case(here,"creator.html",VAULT_TEST,viewport="1440,900",origin=origin)
                ok7=run_case(here,"creator.html",VAULT_TEST,viewport="390,844",origin=origin)
            finally:
                server.shutdown()
                runner.join(timeout=3)
        return 0 if ok1 and ok2 and ok3 and ok4 and ok5 and ok6 and ok7 else 3

if __name__=="__main__":
    raise SystemExit(main())
