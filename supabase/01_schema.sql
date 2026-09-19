-- Run once in the empty DateEye Supabase project, using SQL Editor.
-- Re-running this script preserves records. This pilot supports one shared plan.
begin;
create table if not exists public.dateeye_admins(user_id uuid primary key references auth.users(id) on delete cascade,email text not null unique);
create table if not exists public.dateeye_events(
 id uuid primary key default gen_random_uuid(), singleton boolean not null default true unique check(singleton),
 name text not null check(length(trim(name)) between 1 and 120),
 start_date date not null,end_date date not null,
 check(start_date >= date '2000-01-01' and end_date <= date '2100-12-31' and end_date>=start_date and end_date-start_date<=365));
create table if not exists public.dateeye_members(
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.dateeye_events(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80), email text unique,
 active boolean not null default true,
 check(email is null or (email=lower(trim(email)) and length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')));
create table if not exists public.dateeye_availability(
 member_id uuid references public.dateeye_members(id) on delete cascade,date date not null,available boolean not null,
 primary key(member_id,date));
alter table public.dateeye_admins enable row level security;
alter table public.dateeye_events enable row level security;
alter table public.dateeye_members enable row level security;
alter table public.dateeye_availability enable row level security;
revoke all on public.dateeye_admins,public.dateeye_events,public.dateeye_members,public.dateeye_availability from anon,authenticated;
grant all on public.dateeye_admins,public.dateeye_events,public.dateeye_members,public.dateeye_availability to service_role;

-- Only the server's secret key can invoke this function. It is NOT callable by
-- anonymous or authenticated browser clients. The Worker verifies p_user with
-- Supabase Auth; p_email deliberately represents unverified pilot identification.
create or replace function public.dateeye_state(p_method text,p_body jsonb,p_email text default null,p_user uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
 admin boolean:=false; own_id uuid; ev public.dateeye_events%rowtype;
 target uuid; nm text; em text; dt date; sd date; ed date; result jsonb; names jsonb;
begin
 if p_method not in ('GET','POST','PUT','PATCH') then raise exception 'Invalid method'; end if;
 -- Serialise mutations so member limits, creation and date changes are atomic.
 if p_method<>'GET' then perform pg_advisory_xact_lock(7191901); end if;
 if p_email is not null then
  select id into own_id from public.dateeye_members where email=lower(trim(p_email)) and active;
  if own_id is null then raise insufficient_privilege; end if;
 else
  select exists(select 1 from public.dateeye_admins where user_id=p_user) into admin;
  if not admin then raise insufficient_privilege; end if;
  select m.id into own_id from public.dateeye_members m join public.dateeye_admins u on lower(u.email)=m.email where u.user_id=p_user and m.active;
 end if;
 select * into ev from public.dateeye_events limit 1;
 if p_method='GET' then
  select jsonb_build_object(
   'event',case when ev.id is null then null else jsonb_build_object('id',ev.id,'name',ev.name,'startDate',ev.start_date,'endDate',ev.end_date) end,
   'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',1) order by name) from public.dateeye_members where active),'[]'::jsonb),
   'managedMembers',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'active',case when active then 1 else 0 end,'linked',0) order by name) from public.dateeye_members),'[]'::jsonb) else null end,
   'availability',coalesce((select jsonb_agg(jsonb_build_object('memberId',a.member_id,'date',a.date,'available',a.available)) from public.dateeye_availability a join public.dateeye_members m on m.id=a.member_id where m.active and a.date between ev.start_date and ev.end_date),'[]'::jsonb),
   'viewer',jsonb_build_object('isAdmin',admin,'memberId',own_id,'email',coalesce(p_email,(select email from public.dateeye_admins where user_id=p_user)))
  ) into result;
  return result;
 end if;
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
 if p_method='POST' or p_body->>'action'='event' then
  nm:=trim(p_body->>'name');sd:=(p_body->>'startDate')::date;ed:=(p_body->>'endDate')::date;
  if nm is null or length(nm) not between 1 and 120 or sd is null or ed is null or sd<date '2000-01-01' or ed>date '2100-12-31' or ed<sd or ed-sd>365 then raise exception 'Invalid event name or dates';end if;
  if p_method='POST' then
   if ev.id is not null then raise exception 'A plan already exists. Use Event settings';end if;
   names:=p_body->'members';
   if jsonb_typeof(names) is distinct from 'array' then raise exception 'Add between 2 and 50 members';end if;
   if jsonb_array_length(names) not between 2 and 50 then raise exception 'Add between 2 and 50 members';end if;
   if exists(select 1 from jsonb_array_elements(names) n where jsonb_typeof(n) <> 'string' or length(trim(n#>>'{}')) not between 1 and 80) then raise exception 'Invalid member name';end if;
   if (select count(distinct lower(trim(n))) from jsonb_array_elements_text(names) n)<>jsonb_array_length(names) then raise exception 'Use distinct member names';end if;
   insert into public.dateeye_events(name,start_date,end_date) values(nm,sd,ed) returning * into ev;
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
   if (select count(*) from public.dateeye_members)>=50 then raise exception 'This plan supports up to 50 members';end if;
   insert into public.dateeye_members(event_id,name,email) values(ev.id,nm,em);
  else
   if not exists(select 1 from public.dateeye_members where id=target and event_id=ev.id) then raise exception 'Member not found';end if;
   if jsonb_typeof(p_body->'active') is distinct from 'boolean' then raise exception 'Invalid member status';end if;
   if not (p_body->>'active')::boolean and (select count(*) from public.dateeye_members where active and id<>target)<2 then raise exception 'Keep at least two active members';end if;
   update public.dateeye_members set name=nm,email=em,active=(p_body->>'active')::boolean where id=target;
  end if;
 else raise exception 'Unknown action';
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.dateeye_state(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.dateeye_state(text,jsonb,text,uuid) to service_role;
commit;
