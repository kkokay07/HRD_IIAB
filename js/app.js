import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const root = document.getElementById('app');
const nav = document.getElementById('nav');
const st = { user: null, admin: false, app: null, faculty: [], load: {} };

const BANK = { name: 'ICAR unit IIAB', acc: '32656656980', ifsc: 'SBIN0009011', branch: 'SBI (09011) Namkum - 834010, Ranchi' };
const STATUS = {
  draft: 'Draft (not submitted)', submitted: 'Submitted - awaiting screening', under_screening: 'Under screening',
  approved: 'Approved - approval letter issued', rejected: 'Not selected', joined: 'Joined', completed: 'Completed'
};
const CATS = ['General', 'EWS', 'SC', 'ST', 'OBC'];

// ---------- utilities ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
let toastTimer;
function toast(msg, bad) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.background = bad ? '#b3261e' : '#222'; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4500);
}
const errMsg = (e) => (e && (e.message || e.error_description)) || String(e);
function collect(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach((f) => {
    if (f.type === 'radio') { if (f.checked) o[f.name] = f.value; return; }
    if (f.type === 'checkbox') o[f.name] = f.checked;
    else if (f.type === 'number') o[f.name] = f.value === '' ? null : Number(f.value);
    else o[f.name] = f.value.trim() === '' ? null : f.value.trim();
  });
  return o;
}
function keepScroll(fn) { const y = window.scrollY; return Promise.resolve(fn()).then(() => window.scrollTo(0, y)); }

function benchFee(months, category, gender, outsideNars) {
  if (!months) return { base: null, final: null, concession: false };
  const base = months <= 3 ? 20000 : months <= 6 ? 30000 : null;
  const elig = !!outsideNars && (['EWS', 'SC', 'ST', 'OBC'].includes(category) || gender === 'Female');
  return { base, final: base && elig ? base / 2 : base, concession: elig };
}

// ---------- files ----------
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('Could not read image'));
    img.src = URL.createObjectURL(file);
  });
}
async function uploadFile(uid, kind, file, { imageOnly = false, pdfOnly = false } = {}) {
  if (!file) return null;
  const isImg = /^image\/(jpeg|png)$/.test(file.type), isPdf = file.type === 'application/pdf';
  if (imageOnly && !isImg) throw new Error('Please upload a JPG or PNG image.');
  if (pdfOnly && !isPdf) throw new Error('Please upload a PDF file.');
  if (!isImg && !isPdf) throw new Error('Only PDF, JPG or PNG files are allowed.');
  let body = file, ext = isPdf ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg', type = file.type;
  if (isImg) { body = await compressImage(file, kind === 'photo' ? 600 : 1600, 0.82); ext = 'jpg'; type = 'image/jpeg'; }
  if (body.size > 5 * 1024 * 1024) throw new Error('File is larger than 5 MB.');
  const path = `${uid}/${kind}.${ext}`;
  const { error } = await sb.storage.from('docs').upload(path, body, { upsert: true, contentType: type });
  if (error) throw error;
  return path;
}
async function signedUrl(path) {
  const { data, error } = await sb.storage.from('docs').createSignedUrl(path, 600);
  if (error) throw error;
  return data.signedUrl;
}
const fileLink = (path, label) => path
  ? `<a href="#" data-open="${esc(path)}">${esc(label)}</a>` : `<span class="mut">${esc(label)}: not uploaded</span>`;

document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-open]');
  if (!a) return;
  e.preventDefault();
  try { window.open(await signedUrl(a.dataset.open), '_blank', 'noopener'); } catch (x) { toast(errMsg(x), true); }
});
async function fillImgs() {
  for (const img of root.querySelectorAll('img[data-path]')) {
    try { img.src = await signedUrl(img.dataset.path); } catch { /* ignore */ }
  }
}

// ---------- data ----------
async function loadFaculty() {
  const [f, l] = await Promise.all([
    sb.from('faculty').select('*').eq('active', true).order('name'),
    sb.rpc('faculty_load')
  ]);
  st.faculty = f.data || [];
  st.load = {};
  (l.data || []).forEach((r) => { st.load[r.faculty_id] = r.active_students; });
}
const isFull = (id) => (st.load[id] || 0) >= 2;
const facName = (id) => st.faculty.find((f) => f.id === id)?.name || '-';

async function loadMyApp() {
  const { data, error } = await sb.from('applications').select('*').eq('user_id', st.user.id).maybeSingle();
  if (error) throw error;
  if (data) { st.app = data; return; }
  const ins = await sb.from('applications').insert({ user_id: st.user.id, email: st.user.email }).select().single();
  if (ins.error) throw ins.error;
  st.app = ins.data;
}
async function saveApp(patch, okMsg = 'Saved') {
  const { data, error } = await sb.from('applications').update(patch).eq('id', st.app.id).select().single();
  if (error) { toast(errMsg(error), true); return false; }
  st.app = data; toast(okMsg); return true;
}

