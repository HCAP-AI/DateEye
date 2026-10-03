import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {reportDate,processReports,unsubscribeSignature,validUnsubscribe,reportText} from '../worker/reporting.ts';
import worker from '../worker/index.ts';
test('UK schedule observes winter, summer and midnight boundaries',()=>{
 assert.equal(reportDate(new Date('2026-07-01T05:59:00Z')).due,false);
 assert.equal(reportDate(new Date('2026-07-01T06:00:00Z')).due,true);
 assert.equal(reportDate(new Date('2026-12-01T06:59:00Z')).due,false);
 assert.equal(reportDate(new Date('2026-12-01T07:00:00Z')).due,true);
 assert.deepEqual(reportDate(new Date('2026-06-30T23:30:00Z')),{today:'2026-07-01',yesterday:'2026-06-30',due:false});
});
test('unsubscribe signatures resist tampering and GET never changes preferences',async()=>{
 const id='11111111-1111-4111-8111-111111111111',secret='test-secret';
 const sig=await unsubscribeSignature(id,secret);
 assert.equal(await validUnsubscribe(id,sig,secret),true);assert.equal(await validUnsubscribe(id,sig,'other-secret'),false);
 const r=await worker.fetch(new Request('https://prod.test/api/email/unsubscribe?job='+id+'&sig='+sig),{SUPABASE_SECRET_KEY:secret});
 assert.equal(r.status,200);assert.match(await r.text(),/<form method="post">/);
 assert.equal((await worker.fetch(new Request('https://prod.test/api/email/unsubscribe?job='+id+'&sig=wrong'),{SUPABASE_SECRET_KEY:secret})).status,400);
});
test('report send is claimed before sending and an ambiguous network outcome is not retried',async()=>{
 let claimed=false,sends=0;const results=[];const old=globalThis.fetch;
 const report={day:'2026-07-01',test:false,partial:false,metrics:{},responders:0,totalUsers:1,activeEvents:2,pendingSms:0,pendingEmail:0,unknownSms:0,unknownEmail:0,failedReports:0};
 const rpc=async(n,d)=>{if(n==='prod_report_claim'){if(claimed)return null;claimed=true;return report;}results.push(d);};
 try{globalThis.fetch=async()=>{assert.equal(claimed,true);sends++;throw Error('timeout');};
 const env={REPORTS_ENABLED:'true',REPORT_EMAIL:'owner@example.com',EMAIL_FROM:'invites@example.com',SENDGRID_API_KEY:'test',SUPABASE_SECRET_KEY:'test'};
 await processReports(env,rpc,new Date('2026-07-02T06:00:00Z'));await processReports(env,rpc,new Date('2026-07-02T06:05:00Z'));
 assert.equal(sends,1);assert.equal(results[0].p_status,'unknown');assert.match(reportText(report),/not unique people/);
 }finally{globalThis.fetch=old;}
});
test('report database tracks actual changes, suppresses emails and isolates reporting functions',async()=>{
 const db=new PGlite();const owner='11111111-1111-4111-8111-111111111111';
 const rpc=async(n,args)=>(await db.query(`select public.${n}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
 try{
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz);grant usage on schema public to service_role;');
 await db.exec(await readFile('supabase/01_schema.sql','utf8'));
 await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[owner,'office@hound-capital.com']);
 for(const f of ['02_grant_admin.sql','03_multi_plan.sql','04_prod_registration.sql','05_compliance.sql','06_sms.sql','07_simple_invites.sql','08_daily_reporting.sql'])await db.exec(await readFile('supabase/'+f,'utf8'));
 await db.exec(await readFile('supabase/08_daily_reporting.sql','utf8'));
 await db.exec('set role service_role');
 await rpc('prod_profile',[owner,true,JSON.stringify({name:'Owner',sex:'Male',ageRange:'35–44',termsVersion:'2026-09-27',termsAccepted:true})]);
 const state=(method,b)=>rpc('dateeye_state',[method,JSON.stringify(b),null,owner]);
 const plan=(await state('POST',{planId:'new',name:'Test',startDate:'2099-01-01',endDate:'2099-01-02',members:['Guest','Other']})).planId;
 const member=(await state('GET',{planId:plan})).members[0];
 await state('PATCH',{planId:plan,action:'member',id:member.id,name:'Guest',email:'guest@example.com',phone:'+447700900123',notification:'email',active:true});
 await rpc('prod_contact_access',['guest@example.com','PUT',JSON.stringify({planId:plan,memberId:member.id,date:'2099-01-01',available:true})]);
 await rpc('prod_contact_access',['guest@example.com','PUT',JSON.stringify({planId:plan,memberId:member.id,date:'2099-01-02',available:false})]);
 await rpc('prod_sms_inbound',['+447700900123',true]);await rpc('prod_sms_inbound',['+447700900123',true]);
 await rpc('prod_invites_queue',[owner,plan,false,true]);
 const job=(await db.query('select id from public.prod_email_jobs')).rows[0].id;
 await rpc('prod_email_unsubscribe',[job]);await rpc('prod_email_unsubscribe',[job]);
 assert.equal(await rpc('prod_email_claim',[50]),null);
 const day=(await db.query("select (now() at time zone 'Europe/London')::date::text as day")).rows[0].day;
 const report=await rpc('prod_report_claim',[day,true]);
 assert.equal(report.metrics.registrations,1);assert.equal(report.metrics.events_created,1);assert.equal(report.metrics.sms_optouts,1);assert.equal(report.metrics.email_optouts,1);assert.equal(report.responders,1);assert.equal(report.partial,true);
 assert.equal(await rpc('prod_report_claim',[day,true]),null);assert.equal(await rpc('prod_report_claim',[day,false]),null);
 await db.exec('reset role;set role anon');await assert.rejects(()=>rpc('prod_report_claim',[day,true]));await assert.rejects(()=>rpc('prod_metric',['page_loads']));await assert.rejects(()=>rpc('prod_email_unsubscribe',[job]));
 }finally{await db.close();}
});
