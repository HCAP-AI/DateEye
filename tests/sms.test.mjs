import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalPhone,phoneRate,processSms,validTwilio} from '../worker/sms.ts';
import worker from '../worker/index.ts';
const owner='11111111-1111-4111-8111-111111111111',guest='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',phone='+447700900123';
test('UK number normalisation rejects foreign and malformed input',()=>{for(const v of ['07700 900123','+44 7700 900123','00447700900123'])assert.equal(normalPhone(v),phone);for(const v of ['+12025550123','abc','447700900123',null])assert.throws(()=>normalPhone(v));});
test('SMS SQL: preservation, isolation, consent, deduplication, reminders, STOP, archives and daily cap',async()=>{
 const db=new PGlite();
 const sql=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const state=(method,body,email=null,user=owner)=>sql('dateeye_state',[method,JSON.stringify(body),email,user]);
 const access=(method,body={},user=guest)=>sql('prod_phone_access',[user,method,JSON.stringify(body)]);
 try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);grant usage on schema public to service_role;');
 await db.exec(await readFile(new URL('../supabase/01_schema.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,$2,now(),null,null),($3,null,null,$4,now()),($5,null,null,$6,null)',[owner,'office@hound-capital.com',guest,phone.slice(1),other,'447700900124']);
 for(const file of ['02_grant_admin.sql','03_multi_plan.sql','04_prod_registration.sql','05_compliance.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 await db.exec('set role service_role');
 await sql('prod_profile',[owner,true,JSON.stringify({name:'Oliver',sex:'Male',ageRange:'35–44',termsVersion:'2026-09-27',termsAccepted:true})]);
 const plan=(await state('POST',{planId:'new',name:'Sailing',startDate:'2099-10-01',endDate:'2099-10-31',members:['Henry','Poppy']})).planId;
 const before=await state('GET',{planId:plan});const m=before.members[0];
 await state('PATCH',{planId:plan,action:'member',id:m.id,name:m.name,email:'henry@example.com',active:true});
 await state('PUT',{planId:plan,memberId:m.id,date:'2099-10-02',available:true},'henry@example.com');
 await db.exec('reset role');const migration=await readFile(new URL('../supabase/06_sms.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);await db.exec('set role service_role');
 assert.equal((await state('GET',{planId:plan})).availability.length,1);
 await state('PATCH',{planId:plan,action:'member',id:m.id,name:m.name,email:'henry@example.com',phone,notification:'sms',active:true});
 assert.equal((await state('GET',{planId:plan})).managedMembers[0].phone,phone);
 await assert.rejects(()=>state('GET',{planId:plan},'henry@example.com'));
 assert.equal((await access('GET',{planId:plan})).viewer.isAdmin,false);
 await assert.rejects(()=>access('GET',{planId:plan},other));
 await assert.rejects(()=>access('PATCH',{planId:plan}));
 await assert.rejects(()=>access('PUT',{planId:plan,memberId:before.members[1].id,date:'2099-10-03',available:false}));
 await db.query('delete from public.dateeye_availability where member_id=$1',[m.id]);
 assert.equal((await sql('prod_sms_queue',[owner,plan])).needsPermission,1);
 await access('permissions',{allowed:true});
 assert.equal((await sql('prod_sms_queue',[owner,plan])).queued,1);
 assert.equal((await sql('prod_sms_queue',[owner,plan])).queued,0);
 await assert.rejects(()=>sql('prod_sms_queue',[guest,plan]));
 const job=await sql('prod_sms_claim',[50]);assert.equal(job.phone,phone);assert.equal(job.kind,'invite');
 assert.equal(await sql('prod_sms_claim',[50]),null);
 await sql('prod_sms_result',[job.id,'accepted','SM'+'a'.repeat(32),null]);
 const reminder=(await db.query("select *, extract(epoch from (due_at-(select accepted_at from public.prod_sms_jobs where id=$1)))::int delay from public.prod_sms_jobs where kind='reminder'",[job.id])).rows[0];
 assert.equal(reminder.delay,86400);assert.equal(await sql('prod_sms_claim',[50]),null);
 await db.query("update public.prod_sms_jobs set due_at=now()-interval '1 second' where id=$1",[reminder.id]);
 assert.equal(await sql('prod_sms_claim',[1]),null); // invitation already consumed daily cap
 await access('PUT',{planId:plan,memberId:m.id,date:'2099-10-03',available:false});
 assert.equal((await db.query('select status from public.prod_sms_jobs where id=$1',[reminder.id])).rows[0].status,'cancelled');
 assert.equal(await sql('prod_sms_claim',[50]),null);
 const second=(await state('POST',{planId:'new',name:'Second',startDate:'2099-10-01',endDate:'2099-10-31',members:['Henry','Poppy']})).planId;
 const m2=(await state('GET',{planId:second})).members[0];
 await state('PATCH',{planId:second,action:'member',id:m2.id,name:m2.name,phone,notification:'sms',active:true});
 assert.equal((await access('plans')).plans.length,2);
 assert.equal((await access('GET',{planId:second})).availability.length,0);
 await sql('prod_sms_queue',[owner,second]);await sql('prod_sms_inbound',[phone,true]);assert.equal(await sql('prod_sms_claim',[50]),null);
 await access('permissions',{allowed:true}); // website cannot override STOP
 assert.equal((await sql('prod_sms_queue',[owner,second])).needsPermission,1);
 await sql('prod_sms_inbound',[phone,false]);
 // Already cancelled jobs are not automatically resent after START.
 const third=(await state('POST',{planId:'new',name:'Third',startDate:'2099-10-01',endDate:'2099-10-31',members:['Henry','Poppy']})).planId;
 const m3=(await state('GET',{planId:third})).members[0];
 await state('PATCH',{planId:third,action:'member',id:m3.id,name:m3.name,phone,notification:'sms',active:true});await sql('prod_sms_queue',[owner,third]);
 await state('PATCH',{planId:third,action:'archive',archived:true});assert.equal(await sql('prod_sms_claim',[50]),null);
 await assert.rejects(()=>access('GET',{planId:third}));
 await db.exec('reset role;set role anon;');await assert.rejects(()=>access('plans'));await assert.rejects(()=>sql('prod_sms_claim',[50]));
 }finally{await db.close();}
});
test('Twilio webhook signatures depend on all form fields and exact URL',async()=>{
 const auth='test-token',url='https://prod.test/api/sms/inbound';const params=new URLSearchParams({From:phone,Body:'STOP',AccountSid:'AC'+'a'.repeat(32)});
 let text=url;for(const key of [...params.keys()].sort())text+=key+params.get(key);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(auth),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)))));
 const env={SMS_PUBLIC_ORIGIN:'https://prod.test',TWILIO_AUTH_TOKEN:auth};const r=new Request(url,{headers:{'x-twilio-signature':signature}});
 assert.equal(await validTwilio(r,env,params),true);params.set('Body','START');assert.equal(await validTwilio(r,env,params),false);assert.equal(await validTwilio(new Request(url),env,params),false);
});
test('phone session uses verified identity; spoofed phone and organiser access are rejected',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_SECRET_KEY:'test',ASSETS:{fetch:async()=>new Response('asset')}};
 const old=globalThis.fetch;let seen=[];globalThis.fetch=async(url,init)=>{seen.push({url,init});return String(url).endsWith('/user')?Response.json({id:guest,phone:phone.slice(1),phone_confirmed_at:'2026-10-02'}):Response.json({viewer:{isAdmin:false}});};
 try{
 const headers={'x-prod-phone-session':'1',cookie:'prod_phone_session=verified','content-type':'application/json'};
 const url='https://prod.test/api/state?plan='+owner;
 const r=await worker.fetch(new Request(url,{headers}),env);assert.equal(r.status,200);assert.equal(JSON.parse(seen[1].init.body).p_user,guest);
 assert.equal((await worker.fetch(new Request(url,{method:'PATCH',headers,body:'{}'}),env)).status,403);
 assert.equal((await worker.fetch(new Request(url,{headers:{'x-prod-phone-session':'1','x-prod-phone':phone}}),env)).status,401);
 }finally{globalThis.fetch=old;}
});
test('uncertain Twilio request is recorded without retry and SMS disabled sends nothing',async()=>{
 const env={SMS_ENABLED:'true',TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'test',TWILIO_MESSAGING_SERVICE_SID:'MG'+'b'.repeat(32),SMS_PUBLIC_ORIGIN:'https://prod.test'};
 let calls=[],claims=0,sends=0;const rpc=async(n,d)=>{calls.push({n,d});return n==='prod_sms_claim'&&claims++===0?{id:owner,phone,planId:guest,eventName:'Test',organiser:'Oliver',kind:'invite'}:null;};
 const old=globalThis.fetch;globalThis.fetch=async()=>{sends++;throw Error('timeout');};
 try{await processSms({...env,SMS_ENABLED:'false'},rpc);assert.equal(claims,0);await processSms(env,rpc);assert.equal(sends,1);assert.equal(calls.find(c=>c.n==='prod_sms_result').d.p_status,'unknown');}finally{globalThis.fetch=old;}
});
test('rate-limit refusal stops phone code requests before an OTP is sent',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_SECRET_KEY:'test',ASSETS:{fetch:async()=>new Response('asset')}};
 const old=globalThis.fetch;let urls=[];globalThis.fetch=async(url)=>{urls.push(String(url));return Response.json(false);};
 try{const r=await worker.fetch(new Request('https://prod.test/api/phone/send-code',{method:'POST',headers:{'Content-Type':'application/json',cookie:'prod_adult=1'},body:JSON.stringify({phone})}),env);assert.equal(r.status,429);assert.equal(urls.length,1);assert.ok(urls[0].includes('prod_sms_rate'));}finally{globalThis.fetch=old;}
});
test('phone verification commits its session before optional preference work',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_SECRET_KEY:'test',ASSETS:{fetch:async()=>new Response('asset')}};
 const old=globalThis.fetch;let permission;
 globalThis.fetch=async(url,init)=>{if(String(url).includes('prod_sms_rate'))return Response.json(true);if(String(url).endsWith('/verify')){assert.equal(JSON.parse(init.body).type,'sms');return Response.json({access_token:'phone-token',expires_in:3600,user:{id:guest,phone:phone.slice(1),phone_confirmed_at:'2026-10-02'}});}permission=JSON.parse(init.body);return Response.json({ok:true});};
 try{const r=await worker.fetch(new Request('https://prod.test/api/phone/verify-code',{method:'POST',headers:{'Content-Type':'application/json',cookie:'prod_adult=1'},body:JSON.stringify({phone,code:'123456',smsAllowed:true,userId:owner})}),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/prod_phone_session=phone-token.*HttpOnly.*SameSite=Strict.*Secure/);assert.deepEqual(await r.json(),{ok:true});assert.equal(permission,undefined);}finally{globalThis.fetch=old;}
});
