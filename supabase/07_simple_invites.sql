-- Apply after 06_sms.sql. No messages sent by this migration.
-- Deliberately permits contact-only invitee entry; organiser authentication is unchanged.
begin;
select pg_advisory_xact_lock(7191901);
create or replace function public.dateeye_state(p_method text,p_body jsonb,p_email text default null,p_user uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; target uuid; ph text; choice text;
begin
 if p_method <> 'GET' then perform pg_advisory_xact_lock(7191901);end if;
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
  update public.prod_sms_jobs set status='cancelled' where member_id=target and status='pending' and (phone is distinct from ph or not (p_body->>'active')::boolean);
 end if;
 return result;
end $$;
create or replace function public.prod_contact_access(p_contact text,p_method text,p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare ph text; own_member public.dateeye_members%rowtype; ev public.dateeye_events%rowtype; dt date;
begin
 if p_method='PUT' then perform pg_advisory_xact_lock(7191901);end if;
 ph:=lower(trim(p_contact));
 if ph is null or length(ph)>254 then raise insufficient_privilege;end if;
 if p_method='plans' then
  return jsonb_build_object('plans',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.start_date) from public.dateeye_events e join public.dateeye_members m on m.event_id=e.id where (m.phone=ph or m.email=ph) and m.active and not e.archived),'[]'::jsonb));
 end if;
 select * into own_member from public.dateeye_members where event_id=(p_body->>'planId')::uuid and (phone=ph or email=ph) and active;
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
  'viewer',jsonb_build_object('isAdmin',false,'memberId',own_member.id,'email',ph));
