import type {Rpc} from './sms.ts';
export interface ReportingEnv {REPORTS_ENABLED?:string;REPORT_EMAIL?:string;REPORT_INITIAL_TEST_DATE?:string;SENDGRID_API_KEY?:string;EMAIL_FROM?:string;SUPABASE_SECRET_KEY:string}
export function reportDate(now=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const get=(key:string)=>parts.find(p=>p.type===key)!.value;
 const today=`${get('year')}-${get('month')}-${get('day')}`;
 const yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
 return {today,yesterday,due:Number(get('hour'))>=7};
}
export async function unsubscribeSignature(job:string,secret:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('prod-email-optout-v1:'+job)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function validUnsubscribe(job:string,signature:string,secret:string){
 if(!/^[0-9a-f-]{36}$/i.test(job)||!/^[0-9a-f]{64}$/.test(signature))return false;
 const expected=await unsubscribeSignature(job,secret);let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^signature.charCodeAt(i);return diff===0;
}
export interface DailyReport {day:string;test:boolean;partial:boolean;startedAt:string;metrics:Record<string,number>;responders:number;totalUsers:number;activeEvents:number;pendingSms:number;pendingEmail:number;unknownSms:number;unknownEmail:number;failedReports:number}
export function reportText(r:DailyReport){
 const m=(key:string)=>r.metrics[key]||0;
 return `prod. — your daily update\n\nActivity for ${r.day}, UK time. ${r.partial?'PARTIAL PERIOD: tracking started '+r.startedAt+'; this report includes only activity recorded so far.':'Midnight to midnight, Europe/London.'}\n\nSITE ACTIVITY\nVisits (page loads): ${m('page_loads')}\nNew registered users: ${m('registrations')}\nNew events created: ${m('events_created')}\nParticipants who saved availability: ${r.responders}\n\nINVITATIONS AND OPT-OUTS\nText invitations accepted by Twilio: ${m('sms_invites_accepted')}\nText reminders accepted by Twilio: ${m('sms_reminders_accepted')}\nTexts confirmed delivered today: ${m('sms_delivered')}\nEmail invitations accepted by SendGrid: ${m('email_accepted')}\nSMS opt-outs (STOP): ${m('sms_optouts')}\nEmail opt-outs through prod. unsubscribe links: ${m('email_optouts')}\n\nISSUES WORTH A LOOK\nSMS failures recorded: ${m('sms_failed')}\nEmail API rejections recorded: ${m('email_failed')}\nUncertain SMS/email sending outcomes today: ${m('sms_unknown')} / ${m('email_unknown')}\nRecorded server errors: ${m('api_errors')}\nMessages waiting more than 15 minutes: ${r.pendingSms} SMS / ${r.pendingEmail} email\nUnresolved sending outcomes (all dates): ${r.unknownSms} SMS / ${r.unknownEmail} email\nFailed or uncertain report sends (all dates): ${r.failedReports}\n\nAT A GLANCE — at report generation\nTotal registered users: ${r.totalUsers}\nActive, unarchived events: ${r.activeEvents}\n\nNOTES\nVisits count successful page loads, including refreshes, excluding recognised bots; they are not unique people. No visitor identifiers or tracking cookies are stored. Availability counts distinct participants per event who saved or changed a date, including organisers. Registration means a completed prod. profile.\nEmail inbox delivery, bounces, spam complaints and SendGrid-side unsubscribes: not available until delivery reporting is connected. A provider accepting a message is not proof of delivery. Delivery counts can relate to invitations sent on earlier days. Server error counts exclude client-side errors and failures before the Worker runs.\n\ngive it a prod.`;
}
export async function processReports(env:ReportingEnv,rpc:Rpc,now=new Date()){
 if(env.REPORTS_ENABLED!=='true'||!env.REPORT_EMAIL||!env.EMAIL_FROM||!env.SENDGRID_API_KEY)return;
 const dates=reportDate(now);
 const requests:{day:string;test:boolean}[]=[];
 if(env.REPORT_INITIAL_TEST_DATE===dates.today)requests.push({day:dates.today,test:true});
 if(dates.due)requests.push({day:dates.yesterday,test:false});
 for(const request of requests){
  const report=await rpc('prod_report_claim',{p_day:request.day,p_test:request.test}) as DailyReport|null;if(!report)continue;
  let status='unknown',error:string|null='request_timeout';
  try{
   const r=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:'Bearer '+env.SENDGRID_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({personalizations:[{to:[{email:env.REPORT_EMAIL}]}],from:{email:env.EMAIL_FROM,name:'prod.'},subject:`${request.test?'TEST — ':''}prod. daily update — ${request.day}`,content:[{type:'text/plain',value:reportText(report)}],tracking_settings:{click_tracking:{enable:false,enable_text:false},open_tracking:{enable:false}}}),signal:AbortSignal.timeout(15000)});
   status=r.status===202?'accepted':r.status>=500?'unknown':'failed';error=r.status===202?null:String(r.status);
  }catch{/* Do not retry an uncertain send and risk duplicate reports. */}
  await rpc('prod_report_result',{p_day:request.day,p_test:request.test,p_status:status,p_error:error});
 }
}
export function unsubscribePage(done=false){return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email preferences — prod.</title><body style="font-family:Arial,sans-serif;background:#faf8f5;color:#263c3b;margin:0;padding:40px 20px"><main style="max-width:520px;margin:auto;background:white;padding:32px;border-radius:20px"><a href="/" style="font-size:44px;color:#ff604e;text-decoration:none">prod.</a><h1>${done?'You’ve stopped invitation emails':'Stop invitation emails?'}</h1><p>${done?'We won’t send further event invitation emails to this address. Sign-in emails you request are unaffected.':'This stops prod. event invitation emails to the address that received this invitation. It does not affect sign-in emails or texts.'}</p>${done?'':'<form method="post"><button style="background:#397f79;color:white;padding:14px 20px;border:0;border-radius:10px;font-size:16px">Stop invitation emails</button></form>'}<p><a href="/terms#privacy">Privacy information</a></p></main></body></html>`;}