// ---------- shell ----------
function renderNav() {
  const links = ['<a href="#/">Home</a>', '<a href="#/guides">Guides</a>'];
  if (st.user) {
    links.push('<a href="#/apply">My application</a>');
    if (st.admin) links.push('<a href="#/admin">Admin</a>');
    links.push('<button id="logout">Logout</button>');
  } else links.push('<a href="#/login">Login / Register</a>');
  nav.innerHTML = links.join('');
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async () => { await sb.auth.signOut(); location.hash = '#/'; };
}

async function route() {
  renderNav();
  const [, page = '', arg] = (location.hash || '#/').slice(1).split('/');
  try {
    if (page === '' ) return pageHome();
    if (page === 'guides') return await pageGuides();
    if (page === 'login') return pageLogin();
    if (page === 'apply') return st.user ? await pageApply() : (location.hash = '#/login');
    if (page === 'admin') {
      if (!st.admin) { root.innerHTML = '<div class="card">Admin access only.</div>'; return; }
      if (arg === 'faculty') return await pageAdminFaculty();
      return arg ? await pageAdminDetail(arg) : await pageAdminList();
    }
    root.innerHTML = '<div class="card">Page not found.</div>';
  } catch (e) { root.innerHTML = `<div class="card warn">Error: ${esc(errMsg(e))}</div>`; }
}

// ---------- public pages ----------
function bankBox() {
  return `<div class="bank"><b>Bank details for payments</b><br>Account name: ${BANK.name}<br>Account number: <b>${BANK.acc}</b><br>
  IFSC: <b>${BANK.ifsc}</b><br>Branch: ${BANK.branch}</div>`;
}
function pageHome() {
  root.innerHTML = `
  <h1>Internship &amp; Dissertation at ICAR-IIAB</h1>
  <div class="card"><p>Students who wish to do an <b>internship</b> or <b>dissertation / thesis research</b> at the ICAR - Indian Institute of
  Agricultural Biotechnology, Ranchi, can register and apply here.</p>
  <a class="btn" href="#/${st.user ? 'apply' : 'login'}">${st.user ? 'Go to my application' : 'Register / Login to apply'}</a>
  <a class="btn alt" href="#/guides">See available guides</a></div>
  <div class="card"><h2>How it works</h2><ol class="steps">
   <li>Register and fill your personal and educational details, then upload your photo, college ID card, recommendation letter and a 2-page resume.</li>
   <li>Choose duration: 3 months, 6 months, or a custom period of more than 3 months.</li>
   <li>Pay the <b>Rs 1000</b> application fee and upload the proof. It is adjusted against the bench fee for selected candidates and refunded to non-selected candidates.</li>
   <li>Choose <b>three guide preferences</b>. Each guide can supervise only 2 HRD students at a time.</li>
   <li>Final submit. The screening committee reviews your application and an approval letter is uploaded here; you are notified by e-mail.</li>
   <li>Within one month of joining, pay the bench fee and upload proof. After the internship, upload your report (PDF, max 5 MB) to claim the certificate.</li></ol></div>
  <div class="card"><h2>Bench fee after selection</h2>
  <table><tr><th>Training duration</th><th>Fee (INR)</th></tr>
  <tr><td>Short-term (3 months)</td><td>20,000</td></tr><tr><td>Long-term (more than 3 months, up to 6 months)</td><td>30,000</td></tr></table>
  <p class="mut">As per ICAR O.M. (F.No. Agrl Edn. 2(8)/2019-HRD dated 17 June 2020), 50% concession is allowed in bench fees for SRF/JRF students from outside the
  National Agricultural Research System (NARS) belonging to EWS, SC, ST, OBC and Women categories. Upload supporting documents to claim it.</p>
  ${bankBox()}</div>`;
}

function facCard(f, extra = '') {
  const n = st.load[f.id] || 0, full = n >= 2;
  return `<div class="card fac"><img src="${esc(f.photo_url || '')}" alt="" onerror="this.style.visibility='hidden'">
  <div><h3>${esc(f.name)}</h3><div class="mut">${esc(f.designation || '')}</div>
  <p>${esc(f.description || '')}</p>
  <span class="pill ${full ? 'full' : ''}">${full ? 'Not available' : 'Available'} &middot; ${n}/2 HRD students</span>
  ${f.profile_url ? ` &nbsp;<a href="${esc(f.profile_url)}" target="_blank" rel="noopener">IIAB profile</a>` : ''} ${extra}</div></div>`;
}
async function pageGuides() {
  await loadFaculty();
  root.innerHTML = `<h1>Scientists / Guides</h1><p class="mut">Each guide can have only 2 HRD students at a time. A guide becomes available again once the students' internship period is over.
  Full list: <a href="https://iiab.icar.gov.in/staff/scientific.php" target="_blank" rel="noopener">iiab.icar.gov.in/staff/scientific.php</a></p>
  ${st.faculty.length ? st.faculty.map((f) => facCard(f)).join('') : '<div class="card">Guide list will be published shortly.</div>'}`;
}

