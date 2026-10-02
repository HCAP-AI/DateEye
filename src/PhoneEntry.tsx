import {useEffect,useRef,useState} from 'react';
export async function phoneApi(path:string,data?:unknown){const r=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||'Please try again.');return d;}
export function PhoneEntry({planId,onDone}:{planId:string|null;onDone:(notice?:string)=>void}){
 const submitting=useRef(false);
 const verified=useRef(false);
 const interacting=useRef(false);
 const [phone,setPhone]=useState(''),[stage,setStage]=useState('phone'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[allowed,setAllowed]=useState(false);
 useEffect(()=>{let mounted=true;void phoneApi('/api/phone/invitations').then(()=>{if(mounted&&!interacting.current){verified.current=true;setStage('verified');onDone();}}).catch(()=>{});return()=>{mounted=false;};},[]);
 async function submit(form:FormData){if(submitting.current)return;if(verified.current){onDone();return;}submitting.current=true;interacting.current=true;setBusy(true);setError('');try{
  if(stage==='phone'){
   await phoneApi('/api/age-confirm',{age:form.get('age'),termsAccepted:form.get('termsAccepted')==='on'});
   const number=String(form.get('phone')||'');setPhone(number);setAllowed(form.get('smsAllowed')==='on');
   await phoneApi('/api/phone/send-code',{phone:number,planId});setStage('code');
  }else{
   await phoneApi('/api/phone/verify-code',{phone,code:String(form.get('code')||'').trim()});
   verified.current=true;setStage('verified');
   let notice='';
   if(allowed){try{await phoneApi('/api/phone/preferences',{allowed:true});}catch{notice='Your mobile is verified, but we could not save your text preference. Use Enable event texts below to retry.';}}
   onDone(notice);
  }
 }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{submitting.current=false;setBusy(false);}}
 if(stage==='verified')return <><p role="status">Mobile number verified. Opening your calendar…</p>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={busy} onClick={()=>onDone()}>Continue to calendar</button></>;
 return <><p>{stage==='phone'?'Enter your invited mobile number. We’ll text a code to verify it.':`If ${phone} has an active invitation, a code has been sent. Enter it below.`}</p><form onChange={()=>{interacting.current=true;}} onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
 {stage==='phone'?<><label>Your mobile number<input type="tel" name="phone" autoComplete="tel" required maxLength={40} placeholder="07700 900123" defaultValue={phone}/></label>
 <label>Age<select name="age" required defaultValue=""><option value="" disabled>Select</option><option value="under18">Under 18</option><option value="adult">18 or over</option></select></label>
 <label className="terms-check"><input name="termsAccepted" type="checkbox" required/><span className="terms-check-copy">I agree to the <a href="/terms#terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/terms#privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>
 <label className="terms-check"><input name="smsAllowed" type="checkbox" defaultChecked={allowed}/><span className="terms-check-copy">Send me prod. event invitations and one reminder per event if I haven’t responded after 24 hours. Message charges may apply. Reply STOP or turn texts off here at any time.</span></label></>:<label>Sign-in code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" maxLength={10} required/></label>}
 {error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'Please wait…':stage==='phone'?'Send text code':'Verify and open calendar'}</button></form>
 {stage==='code'&&<button className="admin-link" disabled={busy} onClick={()=>setStage('phone')}>Change number or request another code</button>}
 </>;
}
export function PhonePreferences(){
 const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 async function set(allowed:boolean){setBusy(true);try{const d=await phoneApi('/api/phone/preferences',{allowed});setStatus(allowed?(d.stopped?'Reply START to the prod. number to unblock texts, then enable them here.':'Event texts enabled.'):'Event texts stopped.');}catch(e){setStatus(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 return <section><div className="account-actions"><button disabled={busy} onClick={()=>void set(false)}>Stop event texts</button><button disabled={busy} onClick={()=>void set(true)}>Enable event texts</button><button disabled={busy} onClick={async()=>{try{await phoneApi('/api/phone/logout',{});window.location.reload();}catch{setStatus('Could not sign out. Please retry.');}}}>Sign out of phone</button></div><small>Enable texts only if you want event invitations and one reminder per event after 24 hours without a response.</small><p role="status">{status}</p></section>;
}
export function SmsInvitations({planId,onRefresh}:{planId:string;onRefresh:()=>void}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 async function send(){setBusy(true);try{const d=await phoneApi('/api/sms/invite',{planId});setStatus(`${d.queued} invitation(s) queued. ${d.needsPermission} invitee(s) need SMS permission first. Texts normally go out within five minutes.`);onRefresh();}catch(e){setStatus(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 return <section><h3>Text invitations</h3><p>Save mobile numbers and choose SMS for those invitees. If they haven’t opted in, share your event link through WhatsApp so they can verify their number and choose texts first.</p><p>Each number receives one invitation and, if no availability is submitted, one reminder 24 hours later. Invitations aren’t resent when you press this again.</p><button type="button" disabled={busy} onClick={()=>void send()}>{busy?'Queuing…':'Send SMS invitations'}</button><p role="status">{status}</p></section>;
}
export function AddFromContacts({onSave}:{onSave:(payload:unknown)=>Promise<void>}){
 const [busy,setBusy]=useState(false),[status,setStatus]=useState('');
 const contacts=(navigator as unknown as {contacts?:{select:(fields:string[],opts:{multiple:boolean})=>Promise<{name?:string[];tel?:string[]}[]>}}).contacts;
 if(!contacts||!window.isSecureContext)return null;
 async function pick(){setBusy(true);setStatus('');let added=0;try{const chosen=await contacts!.select(['name','tel'],{multiple:true});for(const c of chosen){const name=c.name?.[0]?.trim(),phone=c.tel?.[0];if(!name||!phone)continue;await onSave({action:'member',name,phone,notification:'sms',email:'',active:true});added++;}setStatus(`${added} selected contact(s) added. Check the mobile numbers below.`);}catch(e){setStatus(`${added} contact(s) added. `+(e instanceof Error?e.message:'Please add the remaining invitees manually.'));}finally{setBusy(false);}}
 return <><button type="button" disabled={busy} onClick={()=>void pick()}>{busy?'Adding…':'Add from contacts'}</button><p role="status">{status}</p></>;
}
