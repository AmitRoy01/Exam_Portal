'use strict';
const $ = id => document.getElementById(id);
function make(tag, className = '', text = '') { const n = document.createElement(tag); n.className = className; n.textContent = text; return n; }
async function api(url, opts = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
const jsonOpts = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function message(text, type = 'error') {
  const m = $('globalMsg'); m.textContent = text; m.className = `alert ${type}`;
  m.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showDashboard(auth) {
  $('loginPanel').classList.toggle('hidden', auth);
  $('dashboard').classList.toggle('hidden', !auth);
  $('logout').classList.toggle('hidden', !auth);
}
async function refreshStatus() {
  const status = await api('/api/admin/status');
  showDashboard(status.loggedIn);
  if (!status.loggedIn) return;
  await Promise.all([loadAdminExams(), loadResults()]);
}
// Quick entry: "abcbabc" → Q1=A, Q2=B, Q3=C, Q4=B …
// a-d / A-D / ক খ গ ঘ = answers; "?" or "_" = leave that question blank;
// spaces, commas, dots, brackets, dashes and question numbers (e.g. "1.a 2.b") are ignored.
// Any other character still takes a question slot (left blank) so later answers don't shift.
const BANGLA_OPTIONS = { 'ক': 'A', 'খ': 'B', 'গ': 'C', 'ঘ': 'D' };
function parseAnswerText(text) {
  const answers = []; const invalid = [];
  for (const ch of String(text)) {
    const up = ch.toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(up)) answers.push(up);
    else if (BANGLA_OPTIONS[ch]) answers.push(BANGLA_OPTIONS[ch]);
    else if (ch === '?' || ch === '_') answers.push('');
    else if (/[\s.,;:|/()\[\]\-0-9০-৯।]/.test(ch)) continue;
    else { invalid.push({ ch, question: answers.length + 1 }); answers.push(''); }
  }
  return { answers, invalid };
}
function keySelects() { return [...$('answerKeyGrid').querySelectorAll('select')]; }
function applyAnswerText() {
  const { answers, invalid } = parseAnswerText($('answerText').value);
  keySelects().forEach((sel, i) => { sel.value = answers[i] || ''; });
  updateKeyProgress();
  showAnswerTextStatus(answers.length, invalid);
}
function syncAnswerTextFromGrid() {
  // Blank questions become "?" so positions stay aligned; trailing blanks are dropped.
  $('answerText').value = keySelects().map(s => s.value ? s.value.toLowerCase() : '?').join('').replace(/\?+$/, '');
  showAnswerTextStatus(parseAnswerText($('answerText').value).answers.length, []);
}
function showAnswerTextStatus(entered, invalid) {
  const status = $('answerTextStatus'); const count = keySelects().length;
  if (!$('answerText').value.trim()) { status.textContent = status.dataset.help; status.className = 'hint'; return; }
  const parts = [];
  if (invalid.length) parts.push(`অবৈধ অক্ষর: ${invalid.slice(0, 5).map(x => `"${x.ch}" (Q${x.question})`).join(', ')}${invalid.length > 5 ? ' …' : ''} — শুধু a/b/c/d লেখো।`);
  if (entered > count) parts.push(`${entered}টি Answer লেখা হয়েছে কিন্তু MCQ সংখ্যা ${count} — শেষের ${entered - count}টি বাদ যাবে। দরকার হলে Number of MCQs বাড়াও।`);
  else if (entered < count) parts.push(`${entered}/${count}টি Answer লেখা হয়েছে — আরও ${count - entered}টি বাকি।`);
  if (!parts.length) { status.textContent = `✓ ${count}টি Answer ঠিকমতো বসেছে। নিচের তালিকায় মিলিয়ে নাও।`; status.className = 'hint ok'; return; }
  status.textContent = parts.join(' '); status.className = 'hint warn';
}
function renderKeys() {
  const count = Math.max(1, Math.min(200, Number($('questionCount').value) || 1));
  const old = [...$('answerKeyGrid').querySelectorAll('select')].map(x => x.value);
  const grid = $('answerKeyGrid'); grid.replaceChildren();
  for (let i = 0; i < count; i++) {
    const label = make('label', '', `Q${i + 1}`);
    const sel = make('select'); sel.setAttribute('aria-label', `Correct answer for question ${i + 1}`);
    for (const option of ['', 'A', 'B', 'C', 'D']) {
      const o = document.createElement('option'); o.value = option; o.textContent = option || '—'; sel.append(o);
    }
    sel.value = old[i] || '';
    sel.addEventListener('change', () => { updateKeyProgress(); syncAnswerTextFromGrid(); });
    label.append(sel); grid.append(label);
  }
  // If answers were typed in Quick Entry, they win (e.g. raising the MCQ count fills the new questions).
  if ($('answerText').value.trim()) applyAnswerText();
  else updateKeyProgress();
}
function updateKeyProgress() {
  const answers = [...$('answerKeyGrid').querySelectorAll('select')].map(x => x.value);
  const complete = answers.filter(Boolean).length;
  $('keyProgress').textContent = `${complete}/${answers.length} set`;
  $('keyProgress').className = 'chip ' + (complete === answers.length ? 'green' : '');
}
async function loadAdminExams() {
  try {
    const exams = await api('/api/admin/exams');
    const root = $('adminExams'); root.replaceChildren();
    if (!exams.length) { root.textContent = 'No exams created yet.'; return; }
    for (const exam of exams) {
      const div = make('div', 'admin-exam');
      div.append(make('strong', '', exam.title));
      const meta = make('div', 'exam-meta');
      meta.append(make('span', 'chip', `${exam.questionCount} MCQs`), make('span', 'chip', `${exam.durationMinutes} min`), make('span', exam.active ? 'chip green' : 'chip red', exam.active ? 'Published' : 'Closed'));
      div.append(meta);
      const actions = make('div', 'actions');
      const copy = make('button', 'btn secondary small', 'Copy Student Link');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(exam.shareUrl); message('Student link copied: ' + exam.shareUrl, 'success'); } catch { message('Student link: ' + exam.shareUrl, 'success'); } });
      const toggle = make('button', 'btn small ' + (exam.active ? 'danger' : 'secondary'), exam.active ? 'Close Exam' : 'Reopen Exam');
      toggle.addEventListener('click', async () => { try { await api(`/api/admin/exams/${exam.id}/toggle`, { method: 'PATCH' }); await loadAdminExams(); } catch (e) { message(e.message); } });
      actions.append(copy, toggle); div.append(actions); root.append(div);
    }
  } catch (e) { $('adminExams').textContent = e.message; }
}
async function loadResults() {
  try {
    const results = await api('/api/admin/results');
    const body = $('resultsBody'); body.replaceChildren();
    if (!results.length) { const tr = make('tr'); const td = make('td', 'muted', 'No submissions yet.'); td.colSpan = 4; tr.append(td); body.append(tr); return; }
    results.forEach((r, i) => { const tr = make('tr'); [i + 1, r.studentName, r.examName, String(r.mark)].forEach(v => tr.append(make('td', '', String(v)))); body.append(tr); });
  } catch (e) { $('resultsBody').replaceChildren(); message(e.message); }
}
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); $('loginMsg').classList.add('hidden');
  try { await api('/api/admin/login', jsonOpts({ password: $('teacherPassword').value })); $('teacherPassword').value = ''; await refreshStatus(); }
  catch (err) { $('loginMsg').textContent = err.message; $('loginMsg').classList.remove('hidden'); }
});
$('logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); showDashboard(false); });
$('questionCount').addEventListener('input', renderKeys);
$('answerTextStatus').dataset.help = $('answerTextStatus').textContent;
$('answerText').addEventListener('input', applyAnswerText);
$('negativeEnabled').addEventListener('change', () => $('negativeBox').classList.toggle('hidden', !$('negativeEnabled').checked));
$('refreshResults').addEventListener('click', loadResults);
$('refreshExams').addEventListener('click', loadAdminExams);
$('examForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('createButton'); btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const answerKey = [...$('answerKeyGrid').querySelectorAll('select')].map(s => s.value);
    if (answerKey.some(x => !x)) throw new Error('সবগুলো প্রশ্নের সঠিক Answer সেট করো।');
    const payload = {
      title: $('examTitle').value.trim(), questionCount: Number($('questionCount').value),
      durationMinutes: Number($('examDuration').value),
      negativePercentage: $('negativeEnabled').checked ? Number($('negativePercentage').value) : 0,
      answerKey, driveUrl: $('driveUrl').value.trim()
    };
    const data = await api('/api/admin/exams', jsonOpts(payload));
    message(`Exam created! Student link: ${data.shareUrl}`, 'success');
    $('examForm').reset(); $('negativeBox').classList.add('hidden');
    renderKeys(); showAnswerTextStatus(0, []); await loadAdminExams();
  } catch (err) { message(err.message); }
  finally { btn.disabled = false; btn.textContent = 'Create Exam & Generate Link'; }
});
renderKeys();
refreshStatus().catch(e => { $('loginMsg').textContent = e.message; $('loginMsg').classList.remove('hidden'); });
