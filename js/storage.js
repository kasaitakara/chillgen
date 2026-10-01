// moacl project store: isolated from mono82 storage and legacy latest-state.
export function createProjectStore({capture,apply,makeNew,exportAudio}){
 const DB='moacl-projects-v1',STORE='projects',RECOVERY='recovery',CURRENT='moacl.current-project-id.v1';
 const dialog=document.querySelector('#project-dialog'),body=document.querySelector('#project-dialog-body'),label=document.querySelector('#project-dialog-label'),ok=document.querySelector('#project-confirm');
 let dbPromise=null,currentId=null,savedSignature=null,dirty=false,autoTimer=null,busy=false;
 const signature=data=>JSON.stringify(data);
 function openDB(){return dbPromise??=new Promise((resolve,reject)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore(STORE,{keyPath:'id'});d.createObjectStore(RECOVERY,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}).catch(e=>{dbPromise=null;throw e;});}
 async function operation(store,mode,action){const d=await openDB();return new Promise((resolve,reject)=>{const tx=d.transaction(store,mode);let result;const req=action(tx.objectStore(store));if(req){req.onsuccess=()=>result=req.result;req.onerror=()=>reject(req.error);}tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
 const get=id=>operation(STORE,'readonly',s=>s.get(id));const all=()=>operation(STORE,'readonly',s=>s.getAll());const put=record=>operation(STORE,'readwrite',s=>s.put(record));
 const recover=record=>operation(RECOVERY,'readwrite',s=>s.put(record));
 const recovery=id=>operation(RECOVERY,'readonly',s=>s.get(id));
 const removeRecovery=id=>operation(RECOVERY,'readwrite',s=>s.delete(id));
 const dateName=()=>{const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;};
 const titleOf=data=>String(data?.songTitle||'').trim().slice(0,80)||'untitled';
 const unique=async(name,except=null)=>{let base=String(name||dateName()).trim().slice(0,80)||dateName();const names=new Set((await all()).filter(p=>p.id!==except).map(p=>p.name.toLowerCase()));if(!names.has(base.toLowerCase()))return base;let n=2;while(names.has(`${base}-${n}`.toLowerCase()))n++;return `${base}-${n}`;};
 const uuid=()=>`pj_${crypto.randomUUID?.()??`${Date.now()}_${Math.random()}`}`;
 function clean(){savedSignature=signature(capture());dirty=false;}
 function close(){dialog.hidden=true;body.replaceChildren();ok.onclick=null;}
 document.querySelector('#project-cancel').onclick=close;
 dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
 function show(title,render,confirmText='[ok]'){label.textContent=title;body.replaceChildren();ok.textContent=confirmText;ok.hidden=false;ok.onclick=null;dialog.hidden=false;render?.();}
 function message(text){const div=document.createElement('div');div.textContent=text;body.append(div);}
 function input(value=''){const el=document.createElement('input');el.maxLength=80;el.autocomplete='off';el.spellcheck=false;el.value=value;body.append(el);el.focus();el.select();return el;}
 function alertMessage(text){show('project',()=>message(text));ok.onclick=close;}
 function confirm(title,text,action){show(title,()=>message(text));ok.onclick=async()=>{if(busy)return;busy=true;try{await action();close();}catch(e){console.error(e);alertMessage('operation failed');}finally{busy=false;}};}
 function changed(){return dirty||signature(capture())!==savedSignature;}
 async function safeAction(action){if(changed())confirm('unsaved changes','Discard unsaved changes?',action);else await action();}
 async function renameCurrent(name){if(!currentId)return;const existing=await get(currentId);if(!existing)return;const title=String(name||'').trim().slice(0,80)||'untitled';// Renaming the title is an edit; SAVE commits both title and content.
  markChanged();}
 async function save(){if(!currentId)return saveAs();const existing=await get(currentId);if(!existing)return saveAs();const now=new Date().toISOString();const data=capture();const record={...existing,name:titleOf(data),updatedAt:now,data};await put(record);await recover(record);clean();return record;}
 async function saveAs(){const current=currentId?await get(currentId):null;show('save as',()=>{});const el=input(titleOf(capture()));ok.onclick=async()=>{if(busy)return;busy=true;try{const name=await unique(el.value);const data=capture();data.songTitle=name;apply(data);const now=new Date().toISOString(),record={id:uuid(),name,createdAt:now,updatedAt:now,data:capture(),format:'moacl-project',version:1};await put(record);currentId=record.id;localStorage.setItem(CURRENT,currentId);await recover(record);clean();close();}catch(e){console.error(e);alertMessage('save failed');}finally{busy=false;}};}
 async function fresh(){await safeAction(async()=>{makeNew();const now=new Date().toISOString();const name=await unique(titleOf(capture()));const data=capture();data.songTitle=name;apply(data);const record={id:uuid(),name,createdAt:now,updatedAt:now,data:capture(),format:'moacl-project',version:1};await put(record);currentId=record.id;localStorage.setItem(CURRENT,currentId);await recover(record);clean();});}
 async function load(){
  const projects=(await all()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  show('load',()=>{
   const list=document.createElement('div');list.className='project-list';
   for(const project of projects){
    const row=document.createElement('div');row.className='project-item';
    const pick=document.createElement('button');pick.className='project-pick';
    pick.textContent=project.name;pick.setAttribute('aria-pressed',String(project.id===currentId));
    pick.onclick=async()=>{await safeAction(async()=>{const latest=await get(project.id);if(!latest)throw Error('Missing project');latest.data.songTitle=latest.name||titleOf(latest.data);apply(latest.data);currentId=latest.id;localStorage.setItem(CURRENT,currentId);clean();close();});};
    const del=document.createElement('button');del.className='project-delete';del.textContent='delete';del.title='delete';
    del.onclick=()=>confirm('delete',`Delete ${project.name}?`,async()=>{await operation(STORE,'readwrite',s=>s.delete(project.id));await removeRecovery(project.id);if(currentId===project.id){currentId=null;localStorage.removeItem(CURRENT);}setTimeout(()=>load().catch(console.error),0);});
    // Reveal delete only after a leftward swipe; rightward swipe closes it.
    let startX=0,startY=0,swiped=false;
    row.addEventListener('touchstart',e=>{startX=e.touches[0].clientX;startY=e.touches[0].clientY;swiped=false;},{passive:true});
    row.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-startX,dy=e.changedTouches[0].clientY-startY;if(Math.abs(dx)>38&&Math.abs(dx)>Math.abs(dy)*1.2){row.classList.toggle('revealed',dx<0);swiped=true;}},{passive:true});
    // Desktop trackpad / mouse drag support.
    let pointer=null;
    row.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse')pointer={x:e.clientX,y:e.clientY};});
    row.addEventListener('pointerup',e=>{if(!pointer)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;pointer=null;if(Math.abs(dx)>38&&Math.abs(dx)>Math.abs(dy)*1.2){row.classList.toggle('revealed',dx<0);swiped=true;}});
    pick.addEventListener('click',e=>{if(swiped){e.stopImmediatePropagation();swiped=false;}},true);
    row.append(pick,del);list.append(row);
   }
   body.append(list);
  },'close');ok.onclick=close;
 }
 function exportProject(){const name=titleOf(capture());const data={format:'moacl-project',formatVersion:1,exportedAt:new Date().toISOString(),project:{name:currentId?undefined:name,data:capture()}};const download=async()=>{const record=currentId?await get(currentId):null;data.project.name=name;const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${data.project.name.replace(/[\\/:*?"<>|]/g,'_')}.mo`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);};download().catch(console.error);}
 async function importText(text){const obj=JSON.parse(text);if(obj?.format!=='moacl-project'||obj.formatVersion!==1||!obj.project?.data?.current?.model||!Array.isArray(obj.project.data.patternSlots))throw Error('Unsupported file');await safeAction(async()=>{const now=new Date().toISOString(),record={id:uuid(),name:await unique(titleOf(obj.project.data)==='untitled'?obj.project.name:titleOf(obj.project.data)),createdAt:now,updatedAt:now,data:obj.project.data,format:'moacl-project',version:1};record.data.songTitle=record.name;apply(record.data);await put(record);await recover(record);currentId=record.id;localStorage.setItem(CURRENT,currentId);clean();});}
 const fileInput=document.querySelector('#project-import-file');fileInput.addEventListener('change',async()=>{const file=fileInput.files?.[0];fileInput.value='';if(!file)return;try{await importText(await file.text());}catch(e){console.error(e);alertMessage('invalid or unsupported project file');}});
 function bindMenu(menu){const items=[...menu.querySelectorAll('[data-project]')];for(const b of items)b.onclick=async()=>{menu.hidden=true;document.querySelector('#menu').textContent='=';try{switch(b.dataset.project){case 'new':await fresh();break;case 'save':await save();break;case 'save-as':await saveAs();break;case 'load':await load();break;case 'export':if(exportAudio)await exportAudio();else alertMessage('audio export unavailable');break;case 'backup':exportProject();break;case 'import':fileInput.click();break;}}catch(e){console.error(e);alertMessage('operation failed');}};}
 async function initialize(){await openDB();for(const p of await all()){if(/^\d{8}(?:-\d+)?$/.test(p.name)&&titleOf(p.data)!=='untitled'){p.name=titleOf(p.data);await put(p);}else if(/^\d{8}(?:-\d+)?$/.test(p.name)&&titleOf(p.data)==='untitled'){p.name=await unique('untitled',p.id);await put(p);}}const id=localStorage.getItem(CURRENT);if(id){const project=await get(id);if(project){const rec=await recovery(id);let latest=rec&&rec.updatedAt>project.updatedAt?rec:project;try{const emergency=JSON.parse(localStorage.getItem('moacl.emergency.v1')||'null');if(emergency?.id===id&&emergency.data?.current?.model&&signature(emergency.data)!==signature(project.data))latest={...project,data:emergency.data};}catch{}localStorage.removeItem('moacl.emergency.v1');latest.data.songTitle=latest.name||titleOf(latest.data);apply(latest.data);currentId=id;savedSignature=signature(project.data);dirty=latest!==project;return;}}const projects=await all();if(projects.length){const project=projects.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];project.data.songTitle=project.name||titleOf(project.data);apply(project.data);currentId=project.id;localStorage.setItem(CURRENT,currentId);clean();return;}const now=new Date().toISOString();const name=await unique(titleOf(capture()));const data=capture();data.songTitle=name;apply(data);const record={id:uuid(),name,createdAt:now,updatedAt:now,data:capture(),format:'moacl-project',version:1};await put(record);currentId=record.id;localStorage.setItem(CURRENT,currentId);clean();}
 function markChanged(){if(!currentId||!savedSignature)return;const data=capture();if(signature(data)===savedSignature){dirty=false;return;}dirty=true;clearTimeout(autoTimer);autoTimer=setTimeout(async()=>{try{if(!currentId)return;const project=await get(currentId);await recover({id:currentId,name:titleOf(capture()),updatedAt:new Date().toISOString(),data:capture()});}catch(e){console.warn('recovery failed',e);}},300);}
 window.addEventListener('pagehide',()=>{if(currentId&&changed())localStorage.setItem('moacl.emergency.v1',JSON.stringify({id:currentId,data:capture()}));});
 return {bindMenu,initialize,markChanged,renameCurrent};
}
