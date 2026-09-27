-- Apply after 04_prod_registration.sql, before deploying the matching Worker.
begin;
select pg_advisory_xact_lock(7191901);
alter table public.prod_profiles add column if not exists terms_version text;
alter table public.prod_profiles add column if not exists terms_accepted_at timestamptz;
create or replace function public.prod_profile(p_user uuid,p_save boolean default false,p_profile jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare em text; profile jsonb; age text;
begin
 select lower(email) into em from auth.users where id=p_user and email_confirmed_at is not null;
 if em is null then raise insufficient_privilege; end if;
 if p_save then
  age:=p_profile->>'ageRange';
  if age not in ('18–24','25–34','35–44','45–54','55–64','65+') or age is null then raise exception 'You must be 18 or over'; end if;
  if p_profile->>'termsVersion' <> '2026-09-27' or p_profile->>'termsAccepted' <> 'true' then raise exception 'Terms acceptance required'; end if;
  insert into public.prod_profiles(user_id,name,sex,age_range,terms_version,terms_accepted_at)
   values(p_user,trim(p_profile->>'name'),p_profile->>'sex',age,'2026-09-27',now())
   on conflict(user_id) do update set name=excluded.name,sex=excluded.sex,age_range=excluded.age_range,
    terms_version=coalesce(public.prod_profiles.terms_version,excluded.terms_version),
    terms_accepted_at=coalesce(public.prod_profiles.terms_accepted_at,excluded.terms_accepted_at);
  insert into public.dateeye_admins(user_id,email) values(p_user,em)
   on conflict(user_id) do update set email=excluded.email;
 end if;
 select jsonb_build_object('name',name,'sex',sex,'ageRange',age_range) into profile from public.prod_profiles where user_id=p_user;
 return jsonb_build_object('email',em,'profile',profile,'termsVersion',(select terms_version from public.prod_profiles where user_id=p_user));
end $$;
revoke all on function public.prod_profile(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.prod_profile(uuid,boolean,jsonb) to service_role;
create or replace function public.prod_accept_terms(p_user uuid,p_version text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_version <> '2026-09-27' then raise exception 'Terms version not recognised'; end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise insufficient_privilege;end if;
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
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise insufficient_privilege;end if;
 -- The organiser's plans, member rows and availability cascade together.
 delete from public.dateeye_legacy_plan where event_id in (select id from public.dateeye_events where owner_id=p_user);
 delete from public.dateeye_events where owner_id=p_user;
 delete from public.prod_profiles where user_id=p_user;
 delete from public.dateeye_admins where user_id=p_user;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.prod_delete_account(uuid) from public,anon,authenticated;
grant execute on function public.prod_delete_account(uuid) to service_role;
commit;
