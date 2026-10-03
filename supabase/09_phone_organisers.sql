-- Apply after 08_daily_reporting.sql and before deploying phone organiser sign-in.
-- Existing account IDs, event ownership and email invitation addresses are preserved.
begin;
select pg_advisory_xact_lock(7191901);
alter table public.dateeye_admins alter column email drop not null;
grant select(id,email,email_confirmed_at,phone,phone_confirmed_at) on auth.users to service_role;
create or replace function public.prod_profile(p_user uuid,p_save boolean default false,p_profile jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare em text; ph text; profile jsonb; age text;
begin
 select case when email_confirmed_at is not null then nullif(lower(email),'') end,
 case when phone_confirmed_at is not null then '+'||ltrim(phone,'+') end into em,ph
 from auth.users where id=p_user;
 if em is null and ph is null then raise insufficient_privilege; end if;
 if p_save then
  age:=p_profile->>'ageRange';
  if age not in ('18–24','25–34','35–44','45–54','55–64','65+') or age is null then raise exception 'You must be 18 or over'; end if;
  if p_profile->>'termsVersion' is distinct from '2026-09-27' or p_profile->>'termsAccepted' is distinct from 'true' then raise exception 'Terms acceptance required'; end if;
  insert into public.prod_profiles(user_id,name,sex,age_range,terms_version,terms_accepted_at)
   values(p_user,trim(p_profile->>'name'),p_profile->>'sex',age,'2026-09-27',now())
   on conflict(user_id) do update set name=excluded.name,sex=excluded.sex,age_range=excluded.age_range,
    terms_version=coalesce(public.prod_profiles.terms_version,excluded.terms_version),
    terms_accepted_at=coalesce(public.prod_profiles.terms_accepted_at,excluded.terms_accepted_at);
  insert into public.dateeye_admins(user_id,email) values(p_user,em)
   on conflict(user_id) do update set email=excluded.email;
 end if;
 select jsonb_build_object('name',name,'sex',sex,'ageRange',age_range) into profile from public.prod_profiles where user_id=p_user;
 return jsonb_build_object('email',em,'phone',ph,'profile',profile,'termsVersion',(select terms_version from public.prod_profiles where user_id=p_user));
end $$;
revoke all on function public.prod_profile(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.prod_profile(uuid,boolean,jsonb) to service_role;
create or replace function public.prod_accept_terms(p_user uuid,p_version text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_version <> '2026-09-27' then raise exception 'Terms version not recognised'; end if;
 if not exists(select 1 from auth.users where id=p_user and (email_confirmed_at is not null or phone_confirmed_at is not null)) then raise insufficient_privilege;end if;
 update public.prod_profiles set terms_version=p_version,terms_accepted_at=now()
 where user_id=p_user and age_range in ('18–24','25–34','35–44','45–54','55–64','65+');
 if not found then raise exception 'Adult registration required';end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prod_accept_terms(uuid,text) from public,anon,authenticated;
grant execute on function public.prod_accept_terms(uuid,text) to service_role;
grant delete on public.dateeye_legacy_plan to service_role;
create or replace function public.prod_delete_account(p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(7191901);
 if not exists(select 1 from auth.users where id=p_user and (email_confirmed_at is not null or phone_confirmed_at is not null)) then raise insufficient_privilege;end if;
 -- The organiser's plans, member rows and availability cascade together.
 delete from public.dateeye_legacy_plan where event_id in (select id from public.dateeye_events where owner_id=p_user);
 delete from public.dateeye_events where owner_id=p_user;
 delete from public.prod_profiles where user_id=p_user;
 delete from public.dateeye_admins where user_id=p_user;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prod_delete_account(uuid) from public,anon,authenticated;
grant execute on function public.prod_delete_account(uuid) to service_role;

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
  select exists(select 1 from public.dateeye_admins a join auth.users u on u.id=a.user_id where a.user_id=p_user and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) into admin;
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
  select m.id into own_id from public.dateeye_members m join auth.users u on u.id=p_user
   where m.active and m.event_id=ev.id and
   ((u.phone_confirmed_at is not null and m.phone='+'||ltrim(u.phone,'+')) or
    (u.email_confirmed_at is not null and m.email=lower(u.email)))
   order by (u.phone_confirmed_at is not null and m.phone='+'||ltrim(u.phone,'+')) desc nulls last,m.id limit 1;
 end if;
 if p_method='GET' then
  select jsonb_build_object(
   'event',case when ev.id is null then null else jsonb_build_object('id',ev.id,'name',ev.name,'startDate',ev.start_date,'endDate',ev.end_date,'archived',ev.archived) end,
   'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',1) order by name) from public.dateeye_members where active and event_id=ev.id),'[]'::jsonb),
   'managedMembers',case when admin then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'phone',phone,'notification',notification,'smsAllowed',exists(select 1 from public.prod_sms_permissions sp where sp.phone=dateeye_members.phone and sp.allowed and not sp.stopped),'smsStatus',(select j.status from public.prod_sms_jobs j where j.member_id=dateeye_members.id and j.phone=dateeye_members.phone and j.kind='invite' order by j.created_at desc limit 1),'active',case when active then 1 else 0 end,'linked',0) order by name) from public.dateeye_members where event_id=ev.id),'[]'::jsonb) else null end,
   'availability',coalesce((select jsonb_agg(jsonb_build_object('memberId',a.member_id,'date',a.date,'available',a.available)) from public.dateeye_availability a join public.dateeye_members m on m.id=a.member_id where m.active and m.event_id=ev.id and a.date between ev.start_date and ev.end_date),'[]'::jsonb),
   'viewer',jsonb_build_object('isAdmin',admin,'memberId',own_id,'email',coalesce(p_email,(select coalesce(case when phone_confirmed_at is not null then '+'||ltrim(phone,'+') end,lower(email)) from auth.users where id=p_user)))
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


revoke all on function public.dateeye_state_v3(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.dateeye_state_v3(text,jsonb,text,uuid) to service_role;
commit;
