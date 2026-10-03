import {processReports,validUnsubscribe,unsubscribePage,type ReportingEnv} from './reporting.ts';
import {normalContact,contactRate,emailConfigured,processEmail,type EmailEnv} from './invites.ts';

import {normalPhone,phoneRate,processSms,smsWebhook,uuid, type SmsEnv} from './sms.ts';
import {AccessError, validateEvent, validateMember, validDate} from './permissions.ts';
export interface Env extends SmsEnv,EmailEnv,ReportingEnv {
 SUPABASE_URL:string; SUPABASE_PUBLISHABLE_KEY:string; SUPABASE_SECRET_KEY:string; ADMIN_EMAIL:string;
 ASSETS:{fetch:(r:Request)=>Promise<Response>};
}
const COOKIE='prod_session';
const ADULT_COOKIE='prod_adult';
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
function cookie(request:Request){return request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';}
function cookieValue(request:Request,value:string,seconds:number){return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
async function body(request:Request){
 if(request.headers.get('sec-fetch-site')==='cross-site')throw new AccessError('Cross-site changes are not allowed.');
 const origin=request.headers.get('origin');
 if(origin && origin!==new URL(request.url).origin)throw new AccessError('Request origin does not match.');
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new AccessError('JSON is required.',415);
 const reader=request.body?.getReader();if(!reader)throw new AccessError('Request body required.',400);
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new AccessError('Request too large.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{const b=JSON.parse(new TextDecoder().decode(bytes));if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b as Record<string,unknown>;}catch{throw new AccessError('Invalid JSON.',400);}
}
async function supa(env:Env,path:string,init:RequestInit={},privileged=false){
 const missing = (['SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY'] as const).filter(name => typeof env[name] !== 'string' || !env[name].trim());
 if(missing.length)throw new AccessError('Cloudflare runtime setting missing: '+missing.join(', ')+'. Add it under this Worker\'s Settings > Variables and Secrets, then deploy the saved version.',503);
 return fetch(env.SUPABASE_URL+path,{...init,headers:{apikey:privileged?env.SUPABASE_SECRET_KEY:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(15000)});
}
async function rpc(env:Env,name:string,data:Record<string,unknown>){
 const r=await supa(env,'/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(data)},true);
 const d=await r.json() as {code?:string;message?:string};
 if(!r.ok)throw new AccessError(d.code==='42501'?'This invitation or action is not available.':d.code==='P0001'?d.message||'Request refused.':'Invitation database request failed. Check migrations 06 and 07.',d.code==='42501'?403:d.code==='P0001'?400:502);
 return d;
}
function phoneCookie(request:Request,value:string,seconds:number){return `prod_phone_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
async function phoneUser(request:Request,env:Env){
 const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('prod_phone_session='))?.slice(19);
 if(!token)throw new AccessError('Please verify your mobile number.',401);
 const r=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
 if(!r.ok)throw new AccessError('Please verify your mobile number again.',401);
 const u=await r.json() as {id:string;phone?:string;phone_confirmed_at?:string};if(!u.phone_confirmed_at||!u.phone)throw new AccessError('Please verify your mobile number.',401);
 return u;
}
type AuthUser={id:string;email?:string;email_confirmed_at?:string;phone?:string;phone_confirmed_at?:string};
const verifiedUser=(u:AuthUser)=>!!((u.email&&u.email_confirmed_at)||(u.phone&&u.phone_confirmed_at));
async function organiserUser(request:Request,env:Env){
 const token=cookie(request);if(!token)throw new AccessError('Please sign in.',401);
 const r=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
 if(!r.ok)throw new AccessError('Please sign in again.',401);
 const u=await r.json() as AuthUser;if(!verifiedUser(u))throw new AccessError('Please verify your mobile number.',403);
 return {u,token};
}
function registrationProfile(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AccessError('Complete your registration details.',400);
 const p=value as Record<string,unknown>;
 if(!['18–24','25–34','35–44','45–54','55–64','65+'].includes(String(p.ageRange)))throw new AccessError('You must be 18 or over to register.',403);
 if(p.termsVersion!=='2026-09-27'||p.termsAccepted!==true)throw new AccessError('Please agree to the Terms of Service.',400);
 if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>80||!['Female','Male','Intersex','Prefer not to say'].includes(String(p.sex)))throw new AccessError('Please check your registration details.',400);
 return {name:p.name.trim(),sex:p.sex,ageRange:p.ageRange,termsVersion:p.termsVersion,termsAccepted:true};
}
export default {async scheduled(_controller:unknown,env:Env,ctx:{waitUntil:(p:Promise<unknown>)=>void}){ctx.waitUntil(Promise.all([processSms(env,(n,d)=>rpc(env,n,d)),processEmail(env,(n,d)=>rpc(env,n,d)),processReports(env,(n,d)=>rpc(env,n,d))]));},async fetch(request:Request,env:Env,ctx?:{waitUntil:(p:Promise<unknown>)=>void}):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(path==='/admin'||path==='/admin/')return Response.redirect(new URL('/signin',request.url).href,302);
 if(!path.startsWith('/api/')){
  const response=await env.ASSETS.fetch(request);
  if(env.REPORTS_ENABLED==='true'&&request.method==='GET'&&response.ok&&response.headers.get('content-type')?.includes('text/html')&&!/bot|crawler|spider|slurp|facebookexternalhit/i.test(request.headers.get('user-agent')||'')){
   const recorded=rpc(env,'prod_metric',{p_metric:'page_loads'}).catch(()=>console.error('Page-load metric could not be recorded'));
   if(ctx)ctx.waitUntil(recorded);else await recorded;
  }
  return response;
 }
 try{
  if(path==='/api/email/unsubscribe'){
   const url=new URL(request.url),job=url.searchParams.get('job')||'',sig=url.searchParams.get('sig')||'';
   if(!await validUnsubscribe(job,sig,env.SUPABASE_SECRET_KEY))throw new AccessError('Invalid unsubscribe link.',400);
   if(request.method!=='GET'&&request.method!=='POST')throw new AccessError('Method not allowed.',405);
   if(request.method==='POST'){
    const origin=request.headers.get('origin');if((origin&&origin!==url.origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new AccessError('Request origin does not match.',403);
    await rpc(env,'prod_email_unsubscribe',{p_job:job});
   }
   return new Response(unsubscribePage(request.method==='POST'),{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
  }
  const smsRpc=(n:string,d:Record<string,unknown>)=>rpc(env,n,d);
  if(path==='/api/sms/inbound'||path==='/api/sms/status')return await smsWebhook(request,env,smsRpc);
  if(path==='/api/phone/send-code'&&request.method==='POST'){
   const b=await body(request);const phone=normalPhone(b.phone);
   if(!request.headers.get('cookie')?.split(';').some(x=>x.trim()===ADULT_COOKIE+'=1'))throw new AccessError('Please confirm you are 18 or over.',403);
   await phoneRate(smsRpc,phone,request.headers.get('cf-connecting-ip')||'local');
   // Require an existing active invitation; generic response avoids disclosing membership.
   const lookup=await supa(env,'/rest/v1/dateeye_members?select=id,dateeye_events!inner(archived)&active=eq.true&dateeye_events.archived=eq.false&phone=eq.'+encodeURIComponent(phone)+(uuid(b.planId)?'&event_id=eq.'+b.planId:''),{},true);
   if(!lookup.ok)throw new AccessError('SMS lookup failed. Check migration 06.',502);
   const matches=await lookup.json() as unknown[];
   if(matches.length){const r=await supa(env,'/auth/v1/otp',{method:'POST',body:JSON.stringify({phone,create_user:true,channel:'sms'})});if(!r.ok)throw new AccessError(r.status===429?'Please wait before requesting another code.':'Could not send a text code. Check Supabase Phone provider settings.',r.status===429?429:502);}
   return json({ok:true});
  }
  if(path==='/api/phone/verify-code'&&request.method==='POST'){
   const b=await body(request);const phone=normalPhone(b.phone);
   if(!request.headers.get('cookie')?.split(';').some(x=>x.trim()===ADULT_COOKIE+'=1'))throw new AccessError('Please confirm you are 18 or over.',403);
   if(typeof b.code!=='string'||!/^\d{6,10}$/.test(b.code))throw new AccessError('Enter the code from your text.',400);
   await phoneRate(smsRpc,phone,request.headers.get('cf-connecting-ip')||'local',true);
   const r=await supa(env,'/auth/v1/verify',{method:'POST',body:JSON.stringify({phone,token:b.code,type:'sms'})});
   if(!r.ok)throw new AccessError('The text code is invalid or expired.',401);
   const d=await r.json() as {access_token:string;expires_in:number;user:{id:string;phone?:string;phone_confirmed_at?:string}};
   if(!d.user.phone_confirmed_at||normalPhone(d.user.phone? '+'+d.user.phone.replace(/^\+/,''):'')!==phone)throw new AccessError('Phone verification failed.',401);
   // Establish the verified session before optional preference/database work.
   // Preferences are saved via their authenticated endpoint after this cookie arrives.
   return json({ok:true},200,{'Set-Cookie':phoneCookie(request,d.access_token,Math.min(d.expires_in,3600))});
  }
  if(path==='/api/phone/invitations'&&request.method==='GET'){
   const u=await phoneUser(request,env);return json(await smsRpc('prod_phone_access',{p_user:u.id,p_method:'plans',p_body:{}}));
  }
  if(path==='/api/phone/preferences'&&request.method==='POST'){
   const b=await body(request);const u=await phoneUser(request,env);return json(await smsRpc('prod_phone_access',{p_user:u.id,p_method:'permissions',p_body:b}));
  }
  if(path==='/api/phone/logout'&&request.method==='POST'){
   await body(request);return json({ok:true},200,{'Set-Cookie':phoneCookie(request,'',0)});
  }
  if(path==='/api/invites/send'&&request.method==='POST'){
   const b=await body(request);if(!uuid(b.planId))throw new AccessError('Choose an event.',400);
   const token=cookie(request);if(!token)throw new AccessError('Please sign in as organiser.',401);
   const r=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new AccessError('Please sign in again.',401);
   const u=await r.json() as AuthUser;if(!verifiedUser(u))throw new AccessError('Organiser access required.',403);
   const sms=env.SMS_ENABLED==='true'&&!!env.TWILIO_ACCOUNT_SID&&!!env.TWILIO_AUTH_TOKEN&&!!env.TWILIO_MESSAGING_SERVICE_SID;
   return json(await smsRpc('prod_invites_queue',{p_user:u.id,p_plan:b.planId,p_sms:sms,p_email:emailConfigured(env)}));
  }
  if(path==='/api/guest/invitations'&&request.method==='POST'){
   const b=await body(request);
   if(!request.headers.get('cookie')?.split(';').some(x=>x.trim()===ADULT_COOKIE+'=1'))throw new AccessError('Please confirm you are 18 or over.',403);
   const contact=normalContact(b.contact);await contactRate(smsRpc,request.headers.get('cf-connecting-ip')||'local');
   return json(await smsRpc('prod_contact_access',{p_contact:contact,p_method:'plans',p_body:{}}));
  }
  if(path==='/api/sms/invite'&&request.method==='POST'){
   const b=await body(request);if(!uuid(b.planId))throw new AccessError('Choose an event.',400);
   if(env.SMS_ENABLED!=='true')throw new AccessError('SMS sending is not enabled yet.',503);
   const token=cookie(request);if(!token)throw new AccessError('Please sign in as organiser.',401);
   const r=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new AccessError('Please sign in again.',401);
   const u=await r.json() as AuthUser;if(!verifiedUser(u))throw new AccessError('Organiser access required.',403);
   return json(await smsRpc('prod_sms_queue',{p_user:u.id,p_plan:b.planId}));
  }
  if(path==='/api/age-confirm'&&request.method==='POST'){
   const b=await body(request);
   if(b.age!=='adult'||b.termsAccepted!==true)throw new AccessError('prod. is only for people aged 18 or over.',403);
   return json({ok:true},200,{'Set-Cookie':`${ADULT_COOKIE}=1; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=3600${new URL(request.url).protocol==='https:'?'; Secure':''}`});
  }
  if(path==='/api/invitations'&&request.method==='POST'){
   if(!request.headers.get('cookie')?.split(';').some(x=>x.trim()===ADULT_COOKIE+'=1'))throw new AccessError('Please confirm you are 18 or over.',403);
   const b=await body(request);const email=String(b.email||'').trim().toLowerCase();
   if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new AccessError('Please enter a valid email.',400);
   const r=await supa(env,'/rest/v1/rpc/prod_invitations',{method:'POST',body:JSON.stringify({p_email:email})},true);
   if(!r.ok)throw new AccessError('Could not find invitations. Please try again.',502);
   return json(await r.json());
  }
  if(path==='/api/organiser/send-code'&&request.method==='POST'){
   const b=await body(request),phone=normalPhone(b.phone);
   const profile=b.profile===undefined?undefined:registrationProfile(b.profile);
   await phoneRate(smsRpc,phone,request.headers.get('cf-connecting-ip')||'local');
   const r=await supa(env,'/auth/v1/otp',{method:'POST',body:JSON.stringify({phone,channel:'sms',create_user:!!profile,...(profile?{data:{prod_profile:profile}}:{})})});
   if(!r.ok){const d=await r.json() as {error_code?:string};
    if(d.error_code==='otp_disabled'&&!profile)return json({ok:true,phone}); // Do not disclose unregistered numbers.
    throw new AccessError(r.status===429?'Please wait before requesting another text.':'Could not send a text code. Please try again or contact support.',r.status===429?429:502);
   }
   return json({ok:true,phone});
  }
  if(path==='/api/organiser/verify-code'&&request.method==='POST'){
   const b=await body(request),phone=normalPhone(b.phone);
   if(typeof b.code!=='string'||!/^\d{6,10}$/.test(b.code))throw new AccessError('Enter the code from your text.',400);
   await phoneRate(smsRpc,phone,request.headers.get('cf-connecting-ip')||'local',true);
   const r=await supa(env,'/auth/v1/verify',{method:'POST',body:JSON.stringify({phone,token:b.code,type:'sms'})});
   if(!r.ok)throw new AccessError('The text code is invalid or expired. Request a new one.',401);
   const d=await r.json() as {access_token:string;expires_in:number;user:AuthUser};
   if(!d.access_token||!d.user.phone_confirmed_at||normalPhone('+'+(d.user.phone||'').replace(/^\+/,''))!==phone)throw new AccessError('Phone verification failed.',401);
   return json({ok:true},200,{'Set-Cookie':cookieValue(request,d.access_token,Math.min(d.expires_in,3600))});
  }
  if(path==='/api/organiser/link-phone'&&request.method==='POST'){
   const b=await body(request),phone=normalPhone(b.phone),{u,token}=await organiserUser(request,env);
   if(u.phone_confirmed_at)throw new AccessError('This account already has a verified mobile number. Sign in with that number.',409);
   if(!u.email_confirmed_at)throw new AccessError('Sign in to your existing email account first.',403);
   await phoneRate(smsRpc,phone,request.headers.get('cf-connecting-ip')||'local');
   const r=await supa(env,'/auth/v1/user',{method:'PUT',headers:{Authorization:'Bearer '+token},body:JSON.stringify({phone})});
   if(!r.ok)throw new AccessError(r.status===429?'Please wait before requesting another text.':'Could not add that number. It may already belong to another account; contact support if needed.',r.status===429?429:400);
   return json({ok:true,phone});
  }
  if(path==='/api/organiser/verify-link'&&request.method==='POST'){
   const b=await body(request),phone=normalPhone(b.phone),{u,token}=await organiserUser(request,env);
   if(!u.email_confirmed_at||u.phone_confirmed_at)throw new AccessError('Please sign in to the email account you want to switch.',403);
   if(typeof b.code!=='string'||!/^\d{6,10}$/.test(b.code))throw new AccessError('Enter the code from your text.',400);
   await phoneRate(smsRpc,phone,request.headers.get('cf-connecting-ip')||'local',true);
   const r=await supa(env,'/auth/v1/verify',{method:'POST',body:JSON.stringify({phone,token:b.code,type:'phone_change'})});
   if(!r.ok)throw new AccessError('The text code is invalid or expired. Request a new one.',401);
   // Keep the original identity and ownership; never adopt a different user returned by verification.
   const fresh=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
   if(!fresh.ok)throw new AccessError('Please sign in again to finish switching.',401);
   const linked=await fresh.json() as AuthUser;
   if(linked.id!==u.id||!linked.phone_confirmed_at||normalPhone('+'+(linked.phone||'').replace(/^\+/,''))!==phone)throw new AccessError('Could not confirm the number on this account. Contact support.',409);
   return json({ok:true});
  }
  if(path==='/api/send-code'&&request.method==='POST'){
   const b=await body(request),email=String(b.email||'').trim().toLowerCase();
   if(b.profile)registrationProfile(b.profile);
   if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new AccessError('Please enter a valid email.',400);
   await phoneRate(smsRpc,'email:'+email,request.headers.get('cf-connecting-ip')||'local');
   const r=await supa(env,'/auth/v1/otp',{method:'POST',body:JSON.stringify({email,create_user:false})});
   if(!r.ok){const d=await r.json() as {error_code?:string};if(d.error_code!=='otp_disabled')throw new AccessError(r.status===429?'Please wait before requesting another code.':'Could not send a code. Please try again.',r.status===429?429:502);}
   return json({ok:true});
  }
  if(path==='/api/confirmed'&&request.method==='POST'){
   const b=await body(request);
   if(typeof b.token!=='string'||b.token.length>12000)throw new AccessError('Confirmation link is invalid. Please sign in again.',401);
   const auth=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+b.token}});
   if(!auth.ok)throw new AccessError('Confirmation link expired. Please sign in again.',401);
   const u=await auth.json() as {id:string;email:string;email_confirmed_at?:string;user_metadata?:{prod_profile?:unknown}};
   if(!u.email_confirmed_at||!u.email)throw new AccessError('Please confirm your email first.',403);
   // Identity and destination come from Supabase, never the submitted email.
   const existing=await supa(env,'/rest/v1/rpc/prod_profile',{method:'POST',body:JSON.stringify({p_user:u.id,p_save:false,p_profile:{}})},true);
   if(!existing.ok)throw new AccessError('Could not load registration. Please retry.',502);
   const saved=await existing.json() as {profile:unknown};
   if(!saved.profile&&u.user_metadata?.prod_profile){
    const profile=await supa(env,'/rest/v1/rpc/prod_profile',{method:'POST',body:JSON.stringify({p_user:u.id,p_save:true,p_profile:u.user_metadata.prod_profile})},true);
    if(!profile.ok)throw new AccessError('Could not save registration details. Please retry.',502);
   }
   const sent=await supa(env,'/auth/v1/otp',{method:'POST',body:JSON.stringify({email:u.email,create_user:false})});
   if(!sent.ok)throw new AccessError(sent.status===429?'Your email is confirmed. Please wait a minute, then retry sending your code.':'Your email is confirmed, but the code could not be sent. Please retry.',sent.status===429?429:502);
   return json({ok:true,email:u.email});
  }
  if(path==='/api/verify-code'&&request.method==='POST'){
   const b=await body(request);
   if(typeof b.email!=='string'||typeof b.code!=='string'||!/^\d{6,10}$/.test(b.code))throw new AccessError('Enter the code from your email.',400);
   await phoneRate(smsRpc,'email:'+b.email.trim().toLowerCase(),request.headers.get('cf-connecting-ip')||'local',true);
   const r=await supa(env,'/auth/v1/verify',{method:'POST',body:JSON.stringify({email:b.email.trim().toLowerCase(),token:b.code,type:'email'})});
   if(!r.ok)throw new AccessError('The code is invalid or expired. Request a new one.',401);
   const data=await r.json() as {access_token:string;expires_in:number;user:AuthUser};
   if(data.user.phone_confirmed_at)throw new AccessError('This account already uses mobile sign-in. Please request a text code instead.',403);
   if(!data.user.email_confirmed_at)throw new AccessError('Please verify your mobile number.',403);
   return json({ok:true},200,{'Set-Cookie':cookieValue(request,data.access_token,Math.min(data.expires_in,3600))});
  }
  if(path==='/api/profile'&&['GET','POST'].includes(request.method)){
   const b=request.method==='POST'?await body(request):{};
   const token=cookie(request);if(!token)throw new AccessError('Please sign in.',401);
   const auth=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
   if(!auth.ok)throw new AccessError('Please sign in again.',401);
   const u=await auth.json() as AuthUser;
   if(!verifiedUser(u))throw new AccessError('Please verify your mobile number.',403);
   const r=await supa(env,'/rest/v1/rpc/prod_profile',{method:'POST',body:JSON.stringify({p_user:u.id,p_save:request.method==='POST',p_profile:b})},true);
   const data=await r.json() as {message?:string};
   if(!r.ok)throw new AccessError(r.status===400?'Please check your name, sex and age range.':'Registration could not be saved. Check the database upgrade.',400);
   return json(data);
  }
  if(path==='/api/accept-terms'&&request.method==='POST'){
   const b=await body(request);if(b.termsVersion!=='2026-09-27'||b.termsAccepted!==true)throw new AccessError('Please agree to the current Terms.',400);
   const token=cookie(request);if(!token)throw new AccessError('Please sign in.',401);
   const auth=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
   if(!auth.ok)throw new AccessError('Please sign in again.',401);
   const u=await auth.json() as AuthUser;if(!verifiedUser(u))throw new AccessError('Please verify your mobile number.',403);
   const r=await supa(env,'/rest/v1/rpc/prod_accept_terms',{method:'POST',body:JSON.stringify({p_user:u.id,p_version:b.termsVersion})},true);
   if(!r.ok)throw new AccessError('Could not record acceptance. Please contact support.',502);
   return json({ok:true});
  }
  if(path==='/api/delete-account'&&request.method==='POST'){
   const b=await body(request);if(b.confirm!=='DELETE')throw new AccessError('Type DELETE to confirm.',400);
   const token=cookie(request);if(!token)throw new AccessError('Please sign in.',401);
   const auth=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
   if(!auth.ok)throw new AccessError('Please sign in again.',401);
   const u=await auth.json() as AuthUser;if(!verifiedUser(u))throw new AccessError('Please verify your mobile number.',403);
   const purge=await supa(env,'/rest/v1/rpc/prod_delete_account',{method:'POST',body:JSON.stringify({p_user:u.id})},true);
   if(!purge.ok)throw new AccessError('Could not delete your plans. Please contact support.',502);
   const deleted=await supa(env,'/auth/v1/admin/users/'+encodeURIComponent(u.id),{method:'DELETE'},true);
   if(!deleted.ok&&deleted.status!==404)throw new AccessError('Your plans were removed, but account deletion needs support. Please contact us.',502);
   return json({ok:true},200,{'Set-Cookie':cookieValue(request,'',0)});
  }
  if(path==='/api/logout'&&request.method==='POST'){
   await body(request);const token=cookie(request);
   if(token){const r=await supa(env,'/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});if(!r.ok&&r.status!==401&&r.status!==403)throw new AccessError('Could not sign out. Please retry.',502);}
   return json({ok:true},200,{'Set-Cookie':cookieValue(request,'',0)});
  }
  if(path==='/api/login'&&request.method==='POST'){
   const b=await body(request);
   if(typeof b.email!=='string'||b.email.trim().toLowerCase()!==env.ADMIN_EMAIL.toLowerCase()||typeof b.password!=='string'||b.password.length>1024)throw new AccessError('Email or password is incorrect.',401);
   const r=await supa(env,'/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email:b.email.trim().toLowerCase(),password:b.password})});
   if(!r.ok)throw new AccessError(r.status===429?'Too many attempts. Please try again later.':'Email or password is incorrect.',r.status===429?429:401);
   const data=await r.json() as {access_token:string;expires_in:number;user:{id:string;email?:string;email_confirmed_at?:string}};
   if(!data.user.email_confirmed_at||data.user.email?.toLowerCase()!==env.ADMIN_EMAIL.toLowerCase())throw new AccessError('Administrator account is not confirmed.',403);
   const allowed=await supa(env,'/rest/v1/rpc/dateeye_state',{method:'POST',body:JSON.stringify({p_method:'GET',p_body:{view:'plans'},p_email:null,p_user:data.user.id})},true);
   if(!allowed.ok)throw new AccessError('Administrator access has not been granted. Complete setup step 3.',403);
   return json({ok:true},200,{'Set-Cookie':cookieValue(request,data.access_token,Math.min(data.expires_in,3600))});
  }
  if(path!=='/api/state')return json({error:'Not found.'},404);
  if(!['GET','POST','PUT','PATCH'].includes(request.method))return json({error:'Method not allowed.'},405);
  const b:Record<string,unknown>=request.method==='GET'?{}:await body(request);
  const url=new URL(request.url);
  b.planId=url.searchParams.get('plan')||null;
  b.view=url.searchParams.get('view')||null;
  if(b.planId && b.planId!=='new' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.planId)))throw new AccessError('Invalid plan link.',400);
  if(request.headers.has('x-prod-contact')){
   if(!['GET','PUT'].includes(request.method)||!uuid(b.planId))throw new AccessError('Invitee access is for responding to an event.',403);
   if(!request.headers.get('cookie')?.split(';').some(x=>x.trim()===ADULT_COOKIE+'=1'))throw new AccessError('Please confirm you are 18 or over.',403);
   const contact=normalContact(request.headers.get('x-prod-contact'));
   await contactRate(smsRpc,request.headers.get('cf-connecting-ip')||'local');
   if(request.method==='PUT'&&(!validDate(b.date)||typeof b.available!=='boolean'))throw new AccessError('Invalid availability.',400);
   return json(await smsRpc('prod_contact_access',{p_contact:contact,p_method:request.method,p_body:b}));
  }
  if(request.headers.get('x-prod-phone-session')==='1'){
   if(!['GET','PUT'].includes(request.method)||!uuid(b.planId))throw new AccessError('Phone access is for responding to an invitation.',403);
   if(request.method==='PUT'&&(!validDate(b.date)||typeof b.available!=='boolean'))throw new AccessError('Invalid availability.',400);
   const u=await phoneUser(request,env);return json(await smsRpc('prod_phone_access',{p_user:u.id,p_method:request.method,p_body:b}));
  }
  if(request.method==='PATCH'&&b.action==='member'&&b.phone!==undefined)b.phone=b.phone?normalPhone(b.phone):null;
  const entry=request.headers.get('x-dateeye-email');let email:string|null=null,user:string|null=null;
  if(entry!==null){
   if(!request.headers.get('cookie')?.split(';').some(x=>x.trim()===ADULT_COOKIE+'=1'))throw new AccessError('Please confirm you are 18 or over.',403);
   email=entry.trim().toLowerCase();if(!email||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new AccessError('Please enter a valid email.',400);
   // Invitee entry takes precedence over any admin cookie, even for the admin email.
  }else{
   const token=cookie(request);if(!token)throw new AccessError('Please sign in with your mobile number.',401);
   const r=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
   if(!r.ok)throw new AccessError('Your session has expired. Please sign in again.',401);
   const u=await r.json() as AuthUser;
   if(!verifiedUser(u))throw new AccessError('Administrator access required.');
   user=u.id;
  }
  if(request.method==='POST'||(request.method==='PATCH'&&b.action==='event'))validateEvent(b.name,b.startDate,b.endDate);
  if(request.method==='PATCH'&&b.action==='member')validateMember(b.name,b.email);
  if(request.method==='PUT'&&(!validDate(b.date)||typeof b.available!=='boolean'))throw new AccessError('Invalid availability.',400);
  const r=await supa(env,'/rest/v1/rpc/dateeye_state',{method:'POST',body:JSON.stringify({p_method:request.method,p_body:b,p_email:email,p_user:user})},true);
  const result=await r.json() as {code?:string;message?:string};
  if(!r.ok){
   if(result.code==='P0001')throw new AccessError(result.message||'Request refused.',400);
   if(result.code==='42501')throw new AccessError('Email not invited, member removed, or action not permitted.',403);
   if(result.code==='23505')throw new AccessError('That email or plan already exists.',409);
   throw new AccessError('Database request failed. Check that the setup SQL has been run.',502);
  }
  return json(result,request.method==='POST'?201:200);
 }catch(e){if(env.REPORTS_ENABLED==='true'&&(!(e instanceof AccessError)||e.status>=500)){const recorded=rpc(env,'prod_metric',{p_metric:'api_errors'}).catch(()=>console.error('Error metric could not be recorded'));if(ctx)ctx.waitUntil(recorded);else await recorded;}return json({error:e instanceof AccessError?e.message:'Service temporarily unavailable. Please retry.'},e instanceof AccessError?e.status:503);}
}};




