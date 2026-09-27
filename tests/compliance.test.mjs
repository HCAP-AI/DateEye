import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('compliance migration preserves plans, gates adult acceptance and deletes owned data',async()=>{
 const db=new PGlite();const id='11111111-1111-4111-8111-111111111111';
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);grant usage on schema public to service_role;');
  await db.exec(await readFile(new URL('../supabase/01_schema.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1,$2,now())',[id,'office@hound-capital.com']);
  await db.exec(await readFile(new URL('../supabase/02_grant_admin.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/03_multi_plan.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/04_prod_registration.sql',import.meta.url),'utf8'));
  const migration=await readFile(new URL('../supabase/05_compliance.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  await db.exec('set role service_role');
  const call=async(profile,save=true)=>(await db.query('select public.prod_profile($1::uuid,$2,$3::jsonb) as result',[id,save,JSON.stringify(profile)])).rows[0].result;
  await assert.rejects(()=>call({name:'A',sex:'Prefer not to say',ageRange:'Under 18',termsVersion:'2026-09-27',termsAccepted:true}));
  await assert.rejects(()=>call({name:'A',sex:'Prefer not to say',ageRange:'18–24',termsVersion:'2026-09-27',termsAccepted:false}));
  await call({name:'Adult',sex:'Prefer not to say',ageRange:'18–24',termsVersion:'2026-09-27',termsAccepted:true});
  assert.equal((await call({},false)).termsVersion,'2026-09-27');
  const event=(await db.query("select public.dateeye_state('POST',$1::jsonb,null,$2::uuid) as result",[JSON.stringify({planId:'new',name:'Test',startDate:'2026-10-01',endDate:'2026-10-02',members:['A','B']}),id])).rows[0].result;
  await db.query('select public.prod_delete_account($1::uuid)',[id]);
  assert.equal((await db.query('select count(*)::int as n from public.dateeye_events where id=$1',[event.planId])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from public.prod_profiles where user_id=$1',[id])).rows[0].n,0);
 }finally{await db.close()}
});
