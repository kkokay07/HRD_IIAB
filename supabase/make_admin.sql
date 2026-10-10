-- Run AFTER you have registered on the site with kkokay07@gmail.com
insert into public.admins (user_id)
select id from auth.users where email = 'kkokay07@gmail.com'
on conflict do nothing;