end $$;
create or replace function public.prod_sms_queue(p_user uuid,p_plan uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare n integer; skipped integer;begin
 perform pg_advisory_xact_lock(7191901);
 if not exists(select 1 from public.dateeye_events where id=p_plan and owner_id=p_user and not archived) then raise insufficient_privilege;end if;
 insert into public.prod_sms_jobs(member_id,phone,kind)
 select m.id,m.phone,'invite' from public.dateeye_members m left join public.prod_sms_permissions s on s.phone=m.phone
 where m.event_id=p_plan and m.active and m.phone is not null and coalesce(s.allowed,true) and not coalesce(s.stopped,false)

 on conflict(member_id,phone,kind) do nothing;
 get diagnostics n=row_count;
 select count(*) into skipped from public.dateeye_members m where m.event_id=p_plan and m.active and m.phone is not null
 and exists(select 1 from public.prod_sms_permissions s where s.phone=m.phone and (not s.allowed or s.stopped));
 return jsonb_build_object('queued',n,'needsPermission',skipped);
end $$;
create or replace function public.prod_sms_claim(p_daily_limit integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.prod_sms_jobs%rowtype;begin
 perform pg_advisory_xact_lock(7191901);
 update public.prod_sms_jobs set status='unknown',error_code='worker_interrupted' where status='claimed' and claimed_at<now()-interval '10 minutes';
 update public.prod_sms_jobs queued set status='cancelled' where queued.status='pending' and not exists(
  select 1 from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id left join public.prod_sms_permissions s on s.phone=m.phone
  where m.id=queued.member_id and m.phone=queued.phone and m.active  and not e.archived and e.end_date>=current_date and coalesce(s.allowed,true) and not coalesce(s.stopped,false) and (queued.kind='invite' or s.allowed)
  and (queued.kind='invite' or not exists(select 1 from public.dateeye_availability a where a.member_id=m.id)));
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
 if j.kind='invite' and j.status in ('accepted','delivered') and exists(select 1 from public.prod_sms_permissions where phone=j.phone and allowed and not stopped) then
  insert into public.prod_sms_jobs(member_id,phone,kind,due_at) values(j.member_id,j.phone,'reminder',j.accepted_at+interval '24 hours') on conflict(member_id,phone,kind) do nothing;
 elsif j.kind='invite' and j.status='failed' then
  update public.prod_sms_jobs set status='cancelled' where member_id=j.member_id and phone=j.phone and kind='reminder' and status='pending';
 end if;
 return jsonb_build_object('ok',true);
end $$;
create table if not exists public.prod_email_jobs(
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.dateeye_members(id) on delete cascade,
 email text not null, status text not null default 'pending' check(status in ('pending','claimed','accepted','failed','unknown','cancelled')),
 created_at timestamptz not null default now(), claimed_at timestamptz, error_code text,
 unique(member_id,email)
);
alter table public.prod_email_jobs enable row level security;
revoke all on public.prod_email_jobs from public,anon,authenticated;
grant all on public.prod_email_jobs to service_role;
create or replace function public.prod_invites_queue(p_user uuid,p_plan uuid,p_sms boolean,p_email boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare sms jsonb:='{"queued":0,"needsPermission":0}'; n integer:=0; missing integer; unavailable_sms integer; unavailable_email integer;
begin
 perform pg_advisory_xact_lock(7191901);
 if not exists(select 1 from public.dateeye_events where id=p_plan and owner_id=p_user and not archived and end_date>=current_date) then raise insufficient_privilege;end if;
 if p_sms then sms:=public.prod_sms_queue(p_user,p_plan);end if;
 if p_email then
  insert into public.prod_email_jobs(member_id,email)
  select id,email from public.dateeye_members m where event_id=p_plan and active and email is not null
 
  on conflict(member_id,email) do nothing;
  get diagnostics n=row_count;
 end if;
 select count(*) filter(where phone is null and email is null),
 count(*) filter(where phone is not null and not p_sms), count(*) filter(where email is not null and not p_email)
 into missing,unavailable_sms,unavailable_email from public.dateeye_members where event_id=p_plan and active;
 return jsonb_build_object('smsQueued',sms->'queued','smsStopped',sms->'needsPermission','emailQueued',n,'missingContacts',missing,'smsUnavailable',unavailable_sms,'emailUnavailable',unavailable_email);
end $$;
create or replace function public.prod_email_claim(p_daily_limit integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.prod_email_jobs%rowtype;
begin
 perform pg_advisory_xact_lock(7191901);
 update public.prod_email_jobs set status='unknown',error_code='worker_interrupted' where status='claimed' and claimed_at<now()-interval '10 minutes';
 update public.prod_email_jobs q set status='cancelled' where q.status='pending' and not exists(
  select 1 from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id
  where m.id=q.member_id and m.email=q.email and m.active and not e.archived and e.end_date>=current_date);
 if p_daily_limit is null or p_daily_limit<1 or (select count(*) from public.prod_email_jobs where claimed_at>=date_trunc('day',now()))>=least(p_daily_limit,1000) then return null;end if;
 select * into j from public.prod_email_jobs where status='pending' order by created_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 update public.prod_email_jobs set status='claimed',claimed_at=now() where id=j.id;
 return (select jsonb_build_object('id',j.id,'email',j.email,'planId',e.id,'eventName',e.name,'organiser',coalesce(p.name,'Your organiser')) from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id left join public.prod_profiles p on p.user_id=e.owner_id where m.id=j.member_id);
end $$;
create or replace function public.prod_email_result(p_id uuid,p_status text,p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('accepted','failed','unknown') then raise exception 'Invalid delivery result';end if;
 update public.prod_email_jobs set status=p_status,error_code=p_error where id=p_id and status='claimed';
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prod_contact_access(text,text,jsonb),public.prod_invites_queue(uuid,uuid,boolean,boolean),public.prod_email_claim(integer),public.prod_email_result(uuid,text,text) from public,anon,authenticated;
grant execute on function public.prod_contact_access(text,text,jsonb),public.prod_invites_queue(uuid,uuid,boolean,boolean),public.prod_email_claim(integer),public.prod_email_result(uuid,text,text) to service_role;
commit;
