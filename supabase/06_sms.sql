-- prod. SMS upgrade. Apply after 05_compliance.sql; preserves plans and responses.
-- No messages are sent by this migration. Only service_role can call these functions.
begin;
select pg_advisory_xact_lock(7191901);
alter table public.dateeye_members add column if not exists phone text check(phone is null or phone ~ '^\+447[0-9]{9}$');
alter table public.dateeye_members add column if not exists notification text not null default 'email' check(notification in ('email','sms'));
create unique index if not exists dateeye_members_plan_phone on public.dateeye_members(event_id,phone) where phone is not null;
grant select(phone,phone_confirmed_at) on auth.users to service_role;
create table if not exists public.prod_sms_permissions(
 phone text primary key, allowed boolean not null default false, stopped boolean not null default false,
 consent_at timestamptz, consent_version text, updated_at timestamptz not null default now()
);
create table if not exists public.prod_sms_jobs(
 id uuid primary key default gen_random_uuid(),member_id uuid not null references public.dateeye_members(id) on delete cascade,
 phone text not null,kind text not null check(kind in ('invite','reminder')),
 status text not null default 'pending' check(status in ('pending','claimed','accepted','delivered','failed','unknown','cancelled')),
 due_at timestamptz not null default now(), created_at timestamptz not null default now(),claimed_at timestamptz,
 accepted_at timestamptz, twilio_sid text unique, error_code text,
 unique(member_id,phone,kind)
);
create index if not exists prod_sms_due on public.prod_sms_jobs(due_at) where status='pending';
create table if not exists public.prod_sms_limits(id text primary key, attempts integer not null, started_at timestamptz not null);
alter table public.prod_sms_permissions enable row level security;
alter table public.prod_sms_jobs enable row level security;
alter table public.prod_sms_limits enable row level security;
revoke all on public.prod_sms_permissions,public.prod_sms_jobs,public.prod_sms_limits from public,anon,authenticated;
grant all on public.prod_sms_permissions,public.prod_sms_jobs,public.prod_sms_limits to service_role;
create or replace function public.dateeye_state_v3(p_method text,p_body jsonb,p_email text default null,p_user uuid default null)
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
   'managedMembers',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,'notification',notification,'smsAllowed',exists(select 1 from public.prod_sms_permissions sp where sp.phone=dateeye_members.phone and sp.allowed and not sp.stopped),'smsStatus',(select j.status from public.prod_sms_jobs j where j.member_id=dateeye_members.id and j.phone=dateeye_members.phone and j.kind='invite' order by j.created_at desc limit 1),'active',case when active then 1 else 0 end,'linked',0) order by name) from public.dateeye_members where event_id=ev.id),'[]'::jsonb) else null end,
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
   insert into public.dateeye_members(event_id,name,email) values(ev.id,nm,em) returning id into target;
  else
   if not exists(select 1 from public.dateeye_members where id=target and event_id=ev.id) then raise exception 'Member not found';end if;
   if jsonb_typeof(p_body->'active') is distinct from 'boolean' then raise exception 'Invalid member status';end if;
   if not (p_body->>'active')::boolean and (select count(*) from public.dateeye_members where active and event_id=ev.id and id<>target)<2 then raise exception 'Keep at least two active members';end if;
   update public.dateeye_members set name=nm,email=em,active=(p_body->>'active')::boolean where id=target;
  end if;
 else raise exception 'Unknown action';
 end if;
 return jsonb_build_object('ok',true,'planId',ev.id,'memberId',target);
end $$;

