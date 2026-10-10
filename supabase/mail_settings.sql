-- Run AFTER deploying the Apps Script. Replace both values.
insert into public.app_settings (key, value) values
  ('mail_url',    'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE'),
  ('mail_secret', 'PASTE_THE_SAME_SECRET_YOU_PUT_IN_THE_SCRIPT')
on conflict (key) do update set value = excluded.value;
