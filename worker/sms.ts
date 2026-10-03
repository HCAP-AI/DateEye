import {AccessError} from './permissions.ts';
export interface SmsEnv {
 TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string;TWILIO_MESSAGING_SERVICE_SID?:string;
 SMS_PUBLIC_ORIGIN?:string;SMS_ENABLED?:string;SMS_DAILY_LIMIT?:string;
}
export type Rpc=(name:string,data:Record<string,unknown>)=>Promise<any>;
export function normalPhone(value:unknown):string {
 if(typeof value!=='string'||value.length>40)throw new AccessError('Enter a UK mobile number.',400);
 let phone=value.replace(/[\s()-]/g,'');if(phone.startsWith('0044'))phone='+'+phone.slice(2);if(phone.startsWith('07'))phone='+44'+phone.slice(1);
 if(!/^\+447\d{9}$/.test(phone))throw new AccessError('Enter a UK mobile number, such as 07700 900123.',400);
 return phone;
}
export async function hash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function phoneRate(rpc:Rpc,phone:string,ip:string,verify=false){
 const key=verify?'verify':'otp';
 const ids=await Promise.all([hash(phone),hash(ip)]);
 if(!verify&&!await rpc('prod_sms_rate',{p_keys:[key+':minute:'+ids[0]],p_max:1,p_seconds:60}))throw new AccessError('Please wait a minute before requesting another text.',429);
 if(!await rpc('prod_sms_rate',{p_keys:ids.map(x=>key+':hour:'+x),p_max:verify?20:5,p_seconds:3600}))throw new AccessError('Too many attempts. Please try later.',429);
 if(!verify&&!await rpc('prod_sms_rate',{p_keys:['otp:day:'+ids[1]],p_max:20,p_seconds:86400}))throw new AccessError('Daily text limit reached. Please try tomorrow.',429);
}
export function smsConfig(env:SmsEnv){
 for(const key of ['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_MESSAGING_SERVICE_SID','SMS_PUBLIC_ORIGIN'] as const)if(!env[key])throw new AccessError('SMS runtime setting missing: '+key,503);
 if(!/^AC[0-9a-f]{32}$/i.test(env.TWILIO_ACCOUNT_SID!)||!/^MG[0-9a-f]{32}$/i.test(env.TWILIO_MESSAGING_SERVICE_SID!))throw new AccessError('Check the Twilio Account and Messaging Service SIDs.',503);
 const u=new URL(env.SMS_PUBLIC_ORIGIN!);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash)throw new AccessError('SMS_PUBLIC_ORIGIN must be the HTTPS website origin.',503);
 return u.origin;
}
export function smsText(job:{kind:string;eventName:string;organiser:string;planId:string},origin:string){
 // Keep each name on one line while preserving its spelling.
 const clean=(v:string,n:number)=>v.replace(/\s+/g,' ').trim().slice(0,n);
 const link=origin+'/?plan='+job.planId+'&via=sms';
 return job.kind==='reminder'?`prod. Reminder: share your availability for ${clean(job.eventName,35)}: ${link} Reply STOP to stop texts.`:
 `${clean(job.organiser,80)} has invited you to ${clean(job.eventName,120)}\nShare your availability - ${link}\nReply STOP to stop texts\nprod.`;
}
export async function processSms(env:SmsEnv,rpc:Rpc){
 if(env.SMS_ENABLED!=='true')return;
 const origin=smsConfig(env);const limit=Number(env.SMS_DAILY_LIMIT||'50');
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new AccessError('SMS_DAILY_LIMIT must be between 1 and 1000.',503);
 for(let i=0;i<10;i++){
  const j=await rpc('prod_sms_claim',{p_daily_limit:limit});if(!j)return;
  const form=new URLSearchParams({To:j.phone,MessagingServiceSid:env.TWILIO_MESSAGING_SERVICE_SID!,Body:smsText(j,origin),StatusCallback:origin+'/api/sms/status?job='+j.id});
  let response:Response;
  try{response=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+env.TWILIO_ACCOUNT_SID+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+btoa(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN),'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(15000)});}
  catch{await rpc('prod_sms_result',{p_id:j.id,p_status:'unknown',p_error:'request_timeout'});continue;}
  // No automatic resend after a timeout or 5xx: Twilio may already have accepted it.
  let d:any;try{d=await response.json();}catch{await rpc('prod_sms_result',{p_id:j.id,p_status:'unknown',p_error:'invalid_provider_response'});continue;}
  if(response.ok&&/^SM[0-9a-f]{32}$/i.test(d.sid||''))await rpc('prod_sms_result',{p_id:j.id,p_status:'accepted',p_sid:d.sid});
  else await rpc('prod_sms_result',{p_id:j.id,p_status:response.status>=500?'unknown':'failed',p_error:String(d.code||response.status)});
 }
}
export async function validTwilio(request:Request,env:SmsEnv,params:URLSearchParams){
 if(!env.TWILIO_AUTH_TOKEN||!env.SMS_PUBLIC_ORIGIN)return false;
 const url=new URL(request.url);if(url.origin!==new URL(env.SMS_PUBLIC_ORIGIN).origin)return false;
 let payload=url.href;
 for(const name of [...new Set(params.keys())].sort())for(const value of [...new Set(params.getAll(name))].sort())payload+=name+value;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.TWILIO_AUTH_TOKEN),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const expected=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)))));
 const actual=request.headers.get('x-twilio-signature')||'';
 if(actual.length!==expected.length)return false;
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^actual.charCodeAt(i);return diff===0;
}
export async function smsWebhook(request:Request,env:SmsEnv,rpc:Rpc){
 if(request.method!=='POST'||!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new AccessError('Invalid webhook.',400);
 const text=await request.text();if(text.length>16384)throw new AccessError('Request too large.',413);
 const params=new URLSearchParams(text);
 if(!await validTwilio(request,env,params)||params.get('AccountSid')!==env.TWILIO_ACCOUNT_SID)throw new AccessError('Invalid webhook signature.',403);
 const url=new URL(request.url);
 if(url.pathname==='/api/sms/status'){
  const id=url.searchParams.get('job');if(!id||!uuid(id))throw new AccessError('Invalid job.',400);
  const status=params.get('MessageStatus');const sid=params.get('MessageSid');if(!/^SM[0-9a-f]{32}$/i.test(sid||''))throw new AccessError('Invalid message.',400);
  if(status==='delivered'||status==='failed'||status==='undelivered')await rpc('prod_sms_result',{p_id:id,p_sid:sid,p_status:status==='delivered'?'delivered':'failed',p_error:params.get('ErrorCode')});
 }else{
  const ph=normalPhone(params.get('From'));
  const type=params.get('OptOutType');const text=(params.get('Body')||'').trim().toUpperCase();
  if(type==='STOP'||['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(text))await rpc('prod_sms_inbound',{p_phone:ph,p_stop:true});
  else if(type==='START'||['START','UNSTOP'].includes(text))await rpc('prod_sms_inbound',{p_phone:ph,p_stop:false});
 }
 return new Response('<?xml version="1.0" encoding="UTF-8"?><Response/>',{headers:{'Content-Type':'text/xml'}});
}
export function uuid(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}