-- Existing API with phone settings added; the organiser cannot manufacture consent.
create or replace function public.dateeye_state(p_method text,p_body jsonb,p_email text default null,p_user uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; target uuid; ph text; choice text;
begin
 if p_method <> 'GET' then perform pg_advisory_xact_lock(7191901);end if;
 if p_email is not null and exists(select 1 from public.dateeye_members where email=lower(trim(p_email)) and notification='sms' and event_id=coalesce(nullif(p_body->>'planId','')::uuid,(select event_id from public.dateeye_legacy_plan where id=1))) then
  raise insufficient_privilege;
 end if;
 if p_method='POST' and p_email is null and not exists(select 1 from public.prod_profiles where user_id=p_user) then raise exception 'Complete your registration before creating an event';end if;
 result:=public.dateeye_state_v3(p_method,p_body,p_email,p_user);
 if p_method='PATCH' and p_body->>'action'='member' then
  if nullif(p_body->>'id','') is not null then target:=(p_body->>'id')::uuid;
  else target:=(result->>'memberId')::uuid;end if;
  select phone,notification into ph,choice from public.dateeye_members where id=target;
  if p_body ? 'phone' then ph:=nullif(p_body->>'phone','');end if;
  if p_body ? 'notification' then choice:=p_body->>'notification';end if;
  if choice is null or choice not in ('email','sms') then raise exception 'Choose email or SMS';end if;
  if choice='sms' and ph is null then raise exception 'Add a UK mobile number for SMS responses';end if;
  update public.dateeye_members set phone=ph,notification=choice where id=target;
  update public.prod_sms_jobs set status='cancelled' where member_id=target and status='pending' and (phone is distinct from ph or choice<>'sms' or not (p_body->>'active')::boolean);
 end if;
 return result;
end $$;

create or replace function public.prod_phone_access(p_user uuid,p_method text,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ph text; own_member public.dateeye_members%rowtype; ev public.dateeye_events%rowtype; dt date;
begin
 select '+'||ltrim(phone,'+') into ph from auth.users where id=p_user and phone_confirmed_at is not null;
 if ph is null then raise insufficient_privilege;end if;
 if p_method='permissions' then
  if jsonb_typeof(p_body->'allowed') is distinct from 'boolean' then raise exception 'Choose your SMS preference';end if;
  insert into public.prod_sms_permissions(phone,allowed,consent_at,consent_version)
   values(ph,(p_body->>'allowed')::boolean,case when (p_body->>'allowed')::boolean then now() end,'sms-2026-10-02')
   on conflict(phone) do update set allowed=excluded.allowed,consent_at=excluded.consent_at,consent_version=excluded.consent_version,updated_at=now();
  if not (p_body->>'allowed')::boolean then update public.prod_sms_jobs set status='cancelled' where phone=ph and status='pending';end if;
  return jsonb_build_object('ok',true,'stopped',coalesce((select stopped from public.prod_sms_permissions where phone=ph),false));
 end if;
 if p_method='plans' then
  return jsonb_build_object('plans',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.start_date) from public.dateeye_events e join public.dateeye_members m on m.event_id=e.id where m.phone=ph and m.active and not e.archived),'[]'::jsonb));
 end if;
 select * into own_member from public.dateeye_members where event_id=(p_body->>'planId')::uuid and phone=ph and active;
 select * into ev from public.dateeye_events where id=own_member.event_id and not archived;
 if own_member.id is null or ev.id is null then raise insufficient_privilege;end if;
 if p_method='PUT' then
  perform pg_advisory_xact_lock(7191901);
  if p_body->>'memberId' is distinct from own_member.id::text then raise insufficient_privilege;end if;
  if jsonb_typeof(p_body->'available') is distinct from 'boolean' then raise exception 'Invalid availability';end if;
  dt:=(p_body->>'date')::date;
  if dt is null or dt not between ev.start_date and ev.end_date then raise exception 'Choose a date in the event range';end if;
  insert into public.dateeye_availability(member_id,date,available) values(own_member.id,dt,(p_body->>'available')::boolean) on conflict(member_id,date) do update set available=excluded.available;
  update public.prod_sms_jobs set status='cancelled' where member_id=own_member.id and kind='reminder' and status='pending';
  return jsonb_build_object('ok',true);
 end if;
 if p_method<>'GET' then raise insufficient_privilege;end if;
 return jsonb_build_object(
  'event',jsonb_build_object('id',ev.id,'name',ev.name,'startDate',ev.start_date,'endDate',ev.end_date),
  'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',1) order by name) from public.dateeye_members where event_id=ev.id and active),'[]'::jsonb),
  'availability',coalesce((select jsonb_agg(jsonb_build_object('memberId',a.member_id,'date',a.date,'available',a.available)) from public.dateeye_availability a join public.dateeye_members m on m.id=a.member_id where m.event_id=ev.id and m.active and a.date between ev.start_date and ev.end_date),'[]'::jsonb),
  'viewer',jsonb_build_object('isAdmin',false,'memberId',own_member.id,'email',ph,'phoneVerified',true));
end $$;
create or replace function public.prod_invitations(p_email text)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('plans',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.start_date),'[]'::jsonb))
 from public.dateeye_events e join public.dateeye_members m on m.event_id=e.id
 where m.email=lower(trim(p_email)) and m.active and not e.archived and m.notification='email';
