-- FIRST create and confirm office@hound-capital.com in Authentication > Users.
-- Password is set there, never in SQL, source code or GitHub.
do $$
declare admin_id uuid;
begin
 select id into admin_id from auth.users where lower(email)='office@hound-capital.com' and email_confirmed_at is not null;
 if admin_id is null then raise exception 'Create and confirm office@hound-capital.com under Authentication > Users first';end if;
 insert into public.dateeye_admins(user_id,email) values(admin_id,'office@hound-capital.com') on conflict do nothing;
end $$;
