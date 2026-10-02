
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {PhoneEntry,PhonePreferences,SmsInvitations,AddFromContacts,phoneApi} from './PhoneEntry';
import { AccountPage, LegalPage, TERMS_VERSION } from './Legal';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Crown, Sparkles, Users, X } from "lucide-react";

function BrandLogo(){return <a className="prod-logo" href="/" aria-label="prod. home"><img src="/prod-logo.png" alt="prod." width="220" height="100"/></a>;}

type Member = { id: string; name: string; email?:string|null; phone?:string|null; notification?:string; smsAllowed?:boolean; smsStatus?:string; active:number; linked?:number };
type Event = { id: string; name: string; startDate: string; endDate: string; archived?:boolean };
type Availability = { memberId: string; date: string; available: boolean };
type AppState = { event: Event | null; members: Member[]; managedMembers?:Member[]; availability: Availability[]; viewer:{isAdmin:boolean;memberId:string|null;email:string;phoneVerified?:boolean} };

const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseLocal = (value: string) => { const [y,m,d] = value.split("-").map(Number); return new Date(y,m-1,d); };

function monthDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return [...Array(offset).fill(null), ...Array.from({length: days}, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
}

function Home({planId,onPlans,guest=false}:{planId:string|null;onPlans:()=>void;guest?:boolean}) {
  const [resolvedPlan,setResolvedPlan]=useState(planId);
  const [invitations,setInvitations]=useState<{id:string;name:string}[]>([]);
  const fetch=(url:string,init?:RequestInit)=>window.fetch(url==="/api/state"?url+(resolvedPlan?"?plan="+encodeURIComponent(resolvedPlan):""):url,init);
  const [adminLogin, setAdminLogin] = useState(window.location.pathname === "/admin");
  const [state, setState] = useState<AppState | null>(null);
  const [selectedMember, setSelectedMember] = useState("");
  const [month, setMonth] = useState(new Date());
  const [view, setView] = useState<"calendar" | "results">("calendar");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [adminOpen,setAdminOpen] = useState(false);
  const [setupFlow,setSetupFlow]=useState(new URLSearchParams(window.location.search).get("setup")==="1");
  const [saveStatus,setSaveStatus] = useState("");
  const [phoneVerified,setPhoneVerified]=useState(false);
  const [phoneRefresh,setPhoneRefresh]=useState(0);
  const [phoneNotice,setPhoneNotice]=useState('');
  const [entryMode,setEntryMode]=useState(new URLSearchParams(window.location.search).get('via')==='sms'?'sms':'email');
  const [participantEmail,setParticipantEmail] = useState("");
  const [needsEmail,setNeedsEmail] = useState(false);
  const [opening,setOpening] = useState(false);
  const [shareStatus,setShareStatus] = useState("");
  const participantHeaders:Record<string,string> = phoneVerified ? {"x-prod-phone-session":"1"} : participantEmail ? {"x-dateeye-email":participantEmail} : {};

  const load = useCallback(async () => {
    if(guest&&!participantEmail&&!phoneVerified){setNeedsEmail(true);return;}
    setOpening(true);
    try {
      if(guest&&!resolvedPlan&&(participantEmail||phoneVerified)){
        const r=await window.fetch(phoneVerified?'/api/phone/invitations':'/api/invitations',phoneVerified?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:participantEmail})});
        const d=await r.json();if(!r.ok){if(phoneVerified&&r.status===401)setPhoneVerified(false);throw Error(d.error||'Could not find invitations.');}
        if(d.plans.length===1){setResolvedPlan(d.plans[0].id);return;}
        setInvitations(d.plans);setNeedsEmail(true);setError(d.plans.length?'':'No active invitations found for these details.');return;
      }
      const res = await fetch("/api/state", { cache: "no-store", headers:participantHeaders });
      const data = await res.json() as AppState & {error?:string};
      if(res.status===401||res.status===403) {
        setState(null); setNeedsEmail(true);if(res.status===401)setPhoneVerified(false);
        setError((participantEmail||phoneVerified) ? data.error || "Please check your email." : "");
        return;
      }
      if (!res.ok) throw new Error(data.error || "Could not load the calendar.");
      setState(data);
      setNeedsEmail(false);
      if (data.event) setMonth(parseLocal(data.event.startDate));
      setSelectedMember(data.viewer.memberId || "");
      setError("");
    } catch (e) { if(phoneVerified){setState(null);setNeedsEmail(true);}setError(e instanceof Error ? e.message : "Could not load the calendar."); }
    finally {setOpening(false);}
  }, [participantEmail,guest,resolvedPlan,phoneVerified,phoneRefresh]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const result = new Map<string, { available: number; replied: number; names: string[] }>();
    if (!state) return result;
    state.availability.forEach((a) => {
      const row = result.get(a.date) || { available: 0, replied: 0, names: [] };
      row.replied += 1;
      if (a.available) { row.available += 1; row.names.push(state.members.find(m => m.id === a.memberId)?.name || ""); }
      result.set(a.date, row);
    });
    return result;
  }, [state]);

  const ranked = useMemo(() => {
    if (!state?.event) return [];
    const out: { date: string; available: number; replied: number; names: string[] }[] = [];
    for (let d = parseLocal(state.event.startDate), end = parseLocal(state.event.endDate); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate()+1)) {
      const date = iso(d); const row = counts.get(date) || { available: 0, replied: 0, names: [] };
      if (row.available > state.members.length / 2) out.push({ date, ...row });
    }
    return out.sort((a,b) => b.available - a.available || a.date.localeCompare(b.date));
  }, [counts, state]);

  async function createPlan(form: FormData) {
    setSaving(true); setError("");
    try {
      const names = String(form.get("members") || "").split(",").map(v => v.trim()).filter(Boolean);
      const res = await fetch("/api/state", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ name: form.get("name"), startDate: form.get("startDate"), endDate: form.get("endDate"), members: names }) });
      const data = await res.json() as {error?:string}; if (!res.ok) throw new Error(data.error || "Could not create the plan.");
      const created=data as {planId?:string};
      if(created.planId)window.location.assign("/manage?plan="+created.planId+"&setup=1");else await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the plan."); } finally { setSaving(false); }
  }

  async function toggle(date: string) {
    if (!state || !selectedMember || saving || state.event?.archived) return;
    setSaving(true); setError(""); setSaveStatus("Saving…");
    const existing = state.availability.find(a => a.memberId === selectedMember && a.date === date);
    const available = !(existing?.available ?? false);
    const next = existing ? state.availability.map(a => a === existing ? {...a, available} : a) : [...state.availability, {memberId:selectedMember,date,available}];
    setState({...state, availability: next});
    try {
      const res = await fetch("/api/state", { method:"PUT", headers:{"Content-Type":"application/json",...participantHeaders}, body:JSON.stringify({memberId:selectedMember,date,available}) });
      if (!res.ok) throw new Error();
      setSaveStatus("Saved");
    } catch { setState(state); setError("That change did not save. Please try again."); setSaveStatus(""); }
    finally {setSaving(false);}
  }

  async function adminSave(payload:unknown) {
    const res=await fetch("/api/state",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await res.json() as {error?:string};
    if(!res.ok) throw new Error(data.error || "Could not save.");
    await load();
  }

  useEffect(() => {
    const context = (document as unknown as { modelContext?: { registerTool: (tool: unknown, options?: {signal?: AbortSignal}) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool || !state?.event) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "set_availability",
      title: "Set availability",
      description: "Set availability for the currently signed-in invitee. This action cannot edit a different member ID.",
      inputSchema: {
        type: "object",
        properties: { memberName: {type:"string"}, date: {type:"string", description:"YYYY-MM-DD"}, available: {type:"boolean"} },
        required: ["memberName","date","available"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: unknown) => {
        const value=input as {memberName?:string;date?:string;available?:boolean};
        const member=state.members.find(m=>m.name.toLowerCase()===value.memberName?.toLowerCase());
        if(!member||!value.date||typeof value.available!=="boolean") throw new Error("Choose a valid member, date and availability.");
        if(member.id!==state.viewer.memberId) throw new Error("You can only edit your own availability.");
        const response=await fetch("/api/state",{method:"PUT",headers:{"Content-Type":"application/json",...participantHeaders},body:JSON.stringify({memberId:member.id,date:value.date,available:value.available})});
        if(!response.ok) throw new Error("Availability could not be saved.");
        await load();
        return {member:member.name,date:value.date,available:value.available};
      }
    },{signal:lifecycle.signal})).catch(()=>{});
    return () => lifecycle.abort();
  }, [state?.event, state?.members, state?.viewer.memberId, participantEmail, phoneVerified, load]);

  if (adminLogin) return <AdminLogin onDone={()=>{setAdminLogin(false);setParticipantEmail("");window.location.assign("/manage"+(resolvedPlan?"?plan="+resolvedPlan:""));}} onBack={()=>{setAdminLogin(false);window.history.replaceState({},"","/");}}/>;

  if (needsEmail) return <main className="setup-shell"><section className="setup-card">
    <BrandLogo/><h1>When are you free?</h1>
    <div className="account-actions"><button aria-pressed={entryMode==='email'} onClick={()=>{setParticipantEmail('');setPhoneVerified(false);setEntryMode('email');}}>Email</button><button aria-pressed={entryMode==='sms'} onClick={()=>{setParticipantEmail('');setEntryMode('sms');}}>Mobile number</button></div>
    {entryMode==='sms'?<>{error&&<p className="error" role="alert">{error}</p>}{phoneNotice&&<p role="status">{phoneNotice}</p>}{phoneVerified?<><p>{opening?'Mobile number verified. Opening your calendar…':'Your mobile number is verified.'}</p>{!opening&&<><button className="primary" onClick={()=>setPhoneRefresh(v=>v+1)}>Retry opening calendar</button>{resolvedPlan&&<button className="admin-link" onClick={()=>{setResolvedPlan(null);setPhoneRefresh(v=>v+1);}}>Choose another event</button>}</>}<PhonePreferences/></>:<PhoneEntry planId={resolvedPlan} onDone={(notice='')=>{setParticipantEmail('');setError('');setPhoneNotice(notice);setPhoneVerified(true);setPhoneRefresh(v=>v+1);}}/>}</>:<>
    <p className="intro">Please enter your email address to get to the calendar and share your availability.</p>
    <form onSubmit={e=>{e.preventDefault();void (async()=>{setError("");const form=new FormData(e.currentTarget);if(form.get('age')!=='adult'){setError('prod. is only for people aged 18 or over.');return;}try{const r=await window.fetch('/api/age-confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({age:'adult',termsAccepted:form.get('termsAccepted')==='on'})});const d=await r.json();if(!r.ok)throw Error(d.error||'Please confirm you are 18 or over.');const email=String(form.get('email')||'').trim().toLowerCase();if(email===participantEmail)void load();else setParticipantEmail(email);}catch(err){setError(err instanceof Error?err.message:'Please try again.');}})();}}>
      <label>Your email<input name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} defaultValue={participantEmail} required maxLength={254} placeholder="you@example.com"/></label>
      <label>Age<select name="age" required defaultValue=""><option value="" disabled>Select</option><option value="under18">Under 18</option><option value="adult">18 or over</option></select></label>
      <label className="terms-check"><input name="termsAccepted" type="checkbox" required/><span className="terms-check-copy">I agree to the <a href="/terms#terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/terms#privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>
      {error&&<p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={opening}>{opening?"Opening…":"Open calendar"}<ChevronRight size={18}/></button>
    </form>
    </>}
    {invitations.length>0&&<div className="plan-list"><h2>Choose your event</h2>{invitations.map(p=><button key={p.id} onClick={()=>{setInvitations([]);setResolvedPlan(p.id);}}>{p.name}</button>)}</div>}
    <p className="pilot-note">Mobile numbers are verified by text code. Email entry keeps the existing pilot flow. Group members can see names and availability.</p>
    <button className="admin-link" onClick={()=>setAdminLogin(true)}>Administrator sign-in</button>
  </section></main>;

  if (!state) return <main className="center">{!error&&<div className="loader" />}<p role="status">{error || "Opening your calendar…"}</p>{error&&<><button onClick={()=>setAdminLogin(true)}>Administrator sign-in</button><button onClick={()=>void load()}>Try again</button></>}</main>;

  if(!state.event && !state.viewer.isAdmin) return <main className="center"><h1>prod.</h1><p>Your administrator has not created a plan yet.</p></main>;

  if (!state.event) return (
    <main className="setup-shell">
      <section className="setup-card">
        <BrandLogo/>
        <h1>Find the date that works.</h1>
        <button className="admin-link" onClick={onPlans}>Back to My plans</button><p className="intro">Step 1 of 2. Add your dates and names, then complete invitee details in Event Settings.</p>
        <form onSubmit={e=>{e.preventDefault();void createPlan(new FormData(e.currentTarget));}}>
          <label>What are you planning?<input name="name" required placeholder="October sailing weekend" /></label>
          <div className="date-row">
            <label>From<input name="startDate" type="date" required /></label>
            <label>To<input name="endDate" type="date" required /></label>
          </div>
          <label>Who’s coming?<textarea name="members" required placeholder="Oliver, Henry, Eric, Poppy" /><span>Separate names with commas</span></label>
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={saving}>{saving ? "Creating…" : "Continue to Event Settings"}<ChevronRight size={18}/></button>
        </form>
      </section>
    </main>
  );

  if(setupFlow&&state.viewer.isAdmin&&!state.event.archived)return <main className="app-shell"><BrandLogo/><p className="eyebrow">STEP 2 OF 2</p><AdminPanel state={state} onSave={adminSave} onDone={()=>{const url=new URL(window.location.href);url.searchParams.delete('setup');window.history.replaceState({},'',url);setSetupFlow(false);}}/></main>;
  const event = state.event;
  const activeName = state.members.find(m => m.id === selectedMember)?.name;
  const cells = monthDays(month);
  const total = state.members.length;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><BrandLogo/></div>
        <div className="avatars">{state.members.slice(0,4).map((m,i)=><span key={m.id} style={{zIndex:5-i}}>{m.name[0].toUpperCase()}</span>)}{total>4&&<b>+{total-4}</b>}</div>
      </header>
      <div className="account-bar"><span>{state.viewer.isAdmin?"Signed in as":"Availability for"} {state.viewer.email} · {state.viewer.isAdmin?"Administrator":"Invitee"}</span><div className="account-actions">
        {state.viewer.isAdmin&&<button onClick={onPlans}>My plans</button>}
        {state.viewer.isAdmin&&<button onClick={async()=>{const r=await fetch("/api/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(r.ok){setParticipantEmail("");setState(null);setNeedsEmail(true);setAdminOpen(false);}else setError("Could not sign out. Please retry.");}}>Sign out</button>}
        {state.viewer.isAdmin&&!event.archived&&<button onClick={()=>setAdminOpen(!adminOpen)} aria-expanded={adminOpen}>{adminOpen?"Close settings":"Event settings"}</button>}
        <button disabled={saving} onClick={async()=>{try{if(phoneVerified)await phoneApi("/api/phone/logout",{});setPhoneVerified(false);setParticipantEmail("");setState(null);setNeedsEmail(true);setError("");setAdminOpen(false);}catch{setError("Could not change sign-in details. Please retry.");}}}> {state.viewer.isAdmin?"Preview invitee entry":"Change sign-in details"}</button>
        <button onClick={async()=>{try{await navigator.clipboard.writeText("You’re invited to "+state.event!.name+" on prod. Let us know when you’re free: "+window.location.origin+"/?plan="+state.event!.id+"\nPrivacy information: "+window.location.origin+"/terms#privacy");setShareStatus("Invitation and privacy link copied — send it to each invitee.");}catch{setShareStatus("Copy this group link: "+window.location.origin+"/?plan="+state.event!.id);}}}>Copy invitation</button>
      </div></div>
      {event.archived&&<p className="share-status">This plan is archived. Restore it from My plans to make changes.</p>}
      {shareStatus&&<p className="share-status" role="status">{shareStatus}</p>}
      {adminOpen&&state.viewer.isAdmin&&!event.archived&&<AdminPanel state={state} onSave={adminSave}/>}
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="workspace">
        <section className="main-panel">
          <div className="event-head"><div><p className="eyebrow">SHARED PLAN</p><h1>{event.name}</h1><p>{parseLocal(event.startDate).toLocaleDateString("en-GB",{day:"numeric",month:"long"})} – {parseLocal(event.endDate).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"})}</p></div><div className="people-pill"><Users size={16}/>{total} people</div></div>
          <div className="mobile-tabs"><button className={view==="calendar"?"active":""} onClick={()=>setView("calendar")}>Calendar</button><button className={view==="results"?"active":""} onClick={()=>setView("results")}>Best dates</button></div>
          <div className={view==="calendar"?"calendar-wrap":"calendar-wrap mobile-hidden"}>
            <div className="identity-row"><strong>{activeName ? activeName+" · My availability" : "Group calendar · Read only"}</strong><span>{event.archived ? "Archived · Read only" : activeName ? "Tap dates when you’re free" : "Assign your email to your name in Event settings."}</span></div>
            <div className="month-nav"><button aria-label="Previous month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft/></button><h2>{month.toLocaleDateString("en-GB",{month:"long",year:"numeric"})}</h2><button aria-label="Next month" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight/></button></div>
            <div className="calendar-grid weekday-row">{weekDays.map(d=><span key={d}>{d}</span>)}</div>
            <div className="calendar-grid">{cells.map((date,i)=>{
              if(!date) return <span key={`blank-${i}`} />;
              const dateIso=iso(date); const inRange=dateIso>=event.startDate&&dateIso<=event.endDate; const mine=state.availability.find(a=>a.memberId===selectedMember&&a.date===dateIso); const count=counts.get(dateIso)?.available||0;
              return <button key={dateIso} disabled={!inRange||!selectedMember||saving||event.archived} onClick={()=>toggle(dateIso)} className={`day ${mine?.available?"mine":mine?"unavailable":""} ${count===total&&total>0?"all":""}`} aria-label={`${date.toLocaleDateString("en-GB")}, ${mine?.available?"available":mine?"unavailable":"not answered"}`}><span>{date.getDate()}</span>{inRange&&<small>{count}/{total}</small>}{mine&&<i>{mine.available?<Check size={11}/>:<X size={11}/>}</i>}</button>
            })}</div>
            <div className="legend"><span><i className="swatch mine"/>You’re free</span><span><i className="swatch unavailable"/>Unavailable</span><span><i className="swatch all"/>Everyone’s free</span><span><i className="swatch empty"/>No response</span></div>
          </div>
        </section>
        <aside className={view==="results"?"results-panel":"results-panel mobile-hidden"}>
          <div className="results-title"><div><p className="eyebrow">BEST DATES</p><h2>When should we go?</h2></div><Sparkles size={20}/></div>
          {ranked.length ? <div className="result-list">{ranked.map((r,i)=>{const all=r.available===total;return <article key={r.date} className={all?"winner":""}><div className="date-tile"><strong>{parseLocal(r.date).toLocaleDateString("en-GB",{day:"2-digit"})}</strong><span>{parseLocal(r.date).toLocaleDateString("en-GB",{month:"short"})}</span></div><div className="result-copy"><div>{all&&<Crown size={14}/>}<strong>{all?"Everyone is free":`${r.available} of ${total} are free`}</strong></div><p>{parseLocal(r.date).toLocaleDateString("en-GB",{weekday:"long"})} · {r.names.join(", ")}</p></div>{i===0&&<span className="top-choice">TOP</span>}</article>})}</div>:<div className="empty-state"><Users size={28}/><h3>No matches yet</h3><p>Once more than half the group is free, the best dates will appear here.</p></div>}
          <div className="response-progress"><div><span>Responses</span><strong>{new Set(state.availability.map(a=>a.memberId)).size}/{total}</strong></div><div className="progress"><i style={{width:`${new Set(state.availability.map(a=>a.memberId)).size/total*100}%`}}/></div><p role="status">{saveStatus || (activeName ? activeName+", your changes save automatically." : "Only your own responses can be edited.")}</p></div>
        </aside>
      </div>
      {phoneVerified&&<>{phoneNotice&&<p role="status">{phoneNotice}</p>}<PhonePreferences/></>}
    </main>
  );
}

function AdminPanel({state,onSave,onDone}:{state:AppState;onSave:(payload:unknown)=>Promise<void>;onDone?:()=>void}) {
  const panel=useRef<HTMLElement>(null);
  async function finish(){
    if(panel.current?.querySelector('form button:disabled')){setStatus('Please wait for the current save to finish.');return;}
    const forms=Array.from(panel.current?.querySelectorAll('form')||[]);
    const payloads:unknown[]=[];
    for(const form of forms){
      const data=new FormData(form);
      if(form.classList.contains('admin-event-form')){if(!form.reportValidity())return;payloads.push({action:'event',name:data.get('name'),startDate:data.get('startDate'),endDate:data.get('endDate')});continue;}
      const id=form.dataset.memberId;
      const member=state.managedMembers?.find(m=>m.id===id);
      if(!id&&!String(data.get('name')||'').trim()&&!String(data.get('email')||'').trim()&&!String(data.get('phone')||'').trim())continue;
      if(!form.reportValidity())return;
      if(member?.active!==0&&!String(data.get(data.get('notification')==='sms'?'phone':'email')||'').trim()){setStatus('Please add the chosen email or mobile number for each active invitee.');return;}
      if(!member||member.name!==data.get('name')||(member.email||'')!==data.get('email')||(member.phone||'')!==data.get('phone')||(member.notification||'email')!==data.get('notification'))payloads.push({action:'member',id:id||undefined,name:data.get('name'),email:data.get('email'),phone:data.get('phone'),notification:data.get('notification'),active:member?!!member.active:true});
    }
    setBusy(true);setStatus('');
    try{for(const payload of payloads)await onSave(payload);onDone?.();}catch(e){setStatus(e instanceof Error?e.message:'Could not save. Please retry.');}finally{setBusy(false);}
  }
  const [status,setStatus]=useState("");
  const [busy,setBusy]=useState(false);
  async function saveEvent(form:FormData){
    setBusy(true);setStatus("");
    try{await onSave({action:"event",name:form.get("name"),startDate:form.get("startDate"),endDate:form.get("endDate")});setStatus("Event saved. Existing responses have been kept.");}
    catch(e){setStatus(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}
  }
  return <section className="admin-panel" ref={panel}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
    <h2>Event settings</h2>{onDone&&<p>Complete the names and contact details below. When you’re ready, save your details and open the calendar.</p>}
    <p>Only you can change these settings. Shortening the date range hides responses outside it without deleting them.</p>
    <form onSubmit={e=>{e.preventDefault();void saveEvent(new FormData(e.currentTarget));}} className="admin-event-form">
      <label>Event name<input name="name" defaultValue={state.event?.name} required maxLength={120}/></label>
      <label>From<input name="startDate" type="date" defaultValue={state.event?.startDate} required/></label>
      <label>To<input name="endDate" type="date" defaultValue={state.event?.endDate} required/></label>
      <button className="primary" disabled={busy}>{busy?"Saving…":"Save event"}</button>
    </form><p role="status">{status}</p>
    <h3>Members</h3>
    <p>Add an email, mobile number, or both, then choose Email or SMS responses. SMS uses a verification code; email retains the pilot entry flow. Text invitations require the invitee’s permission. Share the event link through WhatsApp for people who need to opt in.</p>
    <div className="member-editors">{state.managedMembers?.map(m=><MemberEditor key={m.id+":"+(m.email||"")+":"+(m.phone||"")+":"+m.notification+":"+m.active} member={m} onSave={onSave}/>)}</div>
    <h3>Add a member</h3><AddFromContacts onSave={onSave}/><MemberEditor onSave={onSave}/>{state.event&&!state.event.archived&&<SmsInvitations planId={state.event.id} onRefresh={()=>{}}/>}
    {onDone&&<button type="button" className="primary" disabled={busy} onClick={()=>void finish()}>{busy?'Saving…':'Done — open calendar'}<ChevronRight size={18}/></button>}
  </fieldset></section>;
}

function MemberEditor({member,onSave}:{member?:Member;onSave:(payload:unknown)=>Promise<void>}) {
  const [busy,setBusy]=useState(false);const [status,setStatus]=useState("");
  async function save(form:HTMLFormElement){
    const data=new FormData(form);setBusy(true);setStatus("");
    try{await onSave({action:"member",id:member?.id,name:data.get("name"),email:data.get("email"),phone:data.get("phone"),notification:data.get("notification"),active:member?!!member.active:true});setStatus("Saved");if(!member)form.reset();}
    catch(e){setStatus(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}
  }
  async function changeActive(){
    if(!member)return;setBusy(true);setStatus("");
    try{await onSave({action:"member",id:member.id,name:member.name,email:member.email,phone:member.phone,notification:member.notification,active:!member.active});}
    catch(e){setStatus(e instanceof Error?e.message:"Could not save.");}finally{setBusy(false);}
  }
  return <form className="member-editor" data-member-id={member?.id} onSubmit={e=>{e.preventDefault();void save(e.currentTarget);}}>
    <label>Name<input name="name" defaultValue={member?.name||""} required maxLength={80}/></label>
    <label>Invitee email<input name="email" type="email" defaultValue={member?.email||""} placeholder="name@example.com"/></label>
    <label>Mobile number<input name="phone" type="tel" autoComplete="tel" defaultValue={member?.phone||""} maxLength={40} placeholder="07700 900123"/></label>
    <label>Response method<select name="notification" defaultValue={member?.notification||'email'}><option value="email">Email</option><option value="sms">SMS (verified mobile)</option></select></label>
    {member?.notification==='sms'&&<small>{member.smsAllowed?'SMS permission recorded':'Share the link so they can opt in'}{member.smsStatus?' · Invitation: '+member.smsStatus:''}</small>}
    <span className="member-status">{member?(member.active?((member.notification==='sms'?member.phone:member.email)?"Contact saved":"Contact needed"):"Removed"):"New member"}</span>
    <button type="submit" disabled={busy}>{member?"Save":"Add member"}</button>
    {member&&<button type="button" disabled={busy} onClick={()=>void changeActive()}>{member.active?"Remove from plan":"Restore"}</button>}
    <p role="status">{status}</p>
  </form>;
}

function AdminLogin({onDone,onBack}:{onDone:()=>void;onBack:()=>void}) {
 const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 return <main className="setup-shell"><section className="setup-card"><BrandLogo/><h1>Administrator sign-in</h1>
 <form onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);setError("");try{const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:form.get("email"),password:form.get("password")})});if(!r.ok){const data=await r.json();throw new Error(data.error||"Sign-in failed.");}onDone();}catch(e){setError(e instanceof Error?e.message:"Sign-in failed.");}finally{setBusy(false);}}}>
 <label>Email<input name="email" type="email" autoComplete="username" required/></label>
 <label>Password<input name="password" type="password" autoComplete="current-password" required/></label>
 {error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?"Signing in…":"Sign in"}</button></form><button className="admin-link" onClick={onBack}>Back to invitee entry</button></section></main>;
}


type PlanSummary={id:string;name:string;startDate:string;endDate:string;archived:boolean};
export default function App(){
 const [url,setUrl]=useState(()=>new URL(window.location.href));
 const navigate=(path:string)=>{window.history.pushState({},'',path);setUrl(new URL(window.location.href));};
 useEffect(()=>{const pop=()=>setUrl(new URL(window.location.href));window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
 const plan=url.searchParams.get('plan');
 const manage=url.pathname==='/manage';
 const open=(id:string)=>navigate('/manage?plan='+id);
 let page;
 if(url.pathname==='/terms')page=<LegalPage/>;
 else if(url.pathname==='/account')page=<AccountPage/>;
 else if(url.pathname==='/auth/confirmed')page=<ConfirmationReturn onReady={()=>navigate('/manage?plan=new')}/>;
 else if(manage)page=<InviterGate key="manage" onReady={()=>{}}>{plan?<Home key={plan} planId={plan} onPlans={()=>navigate('/manage')}/>:<Plans onOpen={open} onGuest={()=>navigate('/signin')}/>}</InviterGate>;
 else if(url.pathname==='/register'||url.pathname==='/signin')page=<InviterGate key={url.pathname} register={url.pathname==='/register'} onReady={()=>navigate(url.pathname==='/register'?'/manage?plan=new':'/manage')}/>;
 else if(url.pathname==='/admin')page=<AdminLogin onDone={()=>navigate('/manage')} onBack={()=>navigate('/')}/>;
 else if(plan||url.pathname==='/respond')page=<Home key={plan||'guest'} guest planId={plan} onPlans={()=>navigate('/manage')}/>;
 else page=<main className="landing"><BrandLogo/><section className="landing-intro"><p className="eyebrow">LESS BACK AND FORTH. MORE GETTING TOGETHER.</p><h1>Good plans start<br/>with a little prod.</h1><p>Bring your people together. Find a date that works.</p></section><div className="landing-choices"><section><CalendarDays size={30}/><h2>Make a plan</h2><p>A catch-up, a weekend away, or something worth getting everyone together for.</p><button className="primary" onClick={()=>navigate('/register')}>Create an event <ChevronRight size={18}/></button><button className="admin-link" onClick={()=>navigate('/signin')}>Already registered? Sign in</button></section><section><Users size={30}/><h2>Been invited?</h2><p>Let your friends know when you’re free and get the plan moving.</p><button className="primary guest-cta" onClick={()=>navigate('/respond')}>Respond to an invitation <ChevronRight size={18}/></button><p className="landing-hint">Have an event link? Open it to go straight to your event.</p></section></div></main>;
 return <div className="site-frame"><div className="site-content">{page}</div><footer className="site-footer"><BrandLogo/><small>© Hound Capital Ltd 2026</small><a href="/terms">terms.</a><a href="mailto:office@hound-capital.com" className="help-button">Help!</a></footer></div>;
}

function ConfirmationReturn({onReady}:{onReady:()=>void}){
 const [token]=useState(()=>new URLSearchParams(window.location.hash.slice(1)).get('access_token')||'');
 const [email,setEmail]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 async function send(){setBusy(true);setError('');try{
  if(!token)throw Error('This confirmation link is missing or expired. Please return to sign in.');
  const r=await fetch('/api/confirmed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not send your code.');setEmail(d.email);
 }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 useEffect(()=>{window.history.replaceState({},'',window.location.pathname);void send();},[]);
 if(email)return <InviterGate confirmedEmail={email} onReady={onReady}/>;
 return <main className="setup-shell"><section className="setup-card"><BrandLogo/><h1>Email confirmation</h1>{busy?<p>Preparing your sign-in code…</p>:<><p role="alert">{error}</p>{token&&<button className="primary" onClick={()=>void send()}>Retry sending code</button>}<a className="admin-link" href="/signin">Return to sign in</a></>}</section></main>;
}

function InviterGate({children,register=false,onReady,confirmedEmail=''}:{children?:React.ReactNode;register?:boolean;onReady:()=>void;confirmedEmail?:string}){
 const [stage,setStage]=useState(confirmedEmail?'code':'loading'),[email,setEmail]=useState(confirmedEmail),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [details,setDetails]=useState({name:'',sex:'',ageRange:'',termsVersion:TERMS_VERSION,termsAccepted:false});
 async function api(path:string,data?:unknown){const r=await window.fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const d=await r.json();if(!r.ok)throw Error(d.error||'Please try again.');return d;}
 async function check(){try{const d=await api('/api/profile');setEmail(d.email);if(d.profile){if(d.termsVersion!==TERMS_VERSION)setStage('terms');else{setStage('ready');if(!children)onReady();}}else setStage('profile');}catch{setStage(register?'register':'email');}}
 useEffect(()=>{if(!confirmedEmail)void check();},[]);
 async function submit(form:FormData){setBusy(true);setError('');try{
 if(stage==='register'||stage==='email'){const e=String(form.get('email')).trim();setEmail(e);if(stage==='register'){if(!['18–24','25–34','35–44','45–54','55–64','65+'].includes(String(form.get('ageRange'))))throw Error('You must be 18 or over to register. No email has been sent.');if(form.get('termsAccepted')!=='on')throw Error('Please agree to the Terms.');setDetails({name:String(form.get('name')),sex:String(form.get('sex')),ageRange:String(form.get('ageRange')),termsVersion:TERMS_VERSION,termsAccepted:true});}await api('/api/send-code',{email:e,...(stage==='register'?{profile:{name:String(form.get('name')),sex:String(form.get('sex')),ageRange:String(form.get('ageRange')),termsVersion:TERMS_VERSION,termsAccepted:true}}:{})});setStage(stage==='register'?'confirmation':'code');}
 else if(stage==='code'){await api('/api/verify-code',{email,code:String(form.get('code')).trim()});if(details.name){try{await api('/api/profile',details);}catch(e){setStage('profile');throw e;}}await check();}
 else if(stage==='profile'){await api('/api/profile',{name:form.get('name'),sex:form.get('sex'),ageRange:form.get('ageRange'),termsVersion:TERMS_VERSION,termsAccepted:form.get('termsAccepted')==='on'});setStage('ready');if(!children)onReady();}
 else if(stage==='terms'){await api('/api/accept-terms',{termsVersion:TERMS_VERSION,termsAccepted:form.get('termsAccepted')==='on'});setStage('ready');if(!children)onReady();}
 }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
 if(stage==='confirmation')return <main className="setup-shell"><section className="setup-card"><BrandLogo/><h1>Check your email</h1><p>Open the confirmation link sent to {email}. Once confirmed, we’ll send your sign-in code automatically.</p><p>Already registered? Your email may contain a sign-in code instead.</p><button className="primary" onClick={()=>setStage('code')}>Enter a sign-in code</button><button className="admin-link" onClick={()=>setStage('register')}>Change details or resend</button></section></main>;
 if(stage==='ready')return <>{children||<p className="center">Opening your event…</p>}</>;
 if(stage==='loading')return <p className="center">Opening your account…</p>;
 return <main className="setup-shell"><section className="setup-card"><BrandLogo/><h1>{stage==='terms'?'Updated terms':stage==='code'?'Check your email':stage==='profile'?'Your details':stage==='register'?'Let’s make a plan.':'Welcome back.'}</h1><p className="intro">{stage==='code'?`Enter the sign-in code sent to ${email}.`:stage==='register'?'Register once, then create your event.':stage==='profile'?'Complete your details before creating an event.':'Enter your email and we’ll send you a sign-in code.'}</p><form onSubmit={e=>{e.preventDefault();void submit(new FormData(e.currentTarget));}}>
 {(stage==='register'||stage==='profile')&&<><label>Name<input name="name" autoComplete="name" maxLength={80} required defaultValue={details.name}/></label></>}
 {(stage==='register'||stage==='email')&&<label>Email<input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={email}/></label>}
 {(stage==='register'||stage==='profile')&&<><label>Sex<select name="sex" required defaultValue={details.sex}><option value="" disabled>Select</option>{['Female','Male','Intersex','Prefer not to say'].map(x=><option key={x}>{x}</option>)}</select></label><label>Age range<select name="ageRange" required defaultValue={details.ageRange}><option value="" disabled>Select</option>{['Under 18','18–24','25–34','35–44','45–54','55–64','65+','Prefer not to say'].map(x=><option key={x}>{x}</option>)}</select></label><p className="pilot-note">Your registration details are private and are not shown to invitees.</p></>}
 {(stage==='register'||stage==='profile'||stage==='terms')&&<label className="terms-check"><input name="termsAccepted" type="checkbox" required/><span className="terms-check-copy">I agree to the <a href="/terms#terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and acknowledge the <a href="/terms#privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</span></label>}
 {stage==='code'&&<label>Sign-in code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,10}" required maxLength={10}/></label>}
 {error&&<p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy}>{busy?'Please wait…':stage==='code'?'Verify email':stage==='profile'?'Continue to event':stage==='register'?'Register':stage==='terms'?'Agree and continue':'Send sign-in code'}</button></form>
 {stage==='code'&&<button className="admin-link" disabled={busy} onClick={()=>{setError('');setStage(details.name?'register':'email');}}>Change email or request another code</button>}
 <a className="admin-link" href="/">Back to home</a><a className="admin-link" href="/admin">Existing administrator password sign-in</a></section></main>;
}

function Plans({onOpen,onGuest}:{onOpen:(id:string)=>void;onGuest:()=>void}){
 const [plans,setPlans]=useState<PlanSummary[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[archived,setArchived]=useState(false);
 async function load(){try{const r=await window.fetch('/api/state?view=plans',{cache:'no-store'});if(r.status===401||r.status===403){onGuest();return;}const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load plans');setPlans(d.plans||[]);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load plans');}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 async function archive(p:PlanSummary){setBusy(true);try{const r=await window.fetch('/api/state?plan='+p.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'archive',archived:!p.archived})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not update plan');await load();}catch(e){setError(e instanceof Error?e.message:'Could not update plan');}finally{setBusy(false);}}
 return <main className="plans-shell"><header className="plans-heading"><div><BrandLogo/><h1>My plans</h1></div><div className="account-actions"><button onClick={()=>onOpen('new')}>Create plan</button><button onClick={async()=>{try{const r=await window.fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Could not sign out');onGuest();}catch{setError('Could not sign out. Please retry.');}}}>Sign out</button></div></header>
 <div className="account-actions"><button aria-pressed={!archived} onClick={()=>setArchived(false)}>Active plans</button><button aria-pressed={archived} onClick={()=>setArchived(true)}>Archived plans</button></div>
 {error&&<p className="error" role="alert">{error}<button onClick={()=>void load()}>Retry</button></p>}{loading?<p>Loading plans…</p>:<div className="plan-list">{plans.filter(p=>p.archived===archived).map(p=><article className="plan-card" key={p.id}><h2>{p.name}</h2><p>{parseLocal(p.startDate).toLocaleDateString('en-GB')} – {parseLocal(p.endDate).toLocaleDateString('en-GB')}</p><div className="account-actions"><button onClick={()=>onOpen(p.id)}>Open plan</button><button disabled={busy} onClick={()=>void archive(p)}>{p.archived?'Restore':'Archive'}</button></div></article>)}{!plans.some(p=>p.archived===archived)&&<p>{archived?'No archived plans.':'No active plans. Create a plan to get started.'}</p>}</div>}
 </main>;
}