// ---------- auth ----------
function pageLogin() {
  root.innerHTML = `<h1>Login / Register</h1><div class="grid2">
  <form class="card" id="fLogin"><h2>Login</h2><label>E-mail</label><input name="email" type="email" required>
   <label>Password</label><input name="password" type="password" required><p><button class="btn">Login</button></p>
   <p><a href="#" id="forgot">Forgot password?</a></p></form>
  <form class="card" id="fReg"><h2>New student? Register</h2><label>E-mail (notifications are sent here)</label><input name="email" type="email" required>
   <label>Password (min 8 characters)</label><input name="password" type="password" minlength="8" required>
   <p><button class="btn">Create account</button></p></form></div>`;
  document.getElementById('fLogin').onsubmit = async (e) => {
    e.preventDefault(); const v = collect(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: v.email, password: v.password });
    if (error) toast(error.message, true); else location.hash = '#/apply';
  };
  document.getElementById('fReg').onsubmit = async (e) => {
    e.preventDefault(); const v = collect(e.target);
    const { data, error } = await sb.auth.signUp({ email: v.email, password: v.password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) return toast(error.message, true);
    if (data.session) location.hash = '#/apply'; else toast('Account created. Check your e-mail to confirm, then log in.');
  };
  document.getElementById('forgot').onclick = async (e) => {
    e.preventDefault();
    const email = document.querySelector('#fLogin [name=email]').value.trim();
    if (!email) return toast('Type your e-mail in the login box first.', true);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    toast(error ? error.message : 'Password reset link sent to your e-mail.', !!error);
  };
}
function pageNewPassword() {
  root.innerHTML = `<h1>Set a new password</h1><form class="card" id="fNew"><label>New password</label>
  <input name="password" type="password" minlength="8" required><p><button class="btn">Save</button></p></form>`;
  document.getElementById('fNew').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: collect(e.target).password });
    if (error) toast(error.message, true); else { toast('Password updated'); location.hash = '#/apply'; }
  };
}

// ---------- student application ----------
function eduRow(r = {}, i = 0) {
  return `<div class="row" data-edu="${i}"><div><label>Degree / exam</label><input data-k="degree" value="${esc(r.degree)}"></div>
  <div><label>Institute / board</label><input data-k="institute" value="${esc(r.institute)}"></div>
  <div><label>Year</label><input data-k="year" value="${esc(r.year)}"></div>
  <div><label>% / CGPA</label><input data-k="score" value="${esc(r.score)}"></div>
  <button type="button" class="btn alt" data-rm-edu="${i}">Remove</button></div>`;
}
function readEdu() {
  return [...root.querySelectorAll('[data-edu]')].map((row) => {
    const o = {}; row.querySelectorAll('[data-k]').forEach((i) => { o[i.dataset.k] = i.value.trim(); }); return o;
  }).filter((o) => Object.values(o).some(Boolean));
}
function uploadField(label, kind, col, opts, help = '') {
  const a = st.app;
  return `<div><label>${label}</label><input type="file" data-up="${kind}" data-col="${col}" data-opts='${JSON.stringify(opts)}' accept="${opts.imageOnly ? 'image/jpeg,image/png' : opts.pdfOnly ? 'application/pdf' : 'application/pdf,image/jpeg,image/png'}">
  <div class="mut">${help}</div><div>${a[col] ? '<span class="ok">Uploaded</span> - ' + fileLink(a[col], 'view') : ''}</div></div>`;
}
function checklist(a) {
  const prefsOk = a.pref1 && a.pref2 && a.pref3;
  return [
    ['Personal and address details', a.name && a.father_name && a.mother_name && a.mobile && a.present_address && a.permanent_address],
    ['Passport photo, ID card, recommendation letter, resume', a.photo_path && a.id_card_path && a.recommendation_path && a.resume_path],
    ['Duration chosen and Rs 1000 fee proof uploaded', a.duration_months && a.fee_proof_path && a.fee_txn_id],
    ['Three guide preferences chosen', prefsOk]
  ];
}

