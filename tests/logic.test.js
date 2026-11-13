'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDriveFileId, validAnswerList, cleanAnswers, scoreExam } = require('../logic');

test('Drive file and open share links parse; non-Google links rejected', () => {
  assert.equal(parseDriveFileId('https://drive.google.com/file/d/1AbcDefGhijklmnOPQ12345/view?usp=sharing'), '1AbcDefGhijklmnOPQ12345');
  assert.equal(parseDriveFileId('https://drive.google.com/open?id=1AbcDefGhijklmnOPQ12345'), '1AbcDefGhijklmnOPQ12345');
  assert.equal(parseDriveFileId('https://evil.test/file/d/1AbcDefGhijklmnOPQ12345/view'), null);
  assert.equal(parseDriveFileId('http://drive.google.com/file/d/1AbcDefGhijklmnOPQ12345/view'), null);
  assert.equal(parseDriveFileId('not a url'), null);
  assert.equal(parseDriveFileId('https://drive.google.com/drive/folders/1AbcDefGhijklmnOPQ12345'), null);
  assert.equal(parseDriveFileId('https://drive.google.com/drive/folders/anotherfolder?id=1AbcDefGhijklmnOPQ12345'), null);
  assert.equal(parseDriveFileId('https://docs.google.com/document/d/1AbcDefGhijklmnOPQ12345/edit'), null);
});
test('Answer key requires exactly N valid choices', () => {
  assert.equal(validAnswerList(['A','B','C'],3), true);
  assert.equal(validAnswerList(['A','B'],3), false);
  assert.equal(validAnswerList(['A','Z','C'],3), false);
});
test('Penalty percent, wrong and skipped numbers are calculated accurately', () => {
  const exam = { questionCount: 5, answerKey: ['A','B','C','D','A'], negativePercentage: 25 };
  const result = scoreExam(exam, ['A','C','','D','B']);
  assert.deepEqual(result, { mark: 1.5, correctCount: 2, wrongNumbers: [2,5], skippedNumbers: [3] });
});
test('No negative marking and all wrong negative scores', () => {
  const exam = { questionCount: 2, answerKey: ['A','B'], negativePercentage: 0 };
  assert.equal(scoreExam(exam, ['C','A']).mark, 0);
  exam.negativePercentage = 50;
  assert.equal(scoreExam(exam, ['C','A']).mark, -1);
});
test('Invalid answer characters are not counted', () => {
  assert.deepEqual(cleanAnswers(['A','E',null],3), ['A','','']);
});
