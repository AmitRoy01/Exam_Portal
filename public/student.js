'use strict';
const $ = id => document.getElementById(id);
function el(tag, className, text) { const x = document.createElement(tag); if (className) x.className = className; if (text !== undefined) x.textContent = text; return x; }
async function loadExams() {
  try {
    const res = await fetch('/api/exams');
    if (!res.ok) throw new Error('Could not load exams.');
    const exams = await res.json();
    $('count').textContent = `${exams.length} exam${exams.length === 1 ? '' : 's'}`;
    $('examList').replaceChildren();
    if (!exams.length) { const card = el('div', 'card loading', 'No exams published yet. Please check back later.'); $('examList').append(card); return; }
    for (const exam of exams) {
      const card = el('article', 'card exam-item');
      card.append(el('div', 'chip blue', 'MCQ TEST'), el('h3', 'exam-title', exam.title));
      const meta = el('div', 'exam-meta');
      meta.append(el('span', 'chip', `${exam.questionCount} Questions`), el('span', 'chip', `${exam.durationMinutes} Minutes`), el('span', 'chip', exam.negativePercentage ? `−${exam.negativePercentage}% per wrong` : 'No Negative Marking'));
      card.append(meta, el('div', 'grow'));
      const link = el('a', 'btn full', 'Start Exam'); link.href = `/exam.html?id=${encodeURIComponent(exam.id)}`;
      card.append(link); $('examList').append(card);
    }
  } catch (err) { $('error').textContent = err.message; $('error').classList.remove('hidden'); $('examList').replaceChildren(); $('count').textContent = 'Unavailable'; }
}
loadExams();
