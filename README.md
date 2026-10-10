# ICAR-IIAB HRD Internship & Dissertation Portal

Static website (GitHub Pages) + free Supabase backend + Gmail notifications. No SMS.

Live site (after setup): https://kkokay07.github.io/hrd_iiab/

## One-time setup checklist

### 1. Supabase (already created: `tnjsjezrwqqrluaiixxn`)
1. Open the project -> **SQL Editor -> New query**, paste all of `supabase/schema.sql`, click **Run**.
2. **Project Settings -> API**: copy the **anon public** key and paste it into `js/config.js` (`SUPABASE_ANON_KEY`). Never use the `service_role` key.
3. **Authentication -> URL Configuration**: set *Site URL* to `https://kkokay07.github.io/hrd_iiab/`.
4. Sign-up e-mails: Supabase's built-in mailer only sends a few e-mails per hour. Go to **Authentication -> SMTP Settings**, enable custom SMTP:
   host `smtp.gmail.com`, port `587`, user `kkokay07@gmail.com`, password = a Gmail **App Password**
   (Google Account -> Security -> 2-Step Verification -> App passwords).
5. Open the live site, register with kkokay07@gmail.com, then run `supabase/make_admin.sql` in the SQL Editor. An **Admin** link appears.
6. In **Admin -> Manage guides**, add the scientists from https://iiab.icar.gov.in/staff/scientific.php (name, photo URL, description, profile link).

### 2. E-mail notifications (Gmail, free)
1. Go to script.google.com -> New project, paste `apps-script/Code.gs`, set `SECRET` to a long random string.
2. **Deploy -> New deployment -> Web app**: Execute as *Me*, access *Anyone*. Authorize, copy the Web app URL.
3. Edit `supabase/mail_settings.sql` with that URL and the same secret, run it in the SQL Editor.

E-mails sent: you on every final submission (and fee/report uploads); students on submission, screening, approval letter, rejection, certificate.

### 3. GitHub Pages
Repo **Settings -> Pages -> Source: GitHub Actions**, then merge/push to `main`. The *Keep Supabase awake* workflow pings the database every 3 days so the free project is not paused.

## Rules enforced in the database
- A guide can have at most 2 active students (approved/joined and end date not passed); then they show as available again.
- Final submit needs all details, documents, fee proof and 3 different available guides.
- Students cannot change status, guide, dates, approval letter, fee verification or certificate.
- Files are private (signed links only), max 5 MB, PDF/JPG/PNG.
