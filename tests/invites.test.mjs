import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalContact,processEmail} from '../worker/invites.ts';
import worker from '../worker/index.ts';
const owner='11111111-1111-4111-8111-111111111111', outsider='22222222-2222-4222-8222-222222222222', phone='+447700900123';
test('contact-only access and combined invitations preserve event boundaries and delivery rules',async()=>{
 const db=new PGlite();
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const state=(method,b)=>rpc('dateeye_state',[method,JSON.stringify(b),null,owner]);
 const access=(contact,method,b={})=>rpc('prod_contact_access',[contact,method,JSON.stringify(b)]);
 try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);grant usage on schema public to service_role;');
 await db.exec(await readFile(new URL('../supabase/01_schema.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[owner,'office@hound-capital.com']);
 for(const file of ['02_grant_admin.sql','03_multi_plan.sql','04_prod_registration.sql','05_compliance.sql','06_sms.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 await db.exec('set role service_role');
 await rpc('prod_profile',[owner,true,JSON.stringify({name:'Oliver',sex:'Male',ageRange:'35–44',termsVersion:'2026-09-27',termsAccepted:true})]);
 const plan=(await state('POST',{planId:'new',name:'Weekend',startDate:'2099-10-01',endDate:'2099-10-31',members:['Both','Email','Phone','Removed']})).planId;
 const members=(await state('GET',{planId:plan})).members;
 for(const m of members)await state('PATCH',{planId:plan,action:'member',id:m.id,name:m.name,email:['Both','Email'].includes(m.name)?m.name.toLowerCase()+'@example.com':'',phone:m.name==='Both'?phone:m.name==='Phone'?'+447700900124':null,notification:m.name==='Phone'?'sms':'email',active:m.name!=='Removed'});
 const both=members.find(m=>m.name==='Both'), email=members.find(m=>m.name==='Email');
 await db.query('insert into public.dateeye_availability values($1,$2,true)',[both.id,'2099-10-02']);
 await db.exec('reset role');const migration=await readFile(new URL('../supabase/07_simple_invites.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);await db.exec('set role service_role');
 for(const contact of [phone,'both@example.com']){const v=await access(contact,'GET',{planId:plan});assert.equal(v.viewer.memberId,both.id);assert.equal(v.viewer.isAdmin,false);assert.equal(v.availability.length,1);assert.equal(v.managedMembers,undefined);}
 assert.equal((await access('+447700900124','GET',{planId:plan})).viewer.isAdmin,false);
 await assert.rejects(()=>access('unknown@example.com','GET',{planId:plan}));
 await assert.rejects(()=>access(phone,'GET',{planId:outsider}));
 await assert.rejects(()=>access(phone,'PATCH',{planId:plan,action:'event'}));
 await assert.rejects(()=>access(phone,'PUT',{planId:plan,memberId:email.id,date:'2099-10-03',available:true}));
 await assert.rejects(()=>access(phone,'PUT',{planId:plan,memberId:both.id,date:'2099-12-03',available:true}));
 await access(phone,'PUT',{planId:plan,memberId:both.id,date:'2099-10-03',available:false});
 assert.equal((await access('both@example.com','GET',{planId:plan})).availability.length,2);
 assert.equal((await access('BOTH@example.com','plans')).plans.length,1);
 await assert.rejects(()=>rpc('prod_invites_queue',[outsider,plan,true,true]));
 const queued=await rpc('prod_invites_queue',[owner,plan,true,true]);assert.equal(queued.smsQueued,2);assert.equal(queued.emailQueued,2);
 const repeated=await rpc('prod_invites_queue',[owner,plan,true,true]);assert.equal(repeated.smsQueued,0);assert.equal(repeated.emailQueued,0);
 const unavailable=await rpc('prod_invites_queue',[owner,plan,false,false]);assert.equal(unavailable.smsUnavailable,2);assert.equal(unavailable.emailUnavailable,2);
 await rpc('prod_sms_inbound',['+447700900124',true]);
 const sj=await rpc('prod_sms_claim',[50]);assert.equal(sj.phone,phone);assert.equal(await rpc('prod_sms_claim',[50]),null);
 await rpc('prod_sms_result',[sj.id,'accepted','SM'+'a'.repeat(32),null]);
 assert.equal((await db.query("select count(*)::int n from public.prod_sms_jobs where kind='reminder'")).rows[0].n,0);
 const ej=await rpc('prod_email_claim',[50]);assert.ok(ej.email);await rpc('prod_email_result',[ej.id,'accepted',null]);assert.equal(await rpc('prod_email_claim',[1]),null);
 await state('PATCH',{planId:plan,action:'archive',archived:true});assert.equal(await rpc('prod_email_claim',[50]),null);
 await assert.rejects(()=>access(phone,'GET',{planId:plan}));
 await assert.rejects(()=>rpc('prod_invites_queue',[owner,plan,true,true]));
 await db.exec('reset role;set role anon;');await assert.rejects(()=>access(phone,'plans'));await assert.rejects(()=>rpc('prod_email_claim',[50]));
 }finally{await db.close();}
});
test('guest route normalises either contact, takes precedence over admin, and cannot mutate settings',async()=>{
 assert.equal(normalContact('07700 900123'),phone);assert.equal(normalContact(' BOTH@Example.com '),'both@example.com');
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test',SUPABASE_SECRET_KEY:'test'};
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(String(url).includes('prod_sms_rate')?true:{viewer:{isAdmin:false}});};
 try{
 const url='https://prod.test/api/state?plan='+owner,headers={'x-prod-contact':'07700 900123',cookie:'prod_adult=1; prod_session=organiser','Content-Type':'application/json'};
 assert.equal((await worker.fetch(new Request(url,{headers}),env)).status,200);
 assert.equal(calls.at(-1).body.p_contact,phone);assert.ok(calls.every(c=>!String(c.url).includes('/auth/')));
 assert.equal((await worker.fetch(new Request(url,{method:'PATCH',headers,body:'{}'}),env)).status,403);
 assert.equal((await worker.fetch(new Request(url,{headers:{'x-prod-contact':phone}}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://prod.test/api/invites/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({planId:owner})}),env)).status,401);
 }finally{globalThis.fetch=old;}
});
test('email sending uses individual recipients and treats acceptance and uncertain failure correctly',async()=>{
 const env={EMAIL_ENABLED:'true',SENDGRID_API_KEY:'test',EMAIL_FROM:'invites@prod.test',SMS_PUBLIC_ORIGIN:'https://prod.test'};
 const old=globalThis.fetch;let sends=0,claims=0;const results=[];
 const rpc=async(n,d)=>n==='prod_email_claim'?(claims++===0?{id:owner,email:'guest@example.com',planId:outsider,eventName:'Weekend',organiser:'Oliver'}:null):results.push(d);
 try{
 globalThis.fetch=async(url,init)=>{sends++;assert.equal(url,'https://api.sendgrid.com/v3/mail/send');const b=JSON.parse(init.body);assert.equal(b.personalizations[0].to.length,1);assert.match(b.content[0].value,/No verification code/);return new Response(null,{status:202});};
 await processEmail({...env,EMAIL_ENABLED:'false'},rpc);assert.equal(claims,0);
 await processEmail(env,rpc);assert.equal(sends,1);assert.equal(results[0].p_status,'accepted');
 claims=0;globalThis.fetch=async()=>{sends++;throw Error('timeout');};await processEmail(env,rpc);assert.equal(sends,2);assert.equal(results[1].p_status,'unknown');
 }finally{globalThis.fetch=old;}
});
