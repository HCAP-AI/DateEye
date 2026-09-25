-- Run after 03_multi_plan.sql, BEFORE deploying the prod. app.
-- Preserves existing owners, plan IDs, members and responses.
begin;
select pg_advisory_xact_lock(7191901);
create table if not exists public.prod_profiles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 80),
 sex text not null check(sex in ('Female','Male','Intersex','Prefer not to say')),
 age_range text not null check(age_range in ('Under 18','18–24','25–34','35–44','45–54','55–64','65+','Prefer not to say')),
 created_at timestamptz not null default now()
);
alter table public.prod_profiles enable row level security;
revoke all on public.prod_profiles from public,anon,authenticated;
grant all on public.prod_profiles to service_role;
grant usage on schema auth to service_role;
grant select(id,email,email_confirmed_at) on auth.users to service_role;
create or replace function public.prod_profile(p_user uuid,p_save boolean default false,p_profile jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare em text; profile jsonb;
begin
 select lower(email) into em from auth.users where id=p_user and email_confirmed_at is not null;
 if em is null then raise insufficient_privilege; end if;
 if p_save then
  insert into public.prod_profiles(user_id,name,sex,age_range)
   values(p_user,trim(p_profile->>'name'),p_profile->>'sex',p_profile->>'ageRange')
   on conflict(user_id) do update set name=excluded.name,sex=excluded.sex,age_range=excluded.age_range;
  insert into public.dateeye_admins(user_id,email) values(p_user,em)
   on conflict(user_id) do update set email=excluded.email;
 end if;
 select jsonb_build_object('name',name,'sex',sex,'ageRange',age_range) into profile from public.prod_profiles where user_id=p_user;
 return jsonb_build_object('email',em,'profile',profile);
end $$;
revoke all on function public.prod_profile(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.prod_profile(uuid,boolean,jsonb) to service_role;
-- Preserve the existing multi-plan implementation; add a registration gate.
do $$ begin
 if to_regprocedure('public.dateeye_state_v3(text,jsonb,text,uuid)') is null then
  alter function public.dateeye_state(text,jsonb,text,uuid) rename to dateeye_state_v3;
 end if;
end $$;
create or replace function public.dateeye_state(p_method text,p_body jsonb,p_email text default null,p_user uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_method='POST' and p_email is null and not exists(select 1 from public.prod_profiles where user_id=p_user) then
  raise exception 'Complete your registration before creating an event';
 end if;
 return public.dateeye_state_v3(p_method,p_body,p_email,p_user);
end $$;
revoke all on function public.dateeye_state(text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.dateeye_state(text,jsonb,text,uuid) to service_role;
-- Email-only pilot entry: returns only matching active invitations.
create or replace function public.prod_invitations(p_email text)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('plans',coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name) order by e.start_date),'[]'::jsonb))
 from public.dateeye_events e join public.dateeye_members m on m.event_id=e.id
 where m.email=lower(trim(p_email)) and m.active and not e.archived;
$$;
revoke all on function public.prod_invitations(text) from public,anon,authenticated;
grant execute on function public.prod_invitations(text) to service_role;
commit;
