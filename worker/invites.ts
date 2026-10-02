import {AccessError} from './permissions.ts';
import {hash,normalPhone,type Rpc} from './sms.ts';
export interface EmailEnv {EMAIL_ENABLED?:string;SENDGRID_API_KEY?:string;EMAIL_FROM?:string;EMAIL_DAILY_LIMIT?:string;SMS_PUBLIC_ORIGIN?:string}
export function normalContact(value:unknown){
 if(typeof value!=='string')throw new AccessError('Enter your invited email or UK mobile number.',400);
 const contact=value.trim().toLowerCase();
 if(!contact.includes('@'))return normalPhone(contact);
 if(contact.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(contact))throw new AccessError('Enter a valid email address.',400);
 return contact;
}
export async function contactRate(rpc:Rpc,ip:string){
 if(!await rpc('prod_sms_rate',{p_keys:['contact:'+await hash(ip)],p_max:120,p_seconds:60}))throw new AccessError('Too many requests. Please try in a minute.',429);
}
export function emailConfigured(env:EmailEnv){return env.EMAIL_ENABLED==='true'&&!!env.SENDGRID_API_KEY&&!!env.EMAIL_FROM&&/^\S+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM);}
export async function processEmail(env:EmailEnv,rpc:Rpc){
 if(!emailConfigured(env))return;
 const origin=new URL(env.SMS_PUBLIC_ORIGIN||'');
 if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash)throw new AccessError('Set the public website origin.',503);
 const limit=Number(env.EMAIL_DAILY_LIMIT||'50');
 if(!Number.isInteger(limit)||limit<1||limit>1000)throw new AccessError('EMAIL_DAILY_LIMIT must be between 1 and 1000.',503);
 for(let i=0;i<10;i++){
  const j=await rpc('prod_email_claim',{p_daily_limit:limit});if(!j)return;
  let response:Response;
  try{response=await fetch('https://api.sendgrid.com/v3/mail/send',{method:'POST',headers:{Authorization:'Bearer '+env.SENDGRID_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({
   personalizations:[{to:[{email:j.email}]}],from:{email:env.EMAIL_FROM,name:'prod.'},
   subject:'You’re invited to '+j.eventName,
   content:[{type:'text/plain',value:`${j.organiser} invites you to ${j.eventName} on prod.\n\nLet us know when you’re free: ${origin.origin}/?plan=${j.planId}\n\nEnter the email address or mobile number your organiser added. No verification code is needed.\n\nPrivacy information: ${origin.origin}/terms#privacy`}],
   tracking_settings:{click_tracking:{enable:false,enable_text:false},open_tracking:{enable:false}}
  }),signal:AbortSignal.timeout(15000)});}
  catch{await rpc('prod_email_result',{p_id:j.id,p_status:'unknown',p_error:'request_timeout'});continue;}
  await rpc('prod_email_result',{p_id:j.id,p_status:response.status===202?'accepted':response.status>=500?'unknown':'failed',p_error:response.status===202?null:String(response.status)});
 }
}
