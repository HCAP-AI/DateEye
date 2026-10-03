import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import worker from '../worker/index.ts';
const owner='11111111-1111-4111-8111-111111111111',mobile='22222222-2222-4222-8222-222222222222',unverified='33333333-3333-4333-8333-333333333333';
const profile={name:'Organiser',sex:'Prefer not to say',ageRange:'35–44',termsVersion:'2026-09-27',termsAccepted:true};
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-public',SUPABASE_SECRET_KEY:'test-secret',ASSETS:{fetch:async()=>new Response('asset')}};
const request=(path,data,session='')=>new Request('https://prod.test'+path,{method:'POST',headers:{'content-type':'application/json',...(session?{cookie:'prod_session='+session}:{})},body:JSON.stringify(data)});
test('phone registration requires adult details and uses SMS; login never creates accounts',async()=>{
 const old=globalThis.fetch;let sent=[];
 globalThis.fetch=async(url,init)=>{if(String(url).includes('/rpc/prod_sms_rate'))return Response.json(true);sent.push(JSON.parse(init.body));return Response.json({});};
 try{
  assert.equal((await worker.fetch(request('/api/organiser/send-code',{phone:'07700 900123',profile:{...profile,ageRange:'Under 18'}}),env)).status,403);assert.equal(sent.length,0);
  assert.equal((await worker.fetch(request('/api/organiser/send-code',{phone:'07700 900123',profile}),env)).status,200);
  assert.equal(sent[0].phone,'+447700900123');assert.equal(sent[0].channel,'sms');assert.equal(sent[0].create_user,true);
  await worker.fetch(request('/api/organiser/send-code',{phone:'07700 900123'}),env);assert.equal(sent[1].create_user,false);
  await worker.fetch(request('/api/send-code',{email:'old@example.com'}),env);assert.equal(sent[2].create_user,false);
 }finally{globalThis.fetch=old;}
});
test('SMS verification fails closed for wrong identity and protects organiser cookie',async()=>{
 const old=globalThis.fetch;let confirmed=true,number='447700900123';
 globalThis.fetch=async(url)=>String(url).includes('/rpc/')?Response.json(true):Response.json({access_token:'test-jwt',expires_in:3600,user:{id:mobile,phone:number,phone_confirmed_at:confirmed?'2026-10-03':null}});
 try{
  let r=await worker.fetch(request('/api/organiser/verify-code',{phone:'07700900123',code:'123456'}),env);assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/^prod_session=test-jwt;.*HttpOnly; SameSite=Strict;.*Secure/);assert.deepEqual(await r.json(),{ok:true});
  confirmed=false;r=await worker.fetch(request('/api/organiser/verify-code',{phone:'07700900123',code:'123456'}),env);assert.equal(r.status,401);assert.equal(r.headers.get('set-cookie'),null);
  confirmed=true;number='447700900124';r=await worker.fetch(request('/api/organiser/verify-code',{phone:'07700900123',code:'123456'}),env);assert.equal(r.status,401);
 }finally{globalThis.fetch=old;}
});
test('link verification never adopts another user or accepts an unlinked original account',async()=>{
 const old=globalThis.fetch;let userCalls=0,linked=false;
 globalThis.fetch=async(url)=>{
  if(String(url).includes('/rpc/'))return Response.json(true);
  if(String(url).endsWith('/verify'))return Response.json({access_token:'wrong-user-token',user:{id:mobile}});
  userCalls++;return Response.json({id:owner,email:'old@example.com',email_confirmed_at:'2026-01-01',...(userCalls>1&&linked?{phone:'447700900123',phone_confirmed_at:'2026-10-03'}:{})});
 };
 try{
  let r=await worker.fetch(request('/api/organiser/verify-link',{phone:'07700900123',code:'123456'},'original-session'),env);assert.equal(r.status,409);assert.equal(r.headers.get('set-cookie'),null);
  userCalls=0;linked=true;r=await worker.fetch(request('/api/organiser/verify-link',{phone:'07700900123',code:'123456'},'original-session'),env);assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);
 }finally{globalThis.fetch=old;}
});
test('phone-only organiser can manage own plans, respond, invite, accept terms and delete; old owners preserved',async()=>{
 const db=new PGlite();
 const rpc=async(name,args)=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 const state=(method,body,user=mobile)=>rpc('dateeye_state',[method,JSON.stringify(body),null,user]);
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);grant usage on schema public to service_role;');
  await db.exec(await readFile(new URL('../supabase/01_schema.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1,$2,now(),null,null),($3,null,null,$4,now()),($5,null,null,$6,null)',[owner,'office@hound-capital.com',mobile,'447700900123',unverified,'447700900124']);
  for(const f of ['02_grant_admin.sql','03_multi_plan.sql','04_prod_registration.sql','05_compliance.sql','06_sms.sql','07_simple_invites.sql','08_daily_reporting.sql'])await db.exec(await readFile(new URL('../supabase/'+f,import.meta.url),'utf8'));
  await db.exec('set role service_role');
  await rpc('prod_profile',[owner,true,JSON.stringify(profile)]);
  const oldPlan=(await state('POST',{planId:'new',name:'Existing',startDate:'2099-10-01',endDate:'2099-10-02',members:['A','B']},owner)).planId;
  await db.exec('reset role');const migration=await readFile(new URL('../supabase/09_phone_organisers.sql',import.meta.url),'utf8');await db.exec(migration);await db.exec(migration);await db.exec('set role service_role');
  await assert.rejects(()=>rpc('prod_profile',[unverified,true,JSON.stringify(profile)]));
  await assert.rejects(()=>rpc('prod_profile',[mobile,true,JSON.stringify({...profile,termsAccepted:false})]));
  const info=await rpc('prod_profile',[mobile,true,JSON.stringify(profile)]);assert.equal(info.phone,'+447700900123');assert.equal(info.email,null);
  const plan=(await state('POST',{planId:'new',name:'Phone event',startDate:'2099-10-01',endDate:'2099-10-02',members:['Me','Friend']})).planId;
  let current=await state('GET',{planId:plan});let me=current.members.find(m=>m.name==='Me');
  await state('PATCH',{planId:plan,action:'member',id:me.id,name:'Me',phone:'+447700900123',notification:'email',active:true});
  current=await state('GET',{planId:plan});assert.equal(current.viewer.memberId,me.id);assert.equal(current.viewer.email,'+447700900123');
  await state('PUT',{planId:plan,memberId:me.id,date:'2099-10-01',available:true});assert.equal((await state('GET',{planId:plan})).availability.length,1);
  assert.equal((await rpc('prod_invites_queue',[mobile,plan,true,true])).smsQueued,1);
  await rpc('prod_accept_terms',[mobile,'2026-09-27']);
  await assert.rejects(()=>state('GET',{planId:oldPlan}));
  await db.exec('reset role');await db.query("update auth.users set phone='447700900125',phone_confirmed_at=now() where id=$1",[owner]);await db.exec('set role service_role');
  assert.equal((await state('GET',{planId:oldPlan},owner)).event.id,oldPlan);
  await rpc('prod_delete_account',[mobile]);assert.equal((await state('GET',{view:'plans'},owner)).plans.length,1);
  await db.exec('set role anon');await assert.rejects(()=>rpc('prod_profile',[owner,false,'{}']));await assert.rejects(()=>state('GET',{planId:oldPlan},owner));
 }finally{await db.close();}
});
