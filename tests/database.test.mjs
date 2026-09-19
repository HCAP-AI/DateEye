import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL schema, permissions and calendar lifecycle',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);grant usage on schema public to service_role;`);
 const schema=await readFile(new URL('../supabase/01_schema.sql',import.meta.url),'utf8');await db.exec(schema);await db.exec(schema);
 const admin='11111111-1111-4111-8111-111111111111';
 await db.query('insert into auth.users values($1,$2,now())',[admin,'office@hound-capital.com']);
 await db.exec(await readFile(new URL('../supabase/02_grant_admin.sql',import.meta.url),'utf8'));
 async function rpc(method,body={},email=null,user=admin){return (await db.query('select public.dateeye_state($1,$2::jsonb,$3,$4::uuid) as result',[method,JSON.stringify(body),email,user])).rows[0].result;}
 await db.exec('set role anon');await assert.rejects(()=>rpc('GET'));await db.exec('reset role');
 await db.exec('set role authenticated');await assert.rejects(()=>rpc('GET'));await db.exec('reset role');
 await db.exec('set role service_role');
 await rpc('POST',{name:'Sailing',startDate:'2026-10-01',endDate:'2026-10-31',members:['Oliver','James','Sophie']});
 let state=await rpc('GET');assert.equal(state.members.length,3);assert.equal(state.viewer.isAdmin,true);
 const [james,oliver,sophie]=state.managedMembers;
 await rpc('PATCH',{action:'member',id:oliver.id,name:oliver.name,email:'office@hound-capital.com',active:true});
 await rpc('PATCH',{action:'member',id:james.id,name:james.name,email:'james@example.com',active:true});
 await rpc('PATCH',{action:'member',id:sophie.id,name:sophie.name,email:'sophie@example.com',active:true});
 const invite=await rpc('GET',{},'office@hound-capital.com');assert.equal(invite.viewer.isAdmin,false);assert.equal(invite.managedMembers,null);assert.ok(!('email' in invite.members[0]));
 await assert.rejects(()=>rpc('PATCH',{action:'event',name:'No',startDate:'2026-10-01',endDate:'2026-10-02'},'office@hound-capital.com'));
 await assert.rejects(()=>rpc('PUT',{memberId:sophie.id,date:'2026-10-05',available:true},'james@example.com'));
 await assert.rejects(()=>rpc('GET',{},'unknown@example.com'));
 await rpc('PUT',{memberId:james.id,date:'2026-10-05',available:false},'james@example.com');
 state=await rpc('GET');assert.equal(state.availability[0].available,false);
 await rpc('PUT',{memberId:james.id,date:'2026-10-05',available:true},'james@example.com');
 await assert.rejects(()=>rpc('PUT',{memberId:james.id,date:'2026-11-01',available:true},'james@example.com'));
 await rpc('PATCH',{action:'event',name:'Sailing',startDate:'2026-10-10',endDate:'2026-10-31'});assert.equal((await rpc('GET')).availability.length,0);
 await rpc('PATCH',{action:'event',name:'Sailing',startDate:'2026-10-01',endDate:'2026-10-31'});assert.equal((await rpc('GET')).availability[0].available,true);
 await rpc('PATCH',{action:'member',id:james.id,name:james.name,email:'james@example.com',active:false});
 await assert.rejects(()=>rpc('GET',{},'james@example.com'));assert.equal((await rpc('GET')).members.length,2);
 await assert.rejects(()=>rpc('PATCH',{action:'member',id:sophie.id,name:sophie.name,email:'sophie@example.com',active:false}));
 await rpc('PATCH',{action:'member',id:james.id,name:james.name,email:'james@example.com',active:true});assert.equal((await rpc('GET')).availability.length,1);
 await assert.rejects(()=>rpc('PATCH',{action:'member',id:sophie.id,name:sophie.name,email:'james@example.com',active:true}));
 await assert.rejects(()=>rpc('POST',{name:'Other',startDate:'2026-10-01',endDate:'2026-10-31',members:['A','B']}));
 }finally{await db.close();}
});
