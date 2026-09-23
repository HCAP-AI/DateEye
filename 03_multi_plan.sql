-- DateEye multi-plan upgrade. Run after 01_schema.sql and 02_grant_admin.sql.
-- Transactional and repeatable; preserves IDs and availability records.
begin;
select pg_advisory_xact_lock(7191901);
alter table public.dateeye_events add column if not exists owner_id uuid references public.dateeye_admins(user_id);
alter table public.dateeye_events add column if not exists archived boolean not null default false;
do $$ begin
 if exists(select 1 from public.dateeye_events where owner_id is null) then
  if (select count(*) from public.dateeye_admins)<>1 then
   raise exception 'Exactly one administrator is required to assign the existing plan. Assign owner_id explicitly before rerunning.';
  end if;
  update public.dateeye_events set owner_id=(select user_id from public.dateeye_admins limit 1) where owner_id is null;
 end if;
end $$;
alter table public.dateeye_events alter column owner_id set not null;
-- Keep the original root link attached to the original plan, even after new plans exist.
create table if not exists public.dateeye_legacy_plan(id integer primary key check(id=1),event_id uuid references public.dateeye_events(id));
insert into public.dateeye_legacy_plan(id,event_id) values(1,(select id from public.dateeye_events order by id limit 1)) on conflict(id) do nothing;
alter table public.dateeye_legacy_plan enable row level security;
revoke all on public.dateeye_legacy_plan from anon,authenticated;
grant select on public.dateeye_legacy_plan to service_role;
alter table public.dateeye_events drop column if exists singleton;
alter table public.dateeye_members drop constraint if exists dateeye_members_email_key;
create unique index if not exists dateeye_members_plan_email on public.dateeye_members(event_id,email);
create index if not exists dateeye_events_owner on public.dateeye_events(owner_id);
create index if not exists dateeye_members_plan on public.dateeye_members(event_id);
create or replace function public.dateeye_state(p_method text,p_body jsonb,p_email text default null,p_user uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 admin boolean:=false; own_id uuid; plan_id uuid; legacy_id uuid; ev public.dateeye_events%rowtype;
 target uuid; nm text; em text; dt date; sd date; ed date; result jsonb; names jsonb;
begin
 if p_method not in ('GET','POST','PUT','PATCH') then raise exception 'Invalid method'; end if;
 -- Serialise mutations so member limits, creation and date changes are atomic.
 if p_method<>'GET' then perform pg_advisory_xact_lock(7191901); end if;
 select event_id into legacy_id from public.dateeye_legacy_plan where id=1;
 if p_body->>'planId'='new' then plan_id:=null;
 elsif nullif(p_body->>'planId','') is not null then plan_id:=(p_body->>'planId')::uuid;
 else plan_id:=legacy_id;
 end if;
 if p_email is not null then
  select m.id into own_id from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id
   where m.email=lower(trim(p_email)) and m.active and e.id=plan_id and not e.archived;
  if own_id is null then raise insufficient_privilege; end if;
 else
  select exists(select 1 from public.dateeye_admins where user_id=p_user) into admin;
  if not admin then raise insufficient_privilege; end if;
 end if;
 if p_method='GET' and p_body->>'view'='plans' then
  if not admin then raise insufficient_privilege;end if;
  return jsonb_build_object('plans',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'startDate',start_date,'endDate',end_date,'archived',archived) order by archived,start_date desc,id) from public.dateeye_events where owner_id=p_user),'[]'::jsonb));
 end if;
 select * into ev from public.dateeye_events where id=plan_id;
 if admin and ev.id is not null and ev.owner_id<>p_user then raise insufficient_privilege;end if;
 if plan_id is not null and ev.id is null then raise exception 'Plan not found';end if;
 if admin then
  select m.id into own_id from public.dateeye_members m join public.dateeye_admins a on a.email=m.email
   where a.user_id=p_user and m.active and m.event_id=ev.id;
 end if;
 if p_method='GET' then
  select jsonb_build_object(
   'event',case when ev.id is null then null else jsonb_build_object('id',ev.id,'name',ev.name,'startDate',ev.start_date,'endDate',ev.end_date,'archived',ev.archived) end,
   'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',1) order by name) from public.dateeye_members where active and event_id=ev.id),'[]'::jsonb),
   'managedMembers',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'active',case when active then 1 else 0 end,'linked',0) order by name) from public.dateeye_members where event_id=ev.id),'[]'::jsonb) else null end,
   'availability',coalesce((select jsonb_agg(jsonb_build_object('memberId',a.member_id,'date',a.date,'available',a.available)) from public.dateeye_availability a join public.dateeye_members m on m.id=a.member_id where m.active and m.event_id=ev.id and a.date between ev.start_date and ev.end_date),'[]'::jsonb),
   'viewer',jsonb_build_object('isAdmin',admin,'memberId',own_id,'email',coalesce(p_email,(select email from public.dateeye_admins where user_id=p_user)))
  ) into result;
  return result;
 end if;
 if ev.archived and p_body->>'action' is distinct from 'archive' then raise exception 'This plan is archived. Restore it before making changes';end if;
 if p_method='PUT' then
  if own_id is null or own_id::text is distinct from p_body->>'memberId' then raise insufficient_privilege; end if;
  if jsonb_typeof(p_body->'available') is distinct from 'boolean' then raise exception 'Invalid availability'; end if;
  dt:=(p_body->>'date')::date;
  if dt is null or ev.id is null or dt not between ev.start_date and ev.end_date then raise exception 'Choose a date within the event range'; end if;
  insert into public.dateeye_availability values(own_id,dt,(p_body->>'available')::boolean)
  on conflict(member_id,date) do update set available=excluded.available;
  return jsonb_build_object('ok',true);
 end if;
 if not admin then raise insufficient_privilege; end if;
 if p_method='PATCH' and p_body->>'action'='archive' then
  if ev.id is null or jsonb_typeof(p_body->'archived') is distinct from 'boolean' then raise exception 'Invalid archive request';end if;
  update public.dateeye_events set archived=(p_body->>'archived')::boolean where id=ev.id;
  return jsonb_build_object('ok',true);
 end if;
 if p_method='POST' or p_body->>'action'='event' then
  nm:=trim(p_body->>'name');sd:=(p_body->>'startDate')::date;ed:=(p_body->>'endDate')::date;
  if nm is null or length(nm) not between 1 and 120 or sd is null or ed is null or sd<date '2000-01-01' or ed>date '2100-12-31' or ed<sd or ed-sd>365 then raise exception 'Invalid event name or dates';end if;
  if p_method='POST' then

   names:=p_body->'members';
   if jsonb_typeof(names) is distinct from 'array' then raise exception 'Add between 2 and 50 members';end if;
   if jsonb_array_length(names) not between 2 and 50 then raise exception 'Add between 2 and 50 members';end if;
   if exists(select 1 from jsonb_array_elements(names) n where jsonb_typeof(n) <> 'string' or length(trim(n#>>'{}')) not between 1 and 80) then raise exception 'Invalid member name';end if;
   if (select count(distinct lower(trim(n))) from jsonb_array_elements_text(names) n)<>jsonb_array_length(names) then raise exception 'Use distinct member names';end if;
   insert into public.dateeye_events(name,start_date,end_date,owner_id) values(nm,sd,ed,p_user) returning * into ev;
   insert into public.dateeye_members(event_id,name) select ev.id,trim(n) from jsonb_array_elements_text(names) n;
  else
   if ev.id is null then raise exception 'Create a plan first';end if;
   update public.dateeye_events set name=nm,start_date=sd,end_date=ed where id=ev.id;
  end if;
 elsif p_body->>'action'='member' then
  if ev.id is null then raise exception 'Create a plan first';end if;
  nm:=trim(p_body->>'name');em:=nullif(lower(trim(p_body->>'email')),'');
  if nm is null or length(nm) not between 1 and 80 then raise exception 'Invalid member name';end if;
  if em is not null and (length(em)>254 or em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Invalid email';end if;
  target:=nullif(p_body->>'id','')::uuid;
  if target is null then
   if (select count(*) from public.dateeye_members where event_id=ev.id)>=50 then raise exception 'This plan supports up to 50 members';end if;
   insert into public.dateeye_members(event_id,name,email) values(ev.id,nm,em);
  else
   if not exists(select 1 from public.dateeye_members where id=target and event_id=ev.id) then raise exception 'Member not found';end if;
   if jsonb_typeof(p_body->'active') is distinct from 'boolean' then raise exception 'Invalid member status';end if;
   if not (p_body->>'active')::boolean and (select count(*) from public.dateeye_members where active and event_id=ev.id and id<>target)<2 then raise exception 'Keep at least two active members';end if;
   update public.dateeye_members set name=nm,email=em,active=(p_body->>'active')::boolean where id=target;
  end if;
 else raise exception 'Unknown action';
 end if;
 return jsonb_build_object('ok',true,'planId',ev.id);
end $$;
revoke all on function public.dateeye_state(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.dateeye_state(text,jsonb,text,uuid) to service_role;

commit;
