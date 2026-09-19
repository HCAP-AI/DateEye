import {AccessError, validateEvent, validateMember, validDate} from './permissions.ts';
export interface Env {
 SUPABASE_URL:string; SUPABASE_PUBLISHABLE_KEY:string; SUPABASE_SECRET_KEY:string; ADMIN_EMAIL:string;
 ASSETS:{fetch:(r:Request)=>Promise<Response>};
}
const COOKIE='dateeye_admin';
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
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/'))return env.ASSETS.fetch(request);
 try{
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
   const allowed=await supa(env,'/rest/v1/rpc/dateeye_state',{method:'POST',body:JSON.stringify({p_method:'GET',p_body:{},p_email:null,p_user:data.user.id})},true);
   if(!allowed.ok)throw new AccessError('Administrator access has not been granted. Complete setup step 3.',403);
   return json({ok:true},200,{'Set-Cookie':cookieValue(request,data.access_token,Math.min(data.expires_in,3600))});
  }
  if(path!=='/api/state')return json({error:'Not found.'},404);
  if(!['GET','POST','PUT','PATCH'].includes(request.method))return json({error:'Method not allowed.'},405);
  const b=request.method==='GET'?{}:await body(request);
  const entry=request.headers.get('x-dateeye-email');let email:string|null=null,user:string|null=null;
  if(entry!==null){
   email=entry.trim().toLowerCase();if(!email||email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))throw new AccessError('Please enter a valid email.',400);
   // Invitee entry takes precedence over any admin cookie, even for the admin email.
  }else{
   const token=cookie(request);if(!token)throw new AccessError('Please enter your email address.',401);
   const r=await supa(env,'/auth/v1/user',{headers:{Authorization:'Bearer '+token}});
   if(!r.ok)throw new AccessError('Your session has expired. Please sign in again.',401);
   const u=await r.json() as {id:string;email?:string;email_confirmed_at?:string};
   if(!u.email_confirmed_at||u.email?.toLowerCase()!==env.ADMIN_EMAIL.toLowerCase())throw new AccessError('Administrator access required.');
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
 }catch(e){return json({error:e instanceof AccessError?e.message:'Service temporarily unavailable. Please retry.'},e instanceof AccessError?e.status:503);}
}};
