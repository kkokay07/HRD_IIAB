-- HRD IIAB internship portal: run this whole file once in Supabase -> SQL Editor.
create extension if not exists pg_net with schema extensions;

-- ---------- tables ----------
create table if not exists public.admins (user_id uuid primary key references auth.users(id) on delete cascade);

create table if not exists public.app_settings (key text primary key, value text not null);
alter table public.app_settings enable row level security;   -- no policies: only server functions read it

create table if not exists public.faculty (
  id serial primary key,
  name text not null,
  designation text,
  photo_url text,
  description text,
  profile_url text,
  active boolean not null default true
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  purpose text check (purpose in ('internship','dissertation')),
  name text, father_name text, mother_name text, mobile text,
  category text,                      -- General/EWS/SC/ST/OBC
  gender text,
  outside_nars boolean default true,
  institute text, course text, education jsonb default '[]'::jsonb,
  present_address text, permanent_address text, same_address boolean default false,
  recommender_name text, recommender_designation text,
  duration_months int check (duration_months >= 3),
  photo_path text, id_card_path text, recommendation_path text, resume_path text,
  fee_amount numeric, fee_txn_id text, fee_date date, fee_proof_path text,
  pref1 int references public.faculty(id), pref2 int references public.faculty(id), pref3 int references public.faculty(id),
  status text not null default 'draft'
    check (status in ('draft','submitted','under_screening','approved','rejected','joined','completed')),
  submitted_at timestamptz,
  admin_notes text,
  approval_letter_path text,
  assigned_faculty int references public.faculty(id),
  joining_date date, end_date date,
  bench_fee_amount numeric, bench_txn_id text, bench_fee_date date, bench_proof_path text,
  concession_claimed boolean default false, concession_doc_path text,
  bench_fee_verified boolean not null default false,
  report_path text,
  certificate_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- helpers ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;

-- a student counts as "active" with a guide from approval until the internship end date
create or replace function public.faculty_load()
returns table (faculty_id int, active_students int)
language sql stable security definer set search_path = public as
$$ select f.id, count(a.id)::int
   from public.faculty f
   left join public.applications a on a.assigned_faculty = f.id
     and a.status in ('approved','joined')
     and (a.end_date is null or a.end_date >= current_date)
   where f.active group by f.id $$;

create or replace function public.load_of(fid int, except_app uuid default null) returns int
language sql stable security definer set search_path = public as
$$ select count(*)::int from public.applications a
   where a.assigned_faculty = fid and a.status in ('approved','joined')
     and (a.end_date is null or a.end_date >= current_date)
     and (except_app is null or a.id <> except_app) $$;

grant execute on function public.faculty_load() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- guard rules ----------
create or replace function public.guard_application() returns trigger
language plpgsql security definer set search_path = public as $$
declare p int;
begin
  new.updated_at := now();
  if new.assigned_faculty is not null and
     (tg_op = 'INSERT' or new.assigned_faculty is distinct from old.assigned_faculty
      or new.status is distinct from old.status or new.end_date is distinct from old.end_date)
     and new.status in ('approved','joined')
     and public.load_of(new.assigned_faculty, new.id) >= 2 then
    raise exception 'This guide already has 2 active students.';
  end if;

  if public.is_admin() then return new; end if;

  if tg_op = 'INSERT' then
    new.status := 'draft'; new.approval_letter_path := null; new.assigned_faculty := null;
    new.admin_notes := null; new.certificate_path := null; new.bench_fee_verified := false;
    new.joining_date := null; new.end_date := null; new.submitted_at := null;
    return new;
  end if;

  -- students may never touch these
  new.assigned_faculty := old.assigned_faculty; new.approval_letter_path := old.approval_letter_path;
  new.admin_notes := old.admin_notes; new.certificate_path := old.certificate_path;
  new.bench_fee_verified := old.bench_fee_verified; new.joining_date := old.joining_date;
  new.end_date := old.end_date; new.submitted_at := old.submitted_at; new.user_id := old.user_id;
  new.email := old.email;

  if old.status = 'draft' then
    if new.status not in ('draft','submitted') then new.status := 'draft'; end if;
    if new.status = 'submitted' then
      if new.name is null or new.father_name is null or new.mother_name is null or new.mobile is null
         or new.photo_path is null or new.id_card_path is null or new.recommendation_path is null
         or new.resume_path is null or new.fee_proof_path is null or new.fee_txn_id is null
         or new.duration_months is null or new.present_address is null or new.permanent_address is null
         or new.pref1 is null or new.pref2 is null or new.pref3 is null then
        raise exception 'Please complete all sections before final submit.';
      end if;
      if new.pref1 = new.pref2 or new.pref1 = new.pref3 or new.pref2 = new.pref3 then
        raise exception 'Choose three different guides.';
      end if;
      foreach p in array array[new.pref1,new.pref2,new.pref3] loop
        if public.load_of(p) >= 2 then
          raise exception 'A chosen guide already has 2 students. Please choose another.';
        end if;
      end loop;
      new.submitted_at := now();
    end if;
  else
    -- after submission the student can only add post-selection fee / report data
    new.status := old.status;
    new.name := old.name; new.father_name := old.father_name; new.mother_name := old.mother_name;
    new.mobile := old.mobile; new.pref1 := old.pref1; new.pref2 := old.pref2; new.pref3 := old.pref3;
    new.duration_months := old.duration_months; new.fee_proof_path := old.fee_proof_path;
    new.id_card_path := old.id_card_path; new.photo_path := old.photo_path;
    new.resume_path := old.resume_path; new.recommendation_path := old.recommendation_path;
    if old.status not in ('joined','completed') then
      new.bench_fee_amount := old.bench_fee_amount; new.bench_txn_id := old.bench_txn_id;
      new.bench_fee_date := old.bench_fee_date; new.bench_proof_path := old.bench_proof_path;
      new.concession_claimed := old.concession_claimed; new.concession_doc_path := old.concession_doc_path;
      new.report_path := old.report_path;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard on public.applications;
create trigger trg_guard before insert or update on public.applications
  for each row execute function public.guard_application();

-- ---------- e-mail notifications (via the Apps Script web app) ----------
create or replace function public.notify() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare url text; sec text; ev text;
begin
  select value into url from public.app_settings where key = 'mail_url';
  select value into sec from public.app_settings where key = 'mail_secret';
  if url is null or sec is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.status = 'submitted' and old.status = 'draft' then ev := 'submitted';
    elsif new.approval_letter_path is not null and old.approval_letter_path is null then ev := 'approval_letter';
    elsif new.status = 'rejected' and old.status <> 'rejected' then ev := 'rejected';
    elsif new.status = 'under_screening' and old.status <> 'under_screening' then ev := 'under_screening';
    elsif new.certificate_path is not null and old.certificate_path is null then ev := 'certificate';
    elsif new.report_path is not null and old.report_path is null then ev := 'report_submitted';
    elsif new.bench_proof_path is not null and old.bench_proof_path is null then ev := 'bench_fee_submitted';
    end if;
  end if;
  if ev is not null then
    perform net.http_post(url := url,
      body := jsonb_build_object('secret', sec, 'event', ev, 'name', new.name, 'email', new.email,
                                 'mobile', new.mobile, 'purpose', new.purpose, 'months', new.duration_months),
      headers := '{"Content-Type":"application/json"}'::jsonb);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify on public.applications;
create trigger trg_notify after update on public.applications
  for each row execute function public.notify();

-- ---------- row level security ----------
alter table public.applications enable row level security;
alter table public.faculty enable row level security;
alter table public.admins enable row level security;

drop policy if exists app_select on public.applications;
create policy app_select on public.applications for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists app_insert on public.applications;
create policy app_insert on public.applications for insert with check (user_id = auth.uid());
drop policy if exists app_update on public.applications;
create policy app_update on public.applications for update using (user_id = auth.uid() or public.is_admin());

drop policy if exists fac_select on public.faculty;
create policy fac_select on public.faculty for select using (true);
drop policy if exists fac_write on public.faculty;
create policy fac_write on public.faculty for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists adm_self on public.admins;
create policy adm_self on public.admins for select using (user_id = auth.uid());

-- ---------- private file storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs','docs',false,5242880, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set file_size_limit = 5242880,
  allowed_mime_types = array['application/pdf','image/jpeg','image/png'];

drop policy if exists docs_select on storage.objects;
create policy docs_select on storage.objects for select to authenticated
  using (bucket_id = 'docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists docs_insert on storage.objects;
create policy docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists docs_update on storage.objects;
create policy docs_update on storage.objects for update to authenticated
  using (bucket_id = 'docs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists docs_delete on storage.objects;
create policy docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and public.is_admin());