$$;
-- Rate limits are durable across Worker instances. Hashed keys contain no raw phone or IP.
create or replace function public.prod_sms_rate(p_keys jsonb,p_max integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare k text; n integer;begin
 perform pg_advisory_xact_lock(7191902);
 for k in select jsonb_array_elements_text(p_keys) loop
  insert into public.prod_sms_limits values(k,1,now()) on conflict(id) do update set
   attempts=case when public.prod_sms_limits.started_at < now()-make_interval(secs=>p_seconds) then 1 else public.prod_sms_limits.attempts+1 end,
   started_at=case when public.prod_sms_limits.started_at < now()-make_interval(secs=>p_seconds) then now() else public.prod_sms_limits.started_at end returning attempts into n;
  if n>p_max then return false;end if;
 end loop;
 delete from public.prod_sms_limits where started_at<now()-interval '2 days';
 return true;end $$;

create or replace function public.prod_sms_queue(p_user uuid,p_plan uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer; skipped integer;begin
 perform pg_advisory_xact_lock(7191901);
 if not exists(select 1 from public.dateeye_events where id=p_plan and owner_id=p_user and not archived) then raise insufficient_privilege;end if;
 insert into public.prod_sms_jobs(member_id,phone,kind)
 select m.id,m.phone,'invite' from public.dateeye_members m join public.prod_sms_permissions s on s.phone=m.phone
 where m.event_id=p_plan and m.active and m.notification='sms' and s.allowed and not s.stopped
 and not exists(select 1 from public.dateeye_availability a where a.member_id=m.id)
 on conflict(member_id,phone,kind) do nothing;
 get diagnostics n=row_count;
 select count(*) into skipped from public.dateeye_members m where m.event_id=p_plan and m.active and m.notification='sms'
 and not exists(select 1 from public.prod_sms_permissions s where s.phone=m.phone and s.allowed and not s.stopped);
 return jsonb_build_object('queued',n,'needsPermission',skipped);
end $$;

-- Claim one message immediately before sending; multiple Cron runs cannot send the same job.
create or replace function public.prod_sms_claim(p_daily_limit integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.prod_sms_jobs%rowtype;begin
 perform pg_advisory_xact_lock(7191901);
 update public.prod_sms_jobs set status='unknown',error_code='worker_interrupted' where status='claimed' and claimed_at<now()-interval '10 minutes';
 update public.prod_sms_jobs queued set status='cancelled' where queued.status='pending' and not exists(
  select 1 from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id join public.prod_sms_permissions s on s.phone=m.phone
  where m.id=queued.member_id and m.phone=queued.phone and m.active and m.notification='sms' and not e.archived and e.end_date>=current_date and s.allowed and not s.stopped
  and not exists(select 1 from public.dateeye_availability a where a.member_id=m.id));
 if p_daily_limit is null or p_daily_limit<1 or (select count(*) from public.prod_sms_jobs where claimed_at>=date_trunc('day',now()))>=least(p_daily_limit,1000) then return null;end if;
 select * into j from public.prod_sms_jobs where status='pending' and due_at<=now() order by due_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 update public.prod_sms_jobs set status='claimed',claimed_at=now() where id=j.id;
 return (select jsonb_build_object('id',j.id,'phone',j.phone,'kind',j.kind,'planId',e.id,'eventName',e.name,'organiser',coalesce(p.name,'Your organiser')) from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id left join public.prod_profiles p on p.user_id=e.owner_id where m.id=j.member_id);
end $$;

create or replace function public.prod_sms_result(p_id uuid,p_status text,p_sid text default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.prod_sms_jobs%rowtype;begin
 perform pg_advisory_xact_lock(7191901);
 if p_status not in ('accepted','delivered','failed','unknown') then raise exception 'Invalid delivery result';end if;
 select * into j from public.prod_sms_jobs where id=p_id for update;
 if j.id is null then return jsonb_build_object('ok',true);end if;
 if j.twilio_sid is not null and p_sid is distinct from j.twilio_sid then raise insufficient_privilege;end if;
 -- A delivery webhook can arrive before the outgoing request returns.
 update public.prod_sms_jobs set status=case when status in ('failed','delivered','cancelled') then status else p_status end,
 twilio_sid=coalesce(twilio_sid,p_sid),error_code=coalesce(p_error,error_code),
 accepted_at=case when p_status in ('accepted','delivered') then coalesce(accepted_at,now()) else accepted_at end where id=p_id returning * into j;
 if j.kind='invite' and j.status in ('accepted','delivered') then
  insert into public.prod_sms_jobs(member_id,phone,kind,due_at) values(j.member_id,j.phone,'reminder',j.accepted_at+interval '24 hours') on conflict(member_id,phone,kind) do nothing;
 elsif j.kind='invite' and j.status='failed' then
  update public.prod_sms_jobs set status='cancelled' where member_id=j.member_id and phone=j.phone and kind='reminder' and status='pending';
 end if;
 return jsonb_build_object('ok',true);
end $$;
create or replace function public.prod_sms_inbound(p_phone text,p_stop boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(7191901);
 insert into public.prod_sms_permissions(phone,allowed,stopped) values(p_phone,false,p_stop) on conflict(phone) do update set
 stopped=p_stop,allowed=case when p_stop then false else public.prod_sms_permissions.allowed end,updated_at=now();
 if p_stop then update public.prod_sms_jobs set status='cancelled' where phone=p_phone and status='pending';end if;
 return jsonb_build_object('ok',true);
end $$;
-- Explicitly restrict every new RPC, including the existing v3 implementation.
revoke all on function public.dateeye_state_v3(text,jsonb,text,uuid),public.dateeye_state(text,jsonb,text,uuid),
 public.prod_phone_access(uuid,text,jsonb),public.prod_sms_rate(jsonb,integer,integer),public.prod_sms_queue(uuid,uuid),
 public.prod_sms_claim(integer),public.prod_sms_result(uuid,text,text,text),public.prod_sms_inbound(text,boolean) from public,anon,authenticated;
grant execute on function public.dateeye_state_v3(text,jsonb,text,uuid),public.dateeye_state(text,jsonb,text,uuid),
 public.prod_phone_access(uuid,text,jsonb),public.prod_sms_rate(jsonb,integer,integer),public.prod_sms_queue(uuid,uuid),
 public.prod_sms_claim(integer),public.prod_sms_result(uuid,text,text,text),public.prod_sms_inbound(text,boolean) to service_role;
commit;
