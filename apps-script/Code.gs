// HRD IIAB mailer. Deploy as Web app: Execute as "Me", access "Anyone".
// Change SECRET to a long random string and use the same value in supabase/mail_settings.sql.
const SECRET = 'CHANGE_ME_TO_A_LONG_RANDOM_STRING';
const ADMIN_EMAIL = 'kkokay07@gmail.com';
const SITE = 'https://kkokay07.github.io/hrd_iiab/';

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return out('bad request'); }
  if (d.secret !== SECRET) return out('forbidden');
  const n = d.name || 'Applicant';
  const track = '\n\nTrack your application: ' + SITE;
  const sign = '\n\nHRD Section, ICAR-IIAB, Ranchi';
  const M = {
    submitted: {
      admin: ['New HRD application submitted: ' + n,
        n + ' has submitted a final application.\nPurpose: ' + d.purpose + '\nDuration: ' + d.months +
        ' months\nEmail: ' + d.email + '\nMobile: ' + d.mobile + '\n\nOpen the admin panel: ' + SITE + '#/admin'],
      student: ['Application received - ICAR-IIAB HRD',
        'Dear ' + n + ',\n\nYour application has been submitted and will be reviewed by the screening committee.' + track + sign]
    },
    under_screening: { student: ['Your application is under screening',
        'Dear ' + n + ',\n\nYour application is now under review by the screening committee.' + track + sign] },
    approval_letter: { student: ['Approval letter issued - ICAR-IIAB',
        'Dear ' + n + ',\n\nYour approval letter has been uploaded. Please log in to download it and read the joining and fee instructions.' + track + sign] },
    rejected: { student: ['Application update - ICAR-IIAB HRD',
        'Dear ' + n + ',\n\nWe regret that your application could not be considered. Your Rs 1000 application fee will be refunded. Log in for details.' + track + sign] },
    bench_fee_submitted: { admin: ['Bench fee proof uploaded: ' + n, n + ' uploaded bench fee details. Please verify.\n' + SITE + '#/admin'] },
    report_submitted: { admin: ['Internship report uploaded: ' + n, n + ' uploaded the internship report.\n' + SITE + '#/admin'] },
    certificate: { student: ['Certificate issued - ICAR-IIAB',
        'Dear ' + n + ',\n\nYour certificate has been uploaded. Log in to download it.' + track + sign] }
  };
  const m = M[d.event];
  if (!m) return out('unknown event');
  if (m.admin) MailApp.sendEmail(ADMIN_EMAIL, m.admin[0], m.admin[1]);
  if (m.student && d.email) MailApp.sendEmail(d.email, m.student[0], m.student[1]);
  return out('ok');
}
function out(s) { return ContentService.createTextOutput(s); }
