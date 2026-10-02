import {useState} from 'react';
export async function phoneApi(path:string,data?:unknown){const r=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||'Please try again.');return d;}
export function AddFromContacts({onSave}:{onSave:(payload:unknown)=>Promise<void>}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const contacts=(navigator as unknown as {contacts?:{select:(fields:string[],opts:{multiple:boolean})=>Promise<{name?:string[];tel?:string[]}[]>}}).contacts;
 if(!contacts||!window.isSecureContext)return null;
 async function pick(){setBusy(true);setStatus('');let added=0;try{const chosen=await contacts!.select(['name','tel'],{multiple:true});for(const c of chosen){const name=c.name?.[0]?.trim(),phone=c.tel?.[0];if(!name||!phone)continue;await onSave({action:'member',name,phone,notification:'email',email:'',active:true});added++;}setStatus(`${added} selected contact(s) added. Check the mobile numbers below.`);}catch(e){setStatus(`${added} contact(s) added. `+(e instanceof Error?e.message:'Please add the remaining invitees manually.'));}finally{setBusy(false);}}
 return <><button type="button" disabled={busy} onClick={()=>void pick()}>{busy?'Adding…':'Add from contacts'}</button><p role="status">{status}</p></>;
}
