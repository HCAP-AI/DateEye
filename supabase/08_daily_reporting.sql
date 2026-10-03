-- Aggregate reporting and invitation-email opt-outs. No outbound messages in SQL.
begin;
select pg_advisory_xact_lock(7191901);
create table if not exists public.prod_reporting_config(id boolean primary key default true check(id),started_at timestamptz not null default now());
insert into public.prod_reporting_config(id) values(true) on conflict do nothing;
create table if not exists public.prod_daily_metrics(day date not null,metric text not null,n bigint not null default 0,primary key(day,metric));
create table if not exists public.prod_daily_responders(day date not null,member_id uuid not null,primary key(day,member_id));
create table if not exists public.prod_email_optouts(email text primary key,created_at timestamptz not null default now());
create table if not exists public.prod_daily_reports(day date not null,test boolean not null default false,status text not null check(status in ('claimed','accepted','failed','unknown')),claimed_at timestamptz not null default now(),finished_at timestamptz,error_code text,primary key(day,test));
alter table public.prod_reporting_config enable row level security;
alter table public.prod_daily_metrics enable row level security;
alter table public.prod_daily_responders enable row level security;
alter table public.prod_email_optouts enable row level security;
alter table public.prod_daily_reports enable row level security;
revoke all on public.prod_reporting_config,public.prod_daily_metrics,public.prod_daily_responders,public.prod_email_optouts,public.prod_daily_reports from public,anon,authenticated;
grant all on public.prod_reporting_config,public.prod_daily_metrics,public.prod_daily_responders,public.prod_email_optouts,public.prod_daily_reports to service_role;
create or replace function public.prod_metric(p_metric text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_metric not in ('page_loads','registrations','events_created','sms_optouts','email_optouts','sms_invites_accepted','sms_reminders_accepted','sms_delivered','sms_failed','sms_unknown','email_accepted','email_failed','email_unknown','api_errors') then raise exception 'Invalid metric';end if;
 insert into public.prod_daily_metrics(day,metric,n) values((now() at time zone 'Europe/London')::date,p_metric,1) on conflict(day,metric) do update set n=public.prod_daily_metrics.n+1;
end $$;
create or replace function public.prod_activity_trigger() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='prod_profiles' then perform public.prod_metric('registrations');
 elsif tg_table_name='dateeye_events' then perform public.prod_metric('events_created');
 elsif tg_table_name='dateeye_availability' then
  if tg_op='INSERT' then insert into public.prod_daily_responders values((now() at time zone 'Europe/London')::date,new.member_id) on conflict do nothing;
  elsif new.available is distinct from old.available then insert into public.prod_daily_responders values((now() at time zone 'Europe/London')::date,new.member_id) on conflict do nothing;end if;
 elsif tg_table_name='prod_sms_permissions' then
  if tg_op='INSERT' then if new.stopped then perform public.prod_metric('sms_optouts');end if;
  elsif new.stopped and not old.stopped then perform public.prod_metric('sms_optouts');end if;
 elsif tg_table_name='prod_email_jobs' then
  if new.status is distinct from old.status and new.status in ('accepted','failed','unknown') then perform public.prod_metric('email_'||new.status);end if;
 elsif tg_table_name='prod_sms_jobs' then
  if new.status is distinct from old.status then
   if new.accepted_at is not null and old.accepted_at is null then perform public.prod_metric(case when new.kind='invite' then 'sms_invites_accepted' else 'sms_reminders_accepted' end);end if;
   if new.status in ('delivered','failed','unknown') then perform public.prod_metric('sms_'||new.status);end if;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists prod_activity on public.prod_profiles;
create trigger prod_activity after insert on public.prod_profiles for each row execute function public.prod_activity_trigger();
drop trigger if exists prod_activity on public.dateeye_events;
create trigger prod_activity after insert on public.dateeye_events for each row execute function public.prod_activity_trigger();
drop trigger if exists prod_activity on public.dateeye_availability;
create trigger prod_activity after insert or update on public.dateeye_availability for each row execute function public.prod_activity_trigger();
drop trigger if exists prod_activity on public.prod_sms_permissions;
create trigger prod_activity after insert or update on public.prod_sms_permissions for each row execute function public.prod_activity_trigger();
drop trigger if exists prod_activity on public.prod_sms_jobs;
create trigger prod_activity after update on public.prod_sms_jobs for each row execute function public.prod_activity_trigger();
drop trigger if exists prod_activity on public.prod_email_jobs;
create trigger prod_activity after update on public.prod_email_jobs for each row execute function public.prod_activity_trigger();
create or replace function public.prod_email_unsubscribe(p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare em text; changed integer;
begin
 perform pg_advisory_xact_lock(7191901);
 select email into em from public.prod_email_jobs where id=p_job;
 if em is null then raise exception 'This unsubscribe link is no longer available';end if;
 insert into public.prod_email_optouts(email) values(em) on conflict do nothing;
 get diagnostics changed=row_count;
 if changed>0 then perform public.prod_metric('email_optouts');end if;
 update public.prod_email_jobs set status='cancelled' where email=em and status='pending';
 return jsonb_build_object('ok',true);
end $$;
-- Skip suppressed addresses at claim time, including previously queued invitations.
create or replace function public.prod_email_claim(p_daily_limit integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.prod_email_jobs%rowtype;
begin
 perform pg_advisory_xact_lock(7191901);
 update public.prod_email_jobs set status='unknown',error_code='worker_interrupted' where status='claimed' and claimed_at<now()-interval '10 minutes';
 update public.prod_email_jobs q set status='cancelled' where q.status='pending' and (exists(select 1 from public.prod_email_optouts o where o.email=q.email) or not exists(select 1 from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id where m.id=q.member_id and m.email=q.email and m.active and not e.archived and e.end_date>=current_date));
 if p_daily_limit is null or p_daily_limit<1 or (select count(*) from public.prod_email_jobs where claimed_at>=date_trunc('day',now()))>=least(p_daily_limit,1000) then return null;end if;
 select * into j from public.prod_email_jobs where status='pending' order by created_at,id limit 1 for update skip locked;
 if j.id is null then return null;end if;
 update public.prod_email_jobs set status='claimed',claimed_at=now() where id=j.id;
 return (select jsonb_build_object('id',j.id,'email',j.email,'planId',e.id,'eventName',e.name,'organiser',coalesce(p.name,'Your organiser')) from public.dateeye_members m join public.dateeye_events e on e.id=m.event_id left join public.prod_profiles p on p.user_id=e.owner_id where m.id=j.member_id);
end $$;
create or replace function public.prod_report_claim(p_day date,p_test boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare started timestamptz; inserted integer; metrics jsonb;
begin
 perform pg_advisory_xact_lock(7191902);
 select started_at into started from public.prod_reporting_config where id;
 if p_day<(started at time zone 'Europe/London')::date or p_day>(now() at time zone 'Europe/London')::date or (not p_test and p_day>=(now() at time zone 'Europe/London')::date) then return null;end if;
 update public.prod_daily_reports set status='unknown',error_code='worker_interrupted' where status='claimed' and claimed_at<now()-interval '10 minutes';
 insert into public.prod_daily_reports(day,test,status) values(p_day,p_test,'claimed') on conflict do nothing;
 get diagnostics inserted=row_count;
 if inserted=0 then return null;end if;
 select coalesce(jsonb_object_agg(metric,n),'{}'::jsonb) into metrics from public.prod_daily_metrics where day=p_day;
 delete from public.prod_daily_responders where day<(now() at time zone 'Europe/London')::date-90;
 delete from public.prod_daily_metrics where day<(now() at time zone 'Europe/London')::date-400;
 return jsonb_build_object('day',p_day,'test',p_test,'startedAt',started,'partial',p_test or p_day=(started at time zone 'Europe/London')::date,'metrics',metrics,
 'responders',(select count(*) from public.prod_daily_responders where day=p_day),
 'totalUsers',(select count(*) from public.prod_profiles),'activeEvents',(select count(*) from public.dateeye_events where not archived and end_date>=(now() at time zone 'Europe/London')::date),
 'pendingSms',(select count(*) from public.prod_sms_jobs where status='pending' and due_at<now()-interval '15 minutes'),
 'pendingEmail',(select count(*) from public.prod_email_jobs where status='pending' and created_at<now()-interval '15 minutes'),
 'unknownSms',(select count(*) from public.prod_sms_jobs where status='unknown'),'unknownEmail',(select count(*) from public.prod_email_jobs where status='unknown'),
 'failedReports',(select count(*) from public.prod_daily_reports where status in ('failed','unknown')));
end $$;
create or replace function public.prod_report_result(p_day date,p_test boolean,p_status text,p_error text default null) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('accepted','failed','unknown') then raise exception 'Invalid status';end if;
 update public.prod_daily_reports set status=p_status,error_code=p_error,finished_at=now() where day=p_day and test=p_test and status='claimed';
end $$;
revoke all on function public.prod_metric(text),public.prod_activity_trigger(),public.prod_email_unsubscribe(uuid),public.prod_report_claim(date,boolean),public.prod_report_result(date,boolean,text,text) from public,anon,authenticated;
grant execute on function public.prod_metric(text),public.prod_activity_trigger(),public.prod_email_unsubscribe(uuid),public.prod_report_claim(date,boolean),public.prod_report_result(date,boolean,text,text) to service_role;
commit;
