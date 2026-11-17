'use strict';
const slug = document.querySelector('#series-tools')?.dataset.slug;
const notice = document.getElementById('series-notice');

function attach(id, path, method, makeBody, saved) {
 const form = document.getElementById(id);
 if (!form) return;
 form.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = form.querySelector('button');
  if (submit.disabled) return;
  submit.disabled = true;
  try {
   const response = await fetch(path, {
    method, credentials:'same-origin', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(makeBody(Object.fromEntries(new FormData(form))))
   });
   const result = await response.json();
   if (!response.ok) throw Error(result.error || 'Не удалось сохранить изменения');
   saved(result);
  } catch(error) { notice.textContent=error.message; }
  finally { submit.disabled=false; }
 });
}
const dateValue = raw => raw ? new Date(raw).getTime() : null;
attach('new-series','/api/series','POST',data=>({...data,nextAt:dateValue(data.nextAt)}),
 result=>location.assign('/series/'+encodeURIComponent(result.slug)));
if(slug) {
 const path='/api/series/'+encodeURIComponent(slug);
 attach('new-episode',path+'/episodes','POST',data=>({...data,postId:Number(data.postId)}),()=>location.reload());
 attach('next-release',path,'PATCH',data=>({nextAt:dateValue(data.nextAt)}),()=>location.reload());
}