async function pageApply() {
  await Promise.all([loadMyApp(), loadFaculty()]);
  const a = st.app;
  if (a.status !== 'draft') return renderStatus();
  const edu = a.education?.length ? a.education : [{}];
  const dur = a.duration_months;
  const preset = dur === 3 ? '3' : dur === 6 ? '6' : dur ? 'custom' : '';
  const fee = benchFee(dur, a.category, a.gender, a.outside_nars);
  const checks = checklist(a);
  const allDone = checks.every((c) => c[1]);
  const opts = (sel, skip) => `<option value="">- select -</option>` + st.faculty.map((f) =>
    `<option value="${f.id}" ${sel === f.id ? 'selected' : ''} ${isFull(f.id) && sel !== f.id ? 'disabled' : ''}>${esc(f.name)}${isFull(f.id) ? ' (full)' : ''}</option>`).join('');

  root.innerHTML = `<h1>My application</h1>
  <p class="mut">Logged in as ${esc(a.email)}. Save each section; your progress is kept. You can edit until final submit.</p>

  <section class="card" id="s1"><h2>1. Personal details</h2><div class="grid">
   <div><label>Applying for *</label><select name="purpose"><option value="">- select -</option>
     <option value="internship" ${a.purpose === 'internship' ? 'selected' : ''}>Internship</option>
     <option value="dissertation" ${a.purpose === 'dissertation' ? 'selected' : ''}>Dissertation / thesis</option></select></div>
   <div><label>Full name *</label><input name="name" value="${esc(a.name)}"></div>
   <div><label>Father's name *</label><input name="father_name" value="${esc(a.father_name)}"></div>
   <div><label>Mother's name *</label><input name="mother_name" value="${esc(a.mother_name)}"></div>
   <div><label>Mobile number *</label><input name="mobile" inputmode="numeric" value="${esc(a.mobile)}"></div>
   <div><label>Gender</label><select name="gender"><option value="">- select -</option>${['Female', 'Male', 'Other'].map((g) => `<option ${a.gender === g ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
   <div><label>Category</label><select name="category"><option value="">- select -</option>${CATS.map((c) => `<option ${a.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
   <div><label>Current institute / college *</label><input name="institute" value="${esc(a.institute)}"></div>
   <div><label>Course / programme</label><input name="course" value="${esc(a.course)}"></div></div>
   <label class="chk" style="margin-top:8px"><input type="checkbox" name="outside_nars" ${a.outside_nars !== false ? 'checked' : ''}> I am from outside the National Agricultural Research System (not an ICAR institute / agricultural university student)</label>
   <h3 style="margin-top:14px">Educational details</h3><div id="eduRows">${edu.map(eduRow).join('')}</div>
   <button type="button" class="btn alt" id="addEdu">+ Add row</button>
   <h3 style="margin-top:14px">Address</h3>
   <label>Present address *</label><textarea name="present_address" id="presAddr">${esc(a.present_address)}</textarea>
   <label class="chk"><input type="checkbox" name="same_address" id="sameAddr" ${a.same_address ? 'checked' : ''}> Permanent address is same as present address</label>
   <label>Permanent address *</label><textarea name="permanent_address" id="permAddr" ${a.same_address ? 'readonly' : ''}>${esc(a.permanent_address)}</textarea>
   <p><button class="btn" data-save="s1">Save personal details</button></p></section>

  <section class="card" id="s2"><h2>2. Documents</h2><div class="grid2">
   ${uploadField('Passport size photo * (JPG/PNG)', 'photo', 'photo_path', { imageOnly: true }, 'Recent, plain background')}
   ${a.photo_path ? `<div><label>Preview</label><img class="photo" data-path="${esc(a.photo_path)}" alt="Your photo"></div>` : '<div></div>'}
   ${uploadField('College / institute ID card *', 'id_card', 'id_card_path', {}, 'PDF, JPG or PNG, max 5 MB')}
   ${uploadField('Resume (2 pages) *', 'resume', 'resume_path', { pdfOnly: true }, 'PDF, maximum 2 pages, max 5 MB')}
   ${uploadField('Recommendation letter *', 'recommendation', 'recommendation_path', {}, 'From HOD, institute head or mentor. PDF/JPG/PNG, max 5 MB')}
   </div><div class="grid2" style="margin-top:8px">
   <div><label>Recommender's name</label><input name="recommender_name" value="${esc(a.recommender_name)}"></div>
   <div><label>Recommender's designation</label><input name="recommender_designation" value="${esc(a.recommender_designation)}"></div></div>
   <p><button class="btn alt" data-save="s2">Save recommender details</button></p></section>

  <section class="card" id="s3"><h2>3. Duration and application fee</h2>
   <div class="chk-row"><label class="chk"><input type="radio" name="dur" value="3" ${preset === '3' ? 'checked' : ''}> 3 months</label>
   <label class="chk"><input type="radio" name="dur" value="6" ${preset === '6' ? 'checked' : ''}> 6 months</label>
   <label class="chk"><input type="radio" name="dur" value="custom" ${preset === 'custom' ? 'checked' : ''}> Other (more than 3 months)</label></div>
   <div id="customDur" ${preset === 'custom' ? '' : 'hidden'}><label>Number of months (4 or more)</label><input type="number" min="4" max="24" id="customMonths" value="${preset === 'custom' ? dur : ''}"></div>
   <p class="mut" id="feeNote">${fee.base ? `Bench fee if selected: Rs ${fee.base.toLocaleString('en-IN')}${fee.concession ? ` (Rs ${fee.final.toLocaleString('en-IN')} after 50% concession on submitting category documents)` : ''}.` : dur ? 'Bench fee for periods above 6 months will be intimated by the HRD section.' : ''}</p>
   <p>An <b>application fee of Rs 1000</b> is submitted with the application. It is adjusted against the bench fee for selected candidates, or refunded to non-selected candidates.</p>
   ${bankBox()}
   <div class="grid" style="margin-top:10px"><div><label>Transaction ID / UTR *</label><input name="fee_txn_id" value="${esc(a.fee_txn_id)}"></div>
    <div><label>Payment date</label><input type="date" name="fee_date" value="${esc(a.fee_date || '')}"></div>
    ${uploadField('Payment proof *', 'fee_proof', 'fee_proof_path', {}, 'Screenshot or receipt, max 5 MB')}</div>
   <p><button class="btn" data-save="s3">Save duration &amp; fee details</button></p></section>

  <section class="card" id="s4"><h2>4. Guide preferences</h2>
   <p class="mut">Choose three different guides. Guides who already have 2 HRD students are not available. <a href="#/guides" target="_blank">View guide profiles</a></p>
   ${st.faculty.length ? '' : '<p class="warn">The guide list has not been published yet. Please check back soon.</p>'}
   <div class="grid"><div><label>Preference 1 *</label><select name="pref1">${opts(a.pref1)}</select></div>
    <div><label>Preference 2 *</label><select name="pref2">${opts(a.pref2)}</select></div>
    <div><label>Preference 3 *</label><select name="pref3">${opts(a.pref3)}</select></div></div>
   <p><button class="btn" data-save="s4">Save preferences</button></p></section>

  <section class="card"><h2>5. Final submit</h2><ul class="steps">${checks.map((c) => `<li class="${c[1] ? 'done' : ''}">${c[1] ? '&#10003;' : '&#9744;'} ${c[0]}</li>`).join('')}</ul>
   <p class="mut">After final submit you cannot change these details. The HRD section will be notified and will process your application.</p>
   <button class="btn" id="finalSubmit" ${allDone ? '' : 'disabled'}>Final submit application</button></section>`;

  fillImgs();
  wireApply();
}

function wireApply() {
  const same = document.getElementById('sameAddr'), pres = document.getElementById('presAddr'), perm = document.getElementById('permAddr');
  const sync = () => { if (same.checked) { perm.value = pres.value; perm.readOnly = true; } else perm.readOnly = false; };
  same.onchange = sync; pres.oninput = sync; sync();
  document.getElementById('addEdu').onclick = () => {
    const wrap = document.getElementById('eduRows'); const cur = readEdu(); cur.push({});
    wrap.innerHTML = cur.map(eduRow).join('');
  };
  root.onclick = (e) => {
    const rm = e.target.closest('[data-rm-edu]');
    if (rm) { const cur = readEdu(); cur.splice(Number(rm.dataset.rmEdu), 1); document.getElementById('eduRows').innerHTML = (cur.length ? cur : [{}]).map(eduRow).join(''); }
  };
  root.querySelectorAll('[name=dur]').forEach((r) => {
    r.onchange = () => { document.getElementById('customDur').hidden = r.value !== 'custom'; };
  });
  root.querySelectorAll('input[type=file][data-up]').forEach((inp) => {
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      try {
        toast('Uploading...');
        const path = await uploadFile(st.user.id, inp.dataset.up, file, JSON.parse(inp.dataset.opts));
        if (await saveApp({ [inp.dataset.col]: path }, 'File uploaded')) await keepScroll(pageApply);
      } catch (x) { toast(errMsg(x), true); inp.value = ''; }
    };
  });
  root.querySelectorAll('[data-save]').forEach((btn) => {
    btn.onclick = async () => {
      const sec = document.getElementById(btn.dataset.save);
      let patch = collect(sec);
      if (btn.dataset.save === 's1') {
        patch.education = readEdu(); delete patch.dur;
        if (patch.same_address) patch.permanent_address = patch.present_address;
        if (patch.mobile) {
          const m = patch.mobile.replace(/^\+?91/, '').replace(/\D/g, '');
          if (!/^[6-9]\d{9}$/.test(m)) return toast('Enter a valid 10-digit mobile number.', true);
          patch.mobile = m;
        }
      }
      if (btn.dataset.save === 's2') patch = { recommender_name: patch.recommender_name, recommender_designation: patch.recommender_designation };
      if (btn.dataset.save === 's3') {
        const d = sec.querySelector('[name=dur]:checked')?.value;
        let months = d === 'custom' ? Number(document.getElementById('customMonths').value) : d ? Number(d) : null;
        if (d === 'custom' && !(months > 3)) return toast('Custom duration must be more than 3 months.', true);
        patch = { duration_months: months, fee_txn_id: patch.fee_txn_id, fee_date: patch.fee_date };
      }
      if (btn.dataset.save === 's4') {
        const p = [patch.pref1, patch.pref2, patch.pref3].map((v) => (v ? Number(v) : null));
        if (p.some(Boolean) && new Set(p.filter(Boolean)).size !== p.filter(Boolean).length) return toast('Choose three different guides.', true);
        patch = { pref1: p[0], pref2: p[1], pref3: p[2] };
      }
      if (await saveApp(patch)) await keepScroll(pageApply);
    };
  });
  document.getElementById('finalSubmit').onclick = async () => {
    if (!confirm('Submit your final application? You will not be able to edit it afterwards.')) return;
    if (await saveApp({ status: 'submitted' }, 'Application submitted. The HRD section has been notified.')) await pageApply();
  };
}

// ---------- student status after submit ----------
function renderStatus() {
  const a = st.app;
  const steps = ['submitted', 'under_screening', 'approved', 'joined', 'completed'];
  const fee = benchFee(a.duration_months, a.category, a.gender, a.outside_nars);
  const canPost = ['joined', 'completed'].includes(a.status);
  const eligible = a.bench_fee_verified && a.report_path;
  root.innerHTML = `<h1>My application</h1>
  <div class="card"><div style="display:flex;gap:16px;flex-wrap:wrap"><img class="photo" data-path="${esc(a.photo_path)}" alt="">
   <div><h2>${esc(a.name)}</h2><p>${esc(a.purpose)} &middot; ${a.duration_months} months &middot; submitted ${fmtDate(a.submitted_at)}</p>
   <p>Status: <span class="pill ${a.status === 'rejected' ? 'full' : ''}">${STATUS[a.status]}</span></p>
   ${a.status !== 'rejected' ? `<p class="mut">${steps.map((s) => (steps.indexOf(s) <= steps.indexOf(a.status) ? '<b>' + STATUS[s].split(' - ')[0] + '</b>' : STATUS[s].split(' - ')[0])).join(' &rarr; ')}</p>` : '<p>Your Rs 1000 application fee will be refunded.</p>'}
   ${a.admin_notes ? `<p><b>Note from HRD:</b> ${esc(a.admin_notes)}</p>` : ''}</div></div></div>
  ${a.approval_letter_path ? `<div class="card"><h2>Approval letter</h2><p>${fileLink(a.approval_letter_path, 'Download approval letter')}</p>
   <p>Guide: <b>${a.assigned_faculty ? esc(facName(a.assigned_faculty)) : 'to be intimated'}</b><br>Joining date: ${fmtDate(a.joining_date)} &middot; Completion: ${fmtDate(a.end_date)}</p></div>` : ''}
  ${['approved', 'joined', 'completed'].includes(a.status) ? `<div class="card"><h2>Bench fee (pay within one month of joining)</h2>
   <p>${fee.base ? `Fee: <b>Rs ${fee.base.toLocaleString('en-IN')}</b>${fee.concession ? ` - you may be eligible for 50% concession: <b>Rs ${fee.final.toLocaleString('en-IN')}</b> (upload category / eligibility documents). The Rs 1000 application fee is adjusted.` : ''}` : 'The fee for your duration will be intimated by the HRD section.'}</p>
   ${bankBox()}
   ${canPost ? `<div id="bf" class="grid" style="margin-top:10px">
     <div><label>Amount paid (Rs)</label><input type="number" name="bench_fee_amount" value="${esc(a.bench_fee_amount ?? '')}"></div>
     <div><label>Transaction ID</label><input name="bench_txn_id" value="${esc(a.bench_txn_id)}"></div>
     <div><label>Date of payment</label><input type="date" name="bench_fee_date" value="${esc(a.bench_fee_date || '')}"></div>
     ${uploadField('Payment proof', 'bench_proof', 'bench_proof_path', {})}
     <div><label class="chk"><input type="checkbox" name="concession_claimed" ${a.concession_claimed ? 'checked' : ''}> I claim the 50% concession</label></div>
     ${uploadField('Concession documents (category certificate etc.)', 'concession_doc', 'concession_doc_path', {})}</div>
     <p><button class="btn" id="saveBench">Save fee details</button> ${a.bench_fee_verified ? '<span class="ok">Fee verified by HRD</span>' : ''}</p>`
     : '<p class="mut">The fee form opens once the HRD section marks you as joined.</p>'}</div>` : ''}
  ${canPost ? `<div class="card"><h2>Internship report &amp; certificate</h2>
   <p class="mut">Upload your internship report (PDF, max 5 MB). The certificate is issued only after the fee is paid and the report is submitted.</p>
   ${uploadField('Internship report (PDF)', 'report', 'report_path', { pdfOnly: true })}
   <ul class="steps"><li class="${a.bench_fee_verified ? 'done' : ''}">${a.bench_fee_verified ? '&#10003;' : '&#9744;'} Bench fee verified</li>
   <li class="${a.report_path ? 'done' : ''}">${a.report_path ? '&#10003;' : '&#9744;'} Report submitted</li>
   <li class="${a.certificate_path ? 'done' : ''}">${a.certificate_path ? '&#10003;' : '&#9744;'} Certificate issued ${eligible && !a.certificate_path ? '(awaiting HRD)' : ''}</li></ul>
   ${a.certificate_path ? `<p>${fileLink(a.certificate_path, 'Download certificate')}</p>` : ''}</div>` : ''}
  <div class="card"><h2>Your submitted details</h2><p>${esc(a.email)} &middot; ${esc(a.mobile)}<br>Preferences: ${[a.pref1, a.pref2, a.pref3].map((p) => esc(facName(p))).join(', ')}<br>
  Fee proof (Rs 1000): ${esc(a.fee_txn_id)} ${fileLink(a.fee_proof_path, 'proof')}</p></div>`;
  fillImgs();
  root.querySelectorAll('input[type=file][data-up]').forEach((inp) => {
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      try {
        toast('Uploading...');
        const path = await uploadFile(st.user.id, inp.dataset.up, file, JSON.parse(inp.dataset.opts));
        if (await saveApp({ [inp.dataset.col]: path }, 'File uploaded')) await keepScroll(() => { renderStatus(); });
      } catch (x) { toast(errMsg(x), true); inp.value = ''; }
    };
  });
  const sbn = document.getElementById('saveBench');
  if (sbn) sbn.onclick = async () => { if (await saveApp(collect(document.getElementById('bf')))) renderStatus(); };
}

// ---------- admin ----------
async function pageAdminList() {
  await loadFaculty();
  const { data, error } = await sb.from('applications').select('*').neq('status', 'draft').order('submitted_at', { ascending: false });
  if (error) throw error;
  root.innerHTML = `<h1>Applications</h1><p><a class="btn alt" href="#/admin/faculty">Manage guides</a></p>
  <div class="card" style="overflow-x:auto"><table><tr><th>Name</th><th>Type / months</th><th>Status</th><th>Guide</th><th>Submitted</th></tr>
  ${data.map((a) => `<tr><td><a href="#/admin/${a.id}">${esc(a.name)}</a><div class="mut">${esc(a.email)}</div></td><td>${esc(a.purpose)} / ${a.duration_months}</td>
   <td>${STATUS[a.status]}</td><td>${a.assigned_faculty ? esc(facName(a.assigned_faculty)) : '-'}</td><td>${fmtDate(a.submitted_at)}</td></tr>`).join('') || '<tr><td colspan="5">No submitted applications yet.</td></tr>'}</table></div>`;
}

async function pageAdminDetail(id) {
  await loadFaculty();
  const { data: a, error } = await sb.from('applications').select('*').eq('id', id).single();
  if (error) throw error;
  const prefs = [a.pref1, a.pref2, a.pref3];
  const fac = st.faculty.map((f) => `<option value="${f.id}" ${a.assigned_faculty === f.id ? 'selected' : ''}>${esc(f.name)} (${st.load[f.id] || 0}/2${isFull(f.id) && a.assigned_faculty !== f.id ? ' - full' : ''})</option>`).join('');
  const edu = (a.education || []).map((r) => `<tr><td>${esc(r.degree)}</td><td>${esc(r.institute)}</td><td>${esc(r.year)}</td><td>${esc(r.score)}</td></tr>`).join('');
  root.innerHTML = `<p><a href="#/admin">&larr; All applications</a></p><h1>${esc(a.name)}</h1>
  <div class="card" style="display:flex;gap:16px;flex-wrap:wrap"><img class="photo" data-path="${esc(a.photo_path)}" alt="">
   <div><p><b>${esc(a.purpose)}</b>, ${a.duration_months} months &middot; Status: <span class="pill">${STATUS[a.status]}</span></p>
   <p>Father: ${esc(a.father_name)} &middot; Mother: ${esc(a.mother_name)}<br>Mobile: ${esc(a.mobile)} &middot; ${esc(a.email)}<br>
   Gender: ${esc(a.gender)} &middot; Category: ${esc(a.category)} &middot; Outside NARS: ${a.outside_nars ? 'Yes' : 'No'}<br>Institute: ${esc(a.institute)} (${esc(a.course)})</p>
   <p>Present address: ${esc(a.present_address)}<br>Permanent address: ${esc(a.permanent_address)}</p></div></div>
  <div class="card"><h2>Education</h2><table><tr><th>Degree</th><th>Institute</th><th>Year</th><th>Score</th></tr>${edu}</table></div>
  <div class="card"><h2>Documents</h2><p>${fileLink(a.id_card_path, 'ID card')} &middot; ${fileLink(a.resume_path, 'Resume')} &middot; ${fileLink(a.recommendation_path, 'Recommendation')}
   (by ${esc(a.recommender_name)}, ${esc(a.recommender_designation)})<br>Rs 1000 fee: txn ${esc(a.fee_txn_id)} on ${fmtDate(a.fee_date)} &middot; ${fileLink(a.fee_proof_path, 'proof')}</p>
   <p>Preferences: ${prefs.map((p, i) => `${i + 1}. ${esc(facName(p))} <span class="mut">(${st.load[p] || 0}/2)</span>`).join(' &nbsp; ')}</p></div>
  <div class="card" id="adm"><h2>Process application</h2><div class="grid">
   <div><label>Status</label><select name="status">${Object.keys(STATUS).filter((s) => s !== 'draft').map((s) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select></div>
   <div><label>Assign guide</label><select name="assigned_faculty"><option value="">- none -</option>${fac}</select></div>
   <div><label>Joining date</label><input type="date" name="joining_date" value="${esc(a.joining_date || '')}"></div>
   <div><label>End date (blank = joining + duration)</label><input type="date" name="end_date" value="${esc(a.end_date || '')}"></div></div>
   <label>Note shown to student</label><textarea name="admin_notes">${esc(a.admin_notes)}</textarea>
   <p><button class="btn" id="saveAdm">Save</button></p>
   <p class="mut">Setting status to Approved or Joined with a guide counts the student against that guide's limit of 2 until the end date.</p></div>
  <div class="card"><h2>Approval letter</h2><p>${a.approval_letter_path ? fileLink(a.approval_letter_path, 'Current approval letter') : 'Not uploaded yet.'}</p>
   <input type="file" id="upLetter" accept="application/pdf,image/jpeg,image/png"><p class="mut">Uploading notifies the student by e-mail. Set the guide and dates above first.</p></div>
  <div class="card"><h2>After joining</h2><p>Bench fee: Rs ${esc(a.bench_fee_amount ?? '-')} &middot; txn ${esc(a.bench_txn_id)} on ${fmtDate(a.bench_fee_date)} &middot; ${fileLink(a.bench_proof_path, 'proof')}<br>
   Concession claimed: ${a.concession_claimed ? 'Yes - ' + fileLink(a.concession_doc_path, 'documents') : 'No'}<br>Report: ${fileLink(a.report_path, 'internship report')}</p>
   <label class="chk"><input type="checkbox" id="feeOk" ${a.bench_fee_verified ? 'checked' : ''}> Bench fee verified</label>
   <p><button class="btn alt" id="saveFee">Save verification</button></p>
   <h3>Certificate</h3><p>${a.certificate_path ? fileLink(a.certificate_path, 'Current certificate') : 'Not issued.'}
   ${a.bench_fee_verified && a.report_path ? '<span class="ok">Eligible (fee verified and report submitted)</span>' : '<span class="warn">Not eligible yet</span>'}</p>
   <input type="file" id="upCert" accept="application/pdf,image/jpeg,image/png"></div>`;
  fillImgs();
  const back = () => pageAdminDetail(id);
  document.getElementById('saveAdm').onclick = async () => {
    const v = collect(document.getElementById('adm'));
    const patch = { status: v.status, assigned_faculty: v.assigned_faculty ? Number(v.assigned_faculty) : null, joining_date: v.joining_date, end_date: v.end_date, admin_notes: v.admin_notes };
    if (patch.joining_date && !patch.end_date && a.duration_months) {
      const d = new Date(patch.joining_date); d.setMonth(d.getMonth() + a.duration_months); patch.end_date = d.toISOString().slice(0, 10);
    }
    const { error: e } = await sb.from('applications').update(patch).eq('id', id);
    if (e) toast(errMsg(e), true); else { toast('Saved'); keepScroll(back); }
  };
  document.getElementById('saveFee').onclick = async () => {
    const { error: e } = await sb.from('applications').update({ bench_fee_verified: document.getElementById('feeOk').checked }).eq('id', id);
    if (e) toast(errMsg(e), true); else { toast('Saved'); keepScroll(back); }
  };
  const adminUpload = (inputId, kind, col, extra = {}) => {
    document.getElementById(inputId).onchange = async (ev) => {
      try {
        const path = await uploadFile(a.user_id, kind, ev.target.files[0]);
        const { error: e } = await sb.from('applications').update({ [col]: path, ...extra }).eq('id', id);
        if (e) throw e; toast('Uploaded. The student has been notified by e-mail.'); keepScroll(back);
      } catch (x) { toast(errMsg(x), true); }
    };
  };
  adminUpload('upLetter', 'approval_letter', 'approval_letter_path');
  document.getElementById('upCert').onchange = async (ev) => {
    if (!(a.bench_fee_verified && a.report_path) && !confirm('Fee/report not complete. Issue the certificate anyway?')) { ev.target.value = ''; return; }
    try {
      const path = await uploadFile(a.user_id, 'certificate', ev.target.files[0]);
      const { error: e } = await sb.from('applications').update({ certificate_path: path, status: 'completed' }).eq('id', id);
      if (e) throw e; toast('Certificate uploaded'); keepScroll(back);
    } catch (x) { toast(errMsg(x), true); }
  };
}

async function pageAdminFaculty() {
  const { data } = await sb.from('faculty').select('*').order('name');
  await loadFaculty();
  const form = (f = {}) => `<form class="card facForm" data-id="${f.id || ''}"><div class="grid">
   <div><label>Name</label><input name="name" value="${esc(f.name)}" required></div>
   <div><label>Designation</label><input name="designation" value="${esc(f.designation)}"></div>
   <div><label>Photo URL</label><input name="photo_url" value="${esc(f.photo_url)}"></div>
   <div><label>IIAB profile link</label><input name="profile_url" value="${esc(f.profile_url)}"></div></div>
   <label>Brief description / research area</label><textarea name="description">${esc(f.description)}</textarea>
   <label class="chk"><input type="checkbox" name="active" ${f.active !== false ? 'checked' : ''}> Show on website</label>
   <p><button class="btn">${f.id ? 'Save' : 'Add guide'}</button> ${f.id ? `<span class="mut">Currently ${st.load[f.id] || 0}/2 students</span>` : ''}</p></form>`;
  root.innerHTML = `<p><a href="#/admin">&larr; Applications</a></p><h1>Manage guides</h1>
  <h2>Add a guide</h2>${form()}<h2>Existing guides</h2>${(data || []).map(form).join('')}`;
  root.querySelectorAll('.facForm').forEach((f) => {
    f.onsubmit = async (e) => {
      e.preventDefault(); const v = collect(f); const id = f.dataset.id;
      const { error } = id ? await sb.from('faculty').update(v).eq('id', id) : await sb.from('faculty').insert(v);
      if (error) toast(errMsg(error), true); else { toast('Saved'); keepScroll(pageAdminFaculty); }
    };
  });
}

// ---------- boot ----------
async function setUser(session) {
  st.user = session?.user || null; st.admin = false; st.app = null;
  if (st.user) {
    const { data } = await sb.from('admins').select('user_id').eq('user_id', st.user.id).maybeSingle();
    st.admin = !!data;
  }
}
sb.auth.onAuthStateChange(async (event, session) => {
  if (event === 'PASSWORD_RECOVERY') { await setUser(session); renderNav(); return pageNewPassword(); }
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') { await setUser(session); route(); }
});
window.addEventListener('hashchange', route);
