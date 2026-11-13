'use strict';
const $ = id => document.getElementById(id);
const app = $('app');
const examId = new URLSearchParams(location.search).get('id');
const key = `drive-mcq-attempt-${examId}`;
let exam = null, token = '', answers = [], current = 0, deadline = 0, clockSkew = 0, ticker = null;
let busy = false, pendingSaves = new Set();
const tag = (name, cls, txt) => { const x = document.createElement(name); if (cls) x.className = cls; if (txt !== undefined) x.textContent = txt; return x; };
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
async function api(route, init) { const response = await fetch(route, init); const d = await response.json().catch(() => ({})); if (!response.ok) throw new Error(d.error || 'Request failed.'); return d; }
function setError(id, txt) { const n = $(id); if (!n) return; n.textContent = txt; n.classList.toggle('hidden', !txt); }
function getSavedToken() { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function saveToken(t) { try { localStorage.setItem(key, t); } catch { /* Private browsing may block storage. */ } }
function updateClock(serverTime, deadlineAt) { clockSkew = Date.parse(serverTime) - Date.now(); deadline = Date.parse(deadlineAt); }

function showStart() {
  clearInterval(ticker);
  app.replaceChildren();
  const section = tag('section', 'card narrow'); section.style.margin = '55px auto';
  const badge = tag('span', 'chip blue', 'Student entry');
  const title = tag('h1', '', exam.title); title.style.margin = '12px 0 5px'; title.style.fontSize = '25px';
  const desc = tag('p', 'muted', 'পরীক্ষা শুরু করার আগে তোমার নাম লেখো। Start Exam চাপলেই Timer চালু হবে।');
  const meta = tag('div', 'exam-meta'); meta.style.marginBottom = '20px';
  meta.append(tag('span', 'chip', `${exam.questionCount} questions`), tag('span', 'chip', `${exam.durationMinutes} min`), tag('span', 'chip', exam.negativePercentage ? `${exam.negativePercentage}% negative` : 'No negative'));
  const form = tag('form', 'form-field');
  const label = tag('label', '', 'Student Full Name *'); label.htmlFor = 'studentName';
  const input = tag('input'); input.id = 'studentName'; input.type = 'text'; input.required = true; input.maxLength = 100; input.minLength = 2; input.placeholder = 'তোমার নাম'; input.autocomplete = 'name';
  const btn = tag('button', 'btn', 'Start Exam'); btn.type = 'submit';
  const alert = tag('div', 'alert error hidden'); alert.id = 'startError';
  form.append(label, input, btn, alert);
  form.addEventListener('submit', async e => {
    e.preventDefault(); btn.disabled = true; btn.textContent = 'Starting…';
    try {
      const state = await api('/api/attempts/start', json({ examId, studentName: input.value.trim() }));
      token = state.token; saveToken(token); hydrate(state);
    } catch (err) { setError('startError', err.message); btn.disabled = false; btn.textContent = 'Start Exam'; }
  });
  section.append(badge, title, desc, meta, form); app.append(section); input.focus();
}
function hydrate(state) {
  exam = state.exam; answers = state.answers.slice(); updateClock(state.serverTime, state.deadlineAt);
  if (state.status === 'completed') showResult(state);
  else if (state.status === 'grading') { app.replaceChildren(tag('div', 'alert', 'Submission processing. Reload the page shortly.')); }
  else showWorkspace(state.studentName);
}
function showWorkspace(studentName) {
  clearInterval(ticker); app.replaceChildren();
  const header = tag('div', 'exam-header');
  const heading = tag('div'); const h1 = tag('h1', '', exam.title); heading.append(h1, tag('div', 'sub', `Student: ${studentName} • ${exam.questionCount} MCQs • ${exam.questionCount} Marks`));
  const timerGroup = tag('div'); timerGroup.style.textAlign = 'right'; timerGroup.append(tag('div', 'small muted bold', 'TIME LEFT'));
  const timerNode = tag('div', 'timer', '00:00'); timerNode.id = 'countdown'; timerGroup.append(timerNode);
  header.append(heading, timerGroup);
  const main = tag('div', 'exam-main');
  const pdf = tag('section', 'pdf-pane');
  const pdfTop = tag('div', 'panel-top'); pdfTop.append(tag('strong', '', '📄 Question Paper'));
  const open = tag('a', 'small bold', 'Open paper in new tab'); open.href = exam.previewUrl; open.target = '_blank'; open.rel = 'noopener noreferrer';
  pdfTop.append(open);
  const frame = tag('iframe'); frame.title = 'Question paper from Google Drive'; frame.src = exam.previewUrl; frame.referrerPolicy = 'strict-origin-when-cross-origin'; frame.setAttribute('allowfullscreen', '');
  pdf.append(pdfTop, frame, tag('div', 'pane-note', 'প্রশ্নপত্রে Q1, Q2, Q3 দেখে ডান পাশের Answer Sheet-এ উত্তর দাও।'));
  const pane = tag('section', 'answer-pane');
  const paneTop = tag('div', 'panel-top'); paneTop.append(tag('strong', '', 'Answer Sheet'));
  const answeredLabel = tag('span', 'chip green', '0 answered'); answeredLabel.id = 'answeredLabel'; paneTop.append(answeredLabel);
  const body = tag('div', 'answer-inner');
  const topRow = tag('div', 'section-title'); topRow.style.marginTop = '0';
  const currentTitle = tag('h3', '', 'Question 1'); currentTitle.id = 'currentTitle'; topRow.append(currentTitle);
  const clear = tag('button', 'btn ghost small', 'Clear answer'); clear.type = 'button'; clear.addEventListener('click', () => chooseAnswer('')); topRow.append(clear);
  const options = tag('div', 'option-grid'); options.id = 'options';
  const stepBtns = tag('div', 'exam-actions'); stepBtns.style.marginTop = '17px';
  const prev = tag('button', 'btn secondary small', '← Previous'); prev.id = 'prevQuestion'; prev.onclick = () => { if (current > 0) { current--; renderQuestion(); } };
  const next = tag('button', 'btn secondary small', 'Next →'); next.id = 'nextQuestion'; next.onclick = () => { if (current < exam.questionCount - 1) { current++; renderQuestion(); } };
  stepBtns.append(prev, next);
  const line = tag('div', 'divider');
  const progressTitle = tag('div', 'status-line'); progressTitle.append(tag('strong', 'small', 'Question Navigation'));
  const progressNum = tag('span', 'small muted'); progressNum.id = 'progressNumber'; progressTitle.append(progressNum);
  const track = tag('div', 'progress-track'); track.style.marginTop = '10px'; const fill = tag('span'); fill.id = 'progressBar'; track.append(fill);
  const navigation = tag('div', 'question-nav'); navigation.id = 'questionNav';
  const note = tag('p', 'small muted', 'Green = answered. Blue outline = current question. Answer changes save automatically.'); note.style.marginTop = '12px';
  const error = tag('div', 'alert error hidden'); error.id = 'examError';
  const submit = tag('button', 'btn full', 'Submit Exam'); submit.id = 'submitExam'; submit.style.marginTop = '15px';
  submit.addEventListener('click', () => { if (confirm('Are you sure you want to submit the exam?')) submitExam(); });
  body.append(topRow, options, stepBtns, line, progressTitle, track, navigation, note, error, submit);
  pane.append(paneTop, body); main.append(pdf, pane); app.append(header, main);
  for (let i = 0; i < exam.questionCount; i++) {
    const q = tag('button', 'qnav', String(i + 1)); q.type = 'button'; q.dataset.question = i;
    q.addEventListener('click', () => { current = i; renderQuestion(); }); navigation.append(q);
  }
  current = 0; renderQuestion(); updateTimer(); ticker = setInterval(updateTimer, 250);
}
function renderQuestion() {
  $('currentTitle').textContent = `Question ${current + 1} / ${exam.questionCount}`;
  const opts = $('options'); opts.replaceChildren();
  for (const option of ['A', 'B', 'C', 'D']) {
    const label = tag('label', 'option');
    const input = tag('input'); input.type = 'radio'; input.name = 'answer'; input.value = option; input.checked = answers[current] === option;
    input.addEventListener('change', () => chooseAnswer(option));
    label.append(input, document.createTextNode(option)); opts.append(label);
  }
  $('prevQuestion').disabled = current === 0; $('nextQuestion').disabled = current === exam.questionCount - 1;
  const complete = answers.filter(Boolean).length;
  $('answeredLabel').textContent = `${complete} / ${exam.questionCount} answered`;
  $('progressNumber').textContent = `${complete} of ${exam.questionCount}`;
  $('progressBar').style.width = `${complete / exam.questionCount * 100}%`;
  for (const b of $('questionNav').children) {
    const i = Number(b.dataset.question);
    b.className = `qnav${answers[i] ? ' answered' : ''}${i === current ? ' current' : ''}`;
  }
}
function chooseAnswer(answer) {
  if (busy || Date.now() + clockSkew >= deadline) return;
  const index = current;
  answers[index] = answer; renderQuestion(); setError('examError', '');
  const request = api('/api/attempts/answer', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, questionIndex: index, answer }) });
  pendingSaves.add(request);
  request.catch(err => setError('examError', `Answer save problem: ${err.message}. Submit sends your latest answers if time remains.`)).finally(() => pendingSaves.delete(request));
}
function remainingMs() { return deadline - (Date.now() + clockSkew); }
function updateTimer() {
  if (!$('countdown') || busy) return;
  const remain = Math.max(0, remainingMs());
  const seconds = Math.ceil(remain / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  $('countdown').textContent = `${hours ? `${String(hours).padStart(2,'0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  $('countdown').classList.toggle('urgent', remain < 60000);
  if (remain <= 0) submitExam(true);
}
async function submitExam(automatic = false) {
  if (busy) return;
  busy = true; clearInterval(ticker);
  const submit = $('submitExam'); if (submit) { submit.disabled = true; submit.textContent = 'Submitting…'; }
  try {
    // Wait for in-flight autosaves. After time expires the server grades stored answers only.
    await Promise.allSettled([...pendingSaves]);
    const state = await api('/api/attempts/submit', json({ token, answers }));
    hydrate(state);
  } catch (err) {
    busy = false;
    setError('examError', `${automatic ? 'Automatic submission' : 'Submission'} failed: ${err.message}. Please try Submit Exam again.`);
    if (submit) { submit.disabled = false; submit.textContent = 'Retry Submit Exam'; }
    if (remainingMs() > 0) ticker = setInterval(updateTimer, 250);
  }
}
function showResult(state) {
  clearInterval(ticker); busy = true; app.replaceChildren();
  const result = state.result;
  const section = tag('section', 'card result-card');
  const badge = tag('span', 'chip green', 'Exam Submitted Successfully');
  const h = tag('h1', '', exam.title); h.style.margin = '12px 0 0';
  const subtitle = tag('p', 'muted', `Student: ${state.studentName}`);
  const score = tag('div', 'result-number', `${result.mark} / ${result.possibleMarks}`);
  const scoreHint = tag('div', 'muted small', `Total Marks · ${result.negativePercentage ? `${result.negativePercentage}% negative marking for wrong answer` : 'No negative marking'}`);
  section.append(badge, h, subtitle, score, scoreHint);
  const details = tag('div', 'result-detail');
  for (const [val, caption] of [[result.correctCount, 'Correct'], [result.wrongNumbers.length, 'Wrong'], [result.skippedNumbers.length, 'Skipped']]) {
    const div = tag('div'); div.append(tag('strong', '', String(val)), tag('span', 'small muted', caption)); details.append(div);
  }
  section.append(details);
  const wrongTitle = tag('h3', '', 'Wrong MCQ Numbers'); section.append(wrongTitle);
  if (!result.wrongNumbers.length) section.append(tag('p', 'muted', 'No wrong answers.'));
  else { const badges = tag('div', 'number-tags'); result.wrongNumbers.forEach(n => badges.append(tag('span', '', `Q${n}`))); section.append(badges); }
  const skipped = tag('h3', '', 'Unanswered MCQ Numbers'); skipped.style.marginTop = '21px'; section.append(skipped);
  if (!result.skippedNumbers.length) section.append(tag('p', 'muted', 'All questions attempted.'));
  else { const badges = tag('div', 'number-tags gray'); result.skippedNumbers.forEach(n => badges.append(tag('span', '', `Q${n}`))); section.append(badges); }
  const home = tag('a', 'btn secondary full', 'Back to All Exams'); home.href = '/'; home.style.marginTop = '25px'; section.append(home);
  app.append(section);
}
async function init() {
  if (!examId) { app.replaceChildren(tag('div', 'alert error', 'Invalid exam link: missing exam ID.')); return; }
  try {
    token = getSavedToken();
    if (token) {
      try { const state = await api('/api/attempts/restore', json({ token })); hydrate(state); return; }
      catch (err) { if (!err.message.includes('not found')) throw err; token = ''; }
    }
    exam = await api(`/api/exams/${encodeURIComponent(examId)}`);
    showStart();
  } catch (err) { app.replaceChildren(tag('div', 'alert error', err.message)); }
}
init();
