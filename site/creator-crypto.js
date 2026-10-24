/* MARCOSA R11 — encrypted portable vault backup (browser-native WebCrypto).
 * PBKDF2-HMAC-SHA-256 (600,000) + AES-256-GCM authenticated encryption.
 * Never uploads manuscripts or passwords. Browser IndexedDB remains UNENCRYPTED.
 * Passwords are not persisted; lost passwords cannot be recovered.
 */
(function(root,factory){
  'use strict';
  const api=factory(typeof module==='object'&&module.exports?
    require('./creator-backup.js'):(root&&root.MarcosaVaultBackup));
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root&&root.document){
    root.MarcosaVaultCrypto=api;
    const start=()=>{root.MarcosaCryptoRuntime=api.mount(root.document,root);};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start,{once:true});
    else start();
  }
})(typeof window!=='undefined'?window:undefined,function(backup){
  'use strict';
  if(!backup)throw Error('MARCOSA_BACKUP_REQUIRED');
  const SCHEMA='marcosa-encrypted-vault/v1';
  const KDF='PBKDF2-HMAC-SHA-256';
  const CIPHER='AES-256-GCM';
  const ITERATIONS=600000;
  const AAD='MARCOSA:encrypted-vault:v1';
  const MAX_ENVELOPE_BYTES=Math.ceil((backup.MAX_BYTES+16)/3)*4+1600;
  const KEYS=Object.freeze(['schema','kdf','iterations','cipher','salt','nonce','ciphertext']);
  const utf8=new TextEncoder();
  function passwordOK(pass){
    return typeof pass==='string'&&pass.length>=12&&pass.length<=256&&
      !/[\u0000-\u001f\u007f]/.test(pass);
  }
  function assertPassword(pass){
    if(!passwordOK(pass))throw Error('INVALID_PASSPHRASE');
  }
  function requireCrypto(provider){
    if(!provider||!provider.subtle||typeof provider.getRandomValues!=='function')
      throw Error('WEBCRYPTO_UNAVAILABLE');
    return provider;
  }
  function to64(bytes){
    if(typeof Buffer!=='undefined'&&typeof Buffer.from==='function')
      return Buffer.from(bytes).toString('base64');
    let chars='';
    const size=8192;
    for(let i=0;i<bytes.length;i+=size)
      chars+=String.fromCharCode(...bytes.subarray(i,i+size));
    return btoa(chars);
  }
  function from64(value,maxBytes){
    if(typeof value!=='string'||value.length===0||
       value.length>Math.ceil(maxBytes/3)*4+4||value.length%4!==0||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
      throw Error('INVALID_CIPHERTEXT_ENCODING');
    let result;
    try{
      if(typeof Buffer!=='undefined'&&typeof Buffer.from==='function')
        result=new Uint8Array(Buffer.from(value,'base64'));
      else{
        const raw=atob(value);
        result=Uint8Array.from(raw,c=>c.charCodeAt(0));
      }
    }catch(err){throw Error('INVALID_CIPHERTEXT_ENCODING');}
    if(result.length>maxBytes||to64(result)!==value)
      throw Error('INVALID_CIPHERTEXT_ENCODING');
    return result;
  }
  function exact(obj,keys,label){
    if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('INVALID_'+label);
    const actual=Object.keys(obj).sort(),expected=keys.slice().sort();
    if(actual.length!==expected.length||actual.some((x,i)=>x!==expected[i]))
      throw Error('UNKNOWN_'+label);
  }
  function readEnvelope(text){
    if(typeof text!=='string'||text.length>MAX_ENVELOPE_BYTES)
      throw Error('ENCRYPTED_BACKUP_TOO_LARGE');
    let raw;
    try{raw=JSON.parse(text);}catch(err){throw Error('INVALID_ENCRYPTED_JSON');}
    exact(raw,KEYS,'ENCRYPTED_BACKUP');
    if(raw.schema!==SCHEMA||raw.kdf!==KDF||raw.cipher!==CIPHER||
       raw.iterations!==ITERATIONS)
      throw Error('INVALID_ENCRYPTED_CONTRACT');
    const salt=from64(raw.salt,16),nonce=from64(raw.nonce,12);
    const ciphertext=from64(raw.ciphertext,backup.MAX_BYTES+16);
    if(salt.length!==16||nonce.length!==12||ciphertext.length<17)
      throw Error('INVALID_ENCRYPTED_LENGTHS');
    return Object.freeze({
      envelope:Object.freeze({...raw}),
      salt,nonce,ciphertext
    });
  }
  async function deriveKey(pass,salt,provider,usage){
    const base=await provider.subtle.importKey(
      'raw',utf8.encode(pass),'PBKDF2',false,['deriveKey']
    );
    return provider.subtle.deriveKey(
      {name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},
      base,{name:'AES-GCM',length:256},false,[usage]
    );
  }
  async function encryptBackup(plainText,pass,cryptoProvider){
    assertPassword(pass);
    const provider=requireCrypto(cryptoProvider);
    const valid=backup.parseBackup(plainText);
    const clear=utf8.encode(JSON.stringify(valid));
    if(clear.byteLength>backup.MAX_BYTES)throw Error('BACKUP_TOO_LARGE');
    const salt=provider.getRandomValues(new Uint8Array(16));
    const nonce=provider.getRandomValues(new Uint8Array(12));
    const key=await deriveKey(pass,salt,provider,'encrypt');
    const protectedBytes=await provider.subtle.encrypt(
      {name:'AES-GCM',iv:nonce,additionalData:utf8.encode(AAD),tagLength:128},
      key,clear
    );
    const envelope={
      schema:SCHEMA,kdf:KDF,iterations:ITERATIONS,cipher:CIPHER,
      salt:to64(salt),nonce:to64(nonce),
      ciphertext:to64(new Uint8Array(protectedBytes))
    };
    const text=JSON.stringify(envelope,null,2)+'\n';
    if(text.length>MAX_ENVELOPE_BYTES)throw Error('ENCRYPTED_BACKUP_TOO_LARGE');
    return text;
  }
  async function decryptBackup(envelopeText,pass,cryptoProvider){
    assertPassword(pass);
    const provider=requireCrypto(cryptoProvider);
    const {salt,nonce,ciphertext}=readEnvelope(envelopeText);
    const key=await deriveKey(pass,salt,provider,'decrypt');
    let bytes;
    try{
      bytes=await provider.subtle.decrypt(
        {name:'AES-GCM',iv:nonce,additionalData:utf8.encode(AAD),tagLength:128},
        key,ciphertext
      );
    }catch(err){
      // A wrong password and a forged/altered ciphertext are indistinguishable.
      throw Error('DECRYPT_FAILED');
    }
    let text;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch(err){throw Error('INVALID_PLAINTEXT_ENCODING');}
    return backup.parseBackup(text);
  }
  const COPY={
    ru:{
      title:'ЗАЩИЩЁННЫЙ АРХИВ',intro:'Скачай резервную копию с паролем. Текст историй внутри файла шифруется прямо в браузере. Для восстановления нужен тот же пароль.',
      pass:'ПАРОЛЬ АРХИВА',confirm:'ПОВТОРИ ПАРОЛЬ ДЛЯ СОЗДАНИЯ',
      passHint:'Используй длинную уникальную парольную фразу — минимум 12 символов. Лучше несколько случайных слов. Мы не сохраняем пароль.',
      export:'СКАЧАТЬ ЗАШИФРОВАННЫЙ АРХИВ',
      import:'ВОССТАНОВИТЬ ЗАШИФРОВАННЫЙ ФАЙЛ',
      warned:'Если забудешь пароль, файл восстановить невозможно. Сам локальный архив в браузере НЕ зашифрован. Старый экспорт JSON без пароля по-прежнему доступен выше.',
      unavailable:'Нужно защищённое соединение HTTPS и поддержка WebCrypto. Сейчас шифрование недоступно.',
      weak:'Введи пароль из 12–256 символов без управляющих знаков.',
      mismatch:'Пароли не совпадают. Зашифрованный файл не создан.',
      empty:'Сначала сохрани хотя бы один проект.',
      saved:'Зашифрованная копия скачана. Пароль очищен; ничего не отправлено на сервер.',
      restored:'Архив расшифрован и восстановлен. Добавлено проектов: ',
      bad:'Не удалось расшифровать: неверный пароль, изменённый файл или неизвестный формат. Старые проекты сохранены.',
      limit:'Локальный архив переполнится: максимум 8 проектов. Сначала освободи место.',
      error:'Не удалось завершить операцию. Старые проекты не изменены.',
      prompt:'Восстановить расшифрованную копию? Существующие истории не перезаписываются.',
      duplicate:'; совпадающих пропущено: ',conflict:'; конфликтных копий: '
    },
    en:{
      title:'PASSWORD-PROTECTED BACKUPS',intro:'Download a password-encrypted copy of your stories. Encryption happens locally in your browser; restoring requires the same password.',
      pass:'BACKUP PASSPHRASE',confirm:'CONFIRM PASSPHRASE FOR EXPORT',
      passHint:'Use a unique long passphrase (12–256 characters); several randomly chosen words are better. The app never saves it.',
      export:'DOWNLOAD ENCRYPTED BACKUP',import:'RESTORE ENCRYPTED FILE',
      warned:'Lost passwords cannot be recovered. Local drafts in this browser are NOT encrypted. Plain JSON export remains available above.',
      unavailable:'HTTPS and WebCrypto are required. Encrypted backup is unavailable here.',
      weak:'Use a 12–256 character passphrase without control characters.',
      mismatch:'Passphrases differ. No encrypted file was created.',
      empty:'Save at least one project first.',
      saved:'Encrypted backup downloaded. Passphrase cleared; nothing was uploaded.',
      restored:'Encrypted archive recovered. Projects added: ',
      bad:'Could not decrypt: wrong passphrase, modified file, or unknown format. Existing projects were preserved.',
      limit:'The local 8-project archive would overflow. Free up space first.',
      error:'Operation failed. Existing projects have not been changed.',
      prompt:'Restore the decrypted archive? Existing projects will not be overwritten.',
      duplicate:'; identical entries skipped: ',conflict:'; conflict copies: '
    },
    zh:{
      title:'密码保护备份',intro:'在浏览器中加密保存全部故事。恢复时必须使用相同密码。',
      pass:'备份密码',confirm:'确认导出密码',
      passHint:'建议使用独特的长密码（12 至 256 个字符），例如几个随机单词。应用不会保存密码。',
      export:'下载加密档案',import:'恢复加密文件',
      warned:'密码丢失无法恢复。浏览器中的本地草稿仍未加密。上面仍可以导出普通 JSON。',
      unavailable:'需要 HTTPS 和 WebCrypto。此浏览器暂时无法使用加密备份。',
      weak:'密码应为 12–256 个字符，不能包含控制字符。',
      mismatch:'两次密码不一致，未创建加密文件。',
      empty:'请先保存至少一个项目。',
      saved:'加密档案已下载。密码已清除，没有上传内容。',
      restored:'加密档案已恢复。新增项目：',
      bad:'无法解密：密码错误、文件被修改或格式不受支持。现有项目未受影响。',
      limit:'恢复后将超过本地 8 个项目限制，请先释放空间。',
      error:'操作失败，原有项目未被修改。',
      prompt:'恢复解密后的档案？现有项目不会被覆盖。',
      duplicate:'；跳过重复：',conflict:'；单独保存冲突副本：'
    }
  };
  function mount(doc,win){
    if(!doc.getElementById('mc-crypto'))return null;
    const $=id=>doc.getElementById(id);
    const pass=$('mc-crypto-pass'),confirmation=$('mc-crypto-confirm');
    const downloadButton=$('mc-crypto-download'),fileInput=$('mc-crypto-file');
    let busy=false,store=null,language='ru';
    const t=key=>(COPY[language]||COPY.ru)[key];
    const status=(key,extra='')=>{$('mc-crypto-feedback').textContent=t(key)+extra;};
    const clearPasswords=()=>{pass.value='';confirmation.value='';};
    const available=()=>!!store&&!!win.crypto?.subtle&&!!win.isSecureContext;
    const lock=next=>{
      busy=next;
      const disabled=next||!available();
      downloadButton.disabled=disabled;fileInput.disabled=disabled;
    };
    const refreshCopy=()=>{
      language=win.MarcosaCreatorRuntime?.locale||'ru';
      doc.querySelectorAll('[data-mcc-text]').forEach(node=>{
        const key=node.dataset.mccText;
        if(Object.prototype.hasOwnProperty.call(COPY[language]||COPY.ru,key))
          node.textContent=t(key);
      });
    };
    const downloadFile=(name,text)=>{
      const blob=new Blob([text],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),node=doc.createElement('a');
      node.href=url;node.download=name;doc.body.append(node);node.click();node.remove();
      win.setTimeout(()=>URL.revokeObjectURL(url),2000);
    };
    async function download(){
      if(!available()||busy)return;
      if(!passwordOK(pass.value)){status('weak');return;}
      if(pass.value!==confirmation.value){status('mismatch');return;}
      lock(true);
      try{
        const records=await store.list();
        if(!records.length){status('empty');return;}
        const now=new Date().toISOString();
        const plain=backup.stringifyBackup(records,now);
        const encrypted=await encryptBackup(plain,pass.value,win.crypto);
        downloadFile('marcosa-encrypted-vault-'+now.slice(0,10)+'.json',encrypted);
        status('saved');
      }catch(err){status('error');}
      finally{clearPasswords();lock(false);}
    }
    async function importFile(event){
      if(!available()||busy)return;
      const file=event.target.files&&event.target.files[0];
      event.target.value='';
      if(!file)return;
      if(!passwordOK(pass.value)){status('weak');return;}
      lock(true);
      try{
        if(file.size>MAX_ENVELOPE_BYTES)throw Error('ENCRYPTED_BACKUP_TOO_LARGE');
        const raw=await file.text();
        const archive=await decryptBackup(raw,pass.value,win.crypto);
        const existing=await store.list();
        const plan=backup.planRestore(archive.projects,existing);
        if(!plan.canRestore){status('limit');return;}
        const message=t('prompt')+'\n\n'+(plan.added+plan.conflicts)+
          t('duplicate')+plan.skipped+t('conflict')+plan.conflicts;
        if(typeof win.confirm==='function'&&!win.confirm(message))return;
        const result=await store.restoreRecords(archive.projects);
        const runtime=win.MarcosaLocalVaultRuntime;
        if(runtime&&typeof runtime.refresh==='function')await runtime.refresh();
        status('restored',result.added+t('duplicate')+result.skipped+t('conflict')+result.conflicts);
      }catch(err){
        const reason=String(err&&err.message||'');
        status(reason==='PROJECT_LIMIT'?'limit':
          /DECRYPT_FAILED|INVALID_|UNKNOWN_|TOO_LARGE|DUPLICATE_/.test(reason)?'bad':'error');
      }finally{clearPasswords();lock(false);}
    }
    downloadButton.addEventListener('click',download);
    fileInput.addEventListener('change',importFile);
    doc.querySelectorAll('[data-mc-lang]').forEach(b=>b.addEventListener('click',refreshCopy));
    refreshCopy();
    try{store=backup&&win.indexedDB&&win.crypto?
      win.MarcosaLocalVault.createVault(win.indexedDB,win.crypto):null;}
    catch(err){store=null;}
    lock(false);
    if(!available())status('unavailable');
    return Object.freeze({download,importFile,get available(){return available();}});
  }
  return Object.freeze({SCHEMA,KDF,CIPHER,ITERATIONS,MAX_ENVELOPE_BYTES,COPY,
    passwordOK,readEnvelope,encryptBackup,decryptBackup,mount});
});