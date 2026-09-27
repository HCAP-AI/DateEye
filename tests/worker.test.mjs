import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'publishable-test',SUPABASE_SECRET_KEY:'server-test',ADMIN_EMAIL:'office@hound-capital.com',ASSETS:{fetch:async()=>new Response('asset')}};
const req=(path='/api/state',opts={})=>new Request('https://dateeye.test'+path,opts);
test('anonymous state is denied without contacting database',async()=>{assert.equal((await worker.fetch(req(),env)).status,401);});
test('spoofed Sites identity headers do not grant administrator access',async()=>{assert.equal((await worker.fetch(req('/api/state',{headers:{'oai-authenticated-user-email':env.ADMIN_EMAIL,'oai-authenticated-user-id':'owner'}}),env)).status,401);});
test('cross-origin writes are rejected',async()=>{assert.equal((await worker.fetch(req('/api/state',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}),env)).status,403);});
test('oversize bodies are rejected',async()=>{assert.equal((await worker.fetch(req('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'a'.repeat(20000)})}),env)).status,413);});
test('admin email entered as invitee never becomes admin',async()=>{
 const old=globalThis.fetch;let payload;
 globalThis.fetch=async(url,init)=>{assert.ok(String(url).endsWith('/rpc/dateeye_state'));payload=JSON.parse(init.body);return Response.json({viewer:{isAdmin:false}});};
 try{const r=await worker.fetch(req('/api/state',{headers:{'x-dateeye-email':env.ADMIN_EMAIL,cookie:'prod_session=valid-looking; prod_adult=1'}}),env);assert.equal(r.status,200);assert.equal(payload.p_user,null);assert.equal(payload.p_email,env.ADMIN_EMAIL);}finally{globalThis.fetch=old;}
});
test('expired session fails closed',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:401});try{assert.equal((await worker.fetch(req('/api/state',{headers:{cookie:'prod_session=expired'}}),env)).status,401);}finally{globalThis.fetch=old;}});
test('successful login returns HttpOnly secure cookie, never token JSON',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async(url)=>String(url).includes('/token?')?Response.json({access_token:'test-jwt',expires_in:3600,user:{id:'admin-id',email:env.ADMIN_EMAIL,email_confirmed_at:'2026-01-01'}}):Response.json({viewer:{isAdmin:true}});
 try{const r=await worker.fetch(req('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.ADMIN_EMAIL,password:'test-only-password'})}),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=3600; Secure/);assert.deepEqual(await r.json(),{ok:true});}finally{globalThis.fetch=old;}
});
test('signout clears cookie',async()=>{const r=await worker.fetch(req('/api/logout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);});
test('plan from URL is forwarded and cannot be overridden by request body',async()=>{
 const old=globalThis.fetch;let payload;const id='33333333-3333-4333-8333-333333333333';
 globalThis.fetch=async(url,init)=>{payload=JSON.parse(init.body);return Response.json({ok:true});};
 try{const r=await worker.fetch(req('/api/state?plan='+id,{method:'PUT',headers:{'x-dateeye-email':'person@example.com',cookie:'prod_adult=1','content-type':'application/json'},body:JSON.stringify({planId:'attacker-plan',memberId:'member',date:'2026-10-01',available:true})}),env);assert.equal(r.status,200);assert.equal(payload.p_body.planId,id);assert.equal(payload.p_user,null);}finally{globalThis.fetch=old;}
});

test('underage organiser registration and guest access fail before contacting Supabase',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Unexpected backend request');};
 try{
  const r=await worker.fetch(req('/api/send-code',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'child@example.com',profile:{ageRange:'Under 18',termsVersion:'2026-09-27',termsAccepted:true}})}),env);
  assert.equal(r.status,403);
  const guest=await worker.fetch(req('/api/invitations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'child@example.com'})}),env);
  assert.equal(guest.status,403);
 }finally{globalThis.fetch=old;}
});
test('adult invitee declaration sets a necessary cookie',async()=>{
 const r=await worker.fetch(req('/api/age-confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({age:'adult',termsAccepted:true})}),env);
 assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/prod_adult=1.*HttpOnly.*SameSite=Strict.*Secure/);
});
