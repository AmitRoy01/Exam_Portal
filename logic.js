'use strict';
function parseDriveFileId(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return null;
    let id = null;
    const match = u.pathname.match(/^\/file\/d\/([a-zA-Z0-9_-]{10,})(?:\/|$)/);
    if (match) id = match[1];
    else if (['/open', '/uc'].includes(u.pathname)) id = u.searchParams.get('id');
    // A shared folder URL is not a file URL, even when the folder is public.
    return id && /^[a-zA-Z0-9_-]{10,}$/.test(id) ? id : null;
  } catch { return null; }
}
function validAnswerList(arr, count) {
  return Array.isArray(arr) && arr.length === count && arr.every(x => ['A', 'B', 'C', 'D'].includes(x));
}
function cleanAnswers(value, count) {
  return Array.from({ length: count }, (_, i) => ['A', 'B', 'C', 'D'].includes(value?.[i]) ? value[i] : '');
}
function scoreExam(exam, answers) {
  let correctCount = 0; const wrongNumbers = []; const skippedNumbers = [];
  for (let i = 0; i < exam.questionCount; i++) {
    if (!answers[i]) skippedNumbers.push(i + 1);
    else if (answers[i] === exam.answerKey[i]) correctCount++;
    else wrongNumbers.push(i + 1);
  }
  const raw = correctCount - wrongNumbers.length * exam.negativePercentage / 100;
  const mark = Math.round((raw + Number.EPSILON) * 100) / 100;
  return { mark, correctCount, wrongNumbers, skippedNumbers };
}

module.exports = { parseDriveFileId, validAnswerList, cleanAnswers, scoreExam };
