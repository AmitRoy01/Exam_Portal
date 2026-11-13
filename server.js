'use strict';
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('node:crypto');
const path = require('node:path');

const { MONGODB_URI, ADMIN_PASSWORD, SESSION_SECRET, PUBLIC_URL } = process.env;
const PORT = Number(process.env.PORT || 3000);
// Throw instead of process.exit() so a serverless function reports the error instead of being killed.
if (!MONGODB_URI || !ADMIN_PASSWORD || !SESSION_SECRET) {
  throw new Error('Missing MONGODB_URI, ADMIN_PASSWORD or SESSION_SECRET. Copy .env.example to .env (or set them in your hosting provider) and configure.');
}
if (process.env.NODE_ENV === 'production' && (ADMIN_PASSWORD.length < 12 || SESSION_SECRET.length < 32)) {
  throw new Error('For production set ADMIN_PASSWORD >= 12 characters and SESSION_SECRET >= 32 characters.');
}
const isProduction = process.env.NODE_ENV === 'production';
// Set by netlify/functions/*.js before requiring this file.
const onNetlify = process.env.RUNNING_ON_NETLIFY === '1';
const configuredBaseUrl = PUBLIC_URL ? PUBLIC_URL.replace(/\/$/, '') : '';
// Without PUBLIC_URL, build links from the request's own host (works on any Netlify domain).
function baseUrlFor(req) { return configuredBaseUrl || `${req.protocol}://${req.get('host')}`; }

// One cached connection per process / serverless container (reused across warm invocations).
let connectionPromise = null;
function connectDb() {
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: onNetlify ? 8000 : 15000, maxPoolSize: onNetlify ? 5 : 100 })
      .then(async m => {
        await m.connection.collection('rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        return m;
      })
      .catch(err => { connectionPromise = null; throw err; });
  }
  return connectionPromise;
}
// Never rejects: keeps retrying, so a transient MongoDB failure can't leave the session store permanently broken.
function waitForMongoClient() {
  return connectDb().then(m => m.connection.getClient(),
    () => new Promise(resolve => setTimeout(resolve, 2000)).then(waitForMongoClient));
}

// Rate-limit counters live in MongoDB, so limits hold across all serverless instances (memory would reset per instance).
class MongoRateLimitStore {
  constructor(prefix) { this.prefix = prefix; this.localKeys = false; }
  init(options) { this.windowMs = options.windowMs; }
  collection() { return mongoose.connection.collection('rate_limits'); }
  async increment(key) {
    const now = new Date();
    const doc = await this.collection().findOneAndUpdate({ _id: this.prefix + key }, [
      { $set: { _expired: { $or: [{ $not: ['$expiresAt'] }, { $lte: ['$expiresAt', now] }] } } },
      { $set: {
        hits: { $cond: ['$_expired', 1, { $add: ['$hits', 1] }] },
        expiresAt: { $cond: ['$_expired', new Date(now.getTime() + this.windowMs), '$expiresAt'] }
      } },
      { $unset: '_expired' }
    ], { upsert: true, returnDocument: 'after' });
    return { totalHits: doc.hits, resetTime: doc.expiresAt };
  }
  async decrement(key) { await this.collection().updateOne({ _id: this.prefix + key, hits: { $gt: 0 } }, { $inc: { hits: -1 } }); }
  async resetKey(key) { await this.collection().deleteOne({ _id: this.prefix + key }); }
}

const examSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 150 },
  driveFileId: { type: String, required: true },
  questionCount: { type: Number, required: true, min: 1, max: 200 },
  durationMinutes: { type: Number, required: true, min: 1, max: 360 },
  negativePercentage: { type: Number, required: true, min: 0, max: 100 },
  answerKey: { type: [String], required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true, versionKey: false });
const attemptSchema = new mongoose.Schema({
  examId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Exam', index: true },
  studentName: { type: String, required: true },
  tokenHash: { type: String, required: true, unique: true },
  startedAt: { type: Date, required: true },
  deadlineAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ['active', 'grading', 'completed'], default: 'active', index: true },
  answers: { type: [String], default: [] },
  mark: { type: Number },
  correctCount: { type: Number },
  wrongNumbers: { type: [Number], default: [] },
  skippedNumbers: { type: [Number], default: [] },
  // Temporary attempt details expire 24 hours after the exam deadline.
  // Permanent results remain in the separate results collection.
  expiresAt: { type: Date, index: { expires: 0 } }
}, { timestamps: true, versionKey: false });
// Result documents intentionally contain ONLY these three user data fields, plus MongoDB _id.
const resultSchema = new mongoose.Schema({
  studentName: { type: String, required: true },
  examName: { type: String, required: true },
  mark: { type: Number, required: true }
}, { versionKey: false });
const Exam = mongoose.model('Exam', examSchema);
const Attempt = mongoose.model('Attempt', attemptSchema);
const Result = mongoose.model('Result', resultSchema);

const app = express();
if (isProduction || onNetlify) app.set('trust proxy', 1);
app.disable('x-powered-by');
// Netlify may deliver the rewritten path (/.netlify/functions/api/...) instead of the original /api/...
app.use((req, res, next) => {
  const fnPrefix = '/.netlify/functions/api';
  if (req.url === fnPrefix || req.url.startsWith(fnPrefix + '/') || req.url.startsWith(fnPrefix + '?')) req.url = '/api' + req.url.slice(fnPrefix.length);
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Existing layout uses inline styles; scripts remain self-only.
      imgSrc: ["'self'", 'data:'],
      frameSrc: ["'self'", 'https://drive.google.com', 'https://docs.google.com'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '15m' }));
// Make sure MongoDB is connected before any API handler runs (needed on serverless cold starts).
app.use('/api', (req, res, next) => { connectDb().then(() => next(), next); });
app.use(session({
  name: 'drive_mcq_sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Share the mongoose connection instead of opening a second MongoDB client.
  store: MongoStore.create({ clientPromise: waitForMongoClient(), collectionName: 'web_sessions', ttl: 12 * 3600 }),
  cookie: { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 12 * 3600 * 1000 }
}));

function fail(res, message, status = 400) { return res.status(status).json({ error: message }); }
function requireAdmin(req, res, next) { if (!req.session.admin) return fail(res, 'Teacher login required.', 401); next(); }
function comparePassword(actual, expected) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(String(actual)).digest(), crypto.createHash('sha256').update(String(expected)).digest());
}
function safeId(value) { return mongoose.isValidObjectId(value); }
function publicExam(e, withViewer = false) {
  const data = { id: String(e._id), title: e.title, questionCount: e.questionCount, durationMinutes: e.durationMinutes, negativePercentage: e.negativePercentage };
  if (withViewer) data.previewUrl = `https://drive.google.com/file/d/${encodeURIComponent(e.driveFileId)}/preview`;
  return data;
}
const { parseDriveFileId, validAnswerList, cleanAnswers, scoreExam } = require('./logic');
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
async function finalizeAttempt(attemptId, submittedAnswers) {
  let attempt = await Attempt.findById(attemptId);
  if (!attempt) throw new Error('Attempt not found');
  if (attempt.status === 'completed') return attempt;
  if (attempt.status === 'grading') {
    const exam = await Exam.findById(attempt.examId);
    if (!exam) throw new Error('Exam not found');
    const computed = scoreExam(exam, attempt.answers);
    // Idempotent: the Result's _id equals its Attempt's _id, so an interrupted grading can resume.
    await Result.updateOne(
      { _id: attempt._id },
      { $setOnInsert: { studentName: attempt.studentName, examName: exam.title, mark: computed.mark } },
      { upsert: true }
    );
    return Attempt.findByIdAndUpdate(attempt._id, { $set: { status: 'completed', ...computed } }, { new: true });
  }
  const exam = await Exam.findById(attempt.examId);
  if (!exam) throw new Error('Exam not found');
  // Answers received *after* the deadline are disregarded; saved answers still count.
  const withinTime = Date.now() <= attempt.deadlineAt.getTime();
  const finalAnswers = withinTime && Array.isArray(submittedAnswers)
    ? cleanAnswers(submittedAnswers, exam.questionCount)
    : cleanAnswers(attempt.answers, exam.questionCount);
  attempt = await Attempt.findOneAndUpdate(
    { _id: attempt._id, status: 'active' },
    { $set: { status: 'grading', answers: finalAnswers } }, { new: true }
  );
  if (!attempt) return finalizeAttempt(attemptId);
  const summary = scoreExam(exam, finalAnswers);
  await Result.updateOne(
    { _id: attempt._id },
    { $setOnInsert: { studentName: attempt.studentName, examName: exam.title, mark: summary.mark } },
    { upsert: true }
  );
  return Attempt.findByIdAndUpdate(attempt._id, { $set: { status: 'completed', ...summary } }, { new: true });
}
function attemptView(a, exam) {
  return {
    exam: publicExam(exam, true), studentName: a.studentName,
    deadlineAt: a.deadlineAt.toISOString(), serverTime: new Date().toISOString(),
    answers: cleanAnswers(a.answers, exam.questionCount), status: a.status,
    ...(a.status === 'completed' ? {
      result: { mark: a.mark, possibleMarks: exam.questionCount, correctCount: a.correctCount,
        wrongNumbers: a.wrongNumbers, skippedNumbers: a.skippedNumbers, negativePercentage: exam.negativePercentage }
    } : {})
  };
}

// On Netlify the real client IP is in x-nf-client-connection-ip (set by Netlify's edge, not the browser).
function clientKey(req) { return (onNetlify && req.get('x-nf-client-connection-ip')) || req.ip || 'unknown'; }
const limiterDefaults = { standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: clientKey };
const loginLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60 * 1000, limit: 12, store: new MongoRateLimitStore('login:'), message: { error: 'Too many attempts. Try later.' } });
const startLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 1000, limit: 15, store: new MongoRateLimitStore('start:'), message: { error: 'Too many requests. Try again in a minute.' } });
app.get('/api/admin/status', (req, res) => res.json({ loggedIn: !!req.session.admin }));
app.post('/api/admin/login', loginLimiter, (req, res) => {
  if (!comparePassword(req.body?.password || '', ADMIN_PASSWORD)) return fail(res, 'Wrong teacher password.', 401);
  req.session.regenerate(err => {
    if (err) return fail(res, 'Could not start session.', 500);
    req.session.admin = true;
    res.json({ success: true });
  });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => req.session.destroy(() => { res.clearCookie('drive_mcq_sid'); res.json({ success: true }); }));

app.post('/api/admin/exams', requireAdmin, async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const questionCount = Number(req.body?.questionCount);
    const durationMinutes = Number(req.body?.durationMinutes);
    const negativePercentage = Number(req.body?.negativePercentage ?? 0);
    const answerKey = req.body?.answerKey;
    const driveFileId = parseDriveFileId(req.body?.driveUrl);
    if (!title || title.length > 150) return fail(res, 'Enter an exam title (up to 150 characters).');
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 200) return fail(res, 'Question count must be 1–200.');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 360) return fail(res, 'Duration must be 1–360 minutes.');
    if (!Number.isFinite(negativePercentage) || negativePercentage < 0 || negativePercentage > 100) return fail(res, 'Negative marking must be 0–100%.');
    if (!validAnswerList(answerKey, questionCount)) return fail(res, 'Set the correct answer (A/B/C/D) for every question.');
    if (!driveFileId) return fail(res, 'Paste the individual Google Drive PDF/image file share link (not a folder link).');
    const exam = await Exam.create({ title, questionCount, durationMinutes, negativePercentage,
      answerKey, driveFileId });
    res.status(201).json({ exam: publicExam(exam, true), shareUrl: `${baseUrlFor(req)}/exam.html?id=${exam._id}` });
  } catch (e) { next(e); }
});
app.get('/api/admin/exams', requireAdmin, async (req, res, next) => {
  try {
    const exams = await Exam.find().sort({ createdAt: -1 }).lean();
    res.json(exams.map(e => ({ ...publicExam(e), active: e.active,
      createdAt: e.createdAt, shareUrl: `${baseUrlFor(req)}/exam.html?id=${e._id}` })));
  } catch (e) { next(e); }
});
app.patch('/api/admin/exams/:id/toggle', requireAdmin, async (req, res, next) => {
  try {
    if (!safeId(req.params.id)) return fail(res, 'Invalid exam ID.');
    const exam = await Exam.findById(req.params.id);
    if (!exam) return fail(res, 'Exam not found.', 404);
    exam.active = !exam.active;
    await exam.save();
    res.json({ active: exam.active });
  } catch (e) { next(e); }
});
app.get('/api/admin/results', requireAdmin, async (req, res, next) => {
  try {
    const results = await Result.find().select('studentName examName mark').sort({ _id: -1 }).limit(2000).lean();
    res.json(results.map(r => ({ studentName: r.studentName, examName: r.examName, mark: r.mark })));
  } catch (e) { next(e); }
});

app.get('/api/exams', async (req, res, next) => {
  try { res.json((await Exam.find({ active: true }).sort({ createdAt: -1 })).map(e => publicExam(e))); }
  catch (e) { next(e); }
});
app.get('/api/exams/:id', async (req, res, next) => {
  try {
    if (!safeId(req.params.id)) return fail(res, 'Invalid exam link.', 404);
    const e = await Exam.findOne({ _id: req.params.id, active: true });
    if (!e) return fail(res, 'Exam not found or closed.', 404);
    res.json(publicExam(e, true));
  } catch (e) { next(e); }
});
app.post('/api/attempts/start', startLimiter, async (req, res, next) => {
  try {
    if (!safeId(req.body?.examId)) return fail(res, 'Invalid exam.');
    const studentName = String(req.body?.studentName || '').trim().replace(/\s+/g, ' ');
    if (studentName.length < 2 || studentName.length > 100) return fail(res, 'Name must be 2–100 characters.');
    const exam = await Exam.findOne({ _id: req.body.examId, active: true });
    if (!exam) return fail(res, 'Exam not available.', 404);
    const token = crypto.randomBytes(32).toString('hex');
    const startedAt = new Date();
    const deadlineAt = new Date(startedAt.getTime() + exam.durationMinutes * 60 * 1000);
    const attempt = await Attempt.create({ examId: exam._id, studentName, tokenHash: hashToken(token), startedAt, deadlineAt,
      answers: Array.from({ length: exam.questionCount }, () => ''),
      expiresAt: new Date(deadlineAt.getTime() + 24 * 60 * 60 * 1000) });
    res.status(201).json({ token, ...attemptView(attempt, exam) });
  } catch (e) { next(e); }
});
async function findAttempt(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  return Attempt.findOne({ tokenHash: hashToken(token) });
}
app.post('/api/attempts/restore', async (req, res, next) => {
  try {
    let attempt = await findAttempt(req.body?.token);
    if (!attempt) return fail(res, 'Exam session not found. Open exam link and start again.', 404);
    if (attempt.status !== 'completed' && Date.now() >= attempt.deadlineAt.getTime()) attempt = await finalizeAttempt(attempt._id);
    const exam = await Exam.findById(attempt.examId);
    if (!exam) return fail(res, 'Exam deleted.', 404);
    res.json(attemptView(attempt, exam));
  } catch (e) { next(e); }
});
app.patch('/api/attempts/answer', async (req, res, next) => {
  try {
    const attempt = await findAttempt(req.body?.token);
    if (!attempt) return fail(res, 'Exam session not found.', 404);
    if (attempt.status !== 'active') return fail(res, 'Exam already submitted.', 409);
    if (Date.now() >= attempt.deadlineAt.getTime()) return fail(res, 'Time is up. Submit to see your result.', 409);
    const i = Number(req.body?.questionIndex);
    const answer = req.body?.answer;
    if (!Number.isInteger(i) || i < 0 || i >= attempt.answers.length || !['A', 'B', 'C', 'D', ''].includes(answer)) return fail(res, 'Invalid answer.');
    const updated = await Attempt.updateOne({ _id: attempt._id, status: 'active', deadlineAt: { $gt: new Date() } }, { $set: { [`answers.${i}`]: answer } });
    if (!updated.matchedCount) return fail(res, 'Answer was not saved; exam may have ended.', 409);
    res.json({ saved: true });
  } catch (e) { next(e); }
});
app.post('/api/attempts/submit', async (req, res, next) => {
  try {
    const attempt = await findAttempt(req.body?.token);
    if (!attempt) return fail(res, 'Exam session not found.', 404);
    const exam = await Exam.findById(attempt.examId);
    if (!exam) return fail(res, 'Exam not found.', 404);
    const inputAnswers = Array.isArray(req.body.answers) && req.body.answers.length === exam.questionCount ? req.body.answers : undefined;
    const completed = await finalizeAttempt(attempt._id, inputAnswers);
    res.json(attemptView(completed, exam));
  } catch (e) { next(e); }
});
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = typeof err.status === 'number' && err.status >= 400 && err.status <= 599 ? err.status : 500;
  return fail(res, status >= 500 && status !== 502 ? 'Server error.' : err.message, status);
});

// Grades attempts whose deadline passed, even if the student closed the tab.
// Runs on a 30s timer locally, and as a Netlify Scheduled Function (netlify/functions/auto-grade.js) in production.
async function gradeExpiredAttempts(limit = 100) {
  await connectDb();
  const expired = await Attempt.find({ status: { $in: ['active', 'grading'] }, deadlineAt: { $lte: new Date() } }).limit(limit).select('_id');
  let graded = 0;
  for (const item of expired) {
    try { await finalizeAttempt(item._id); graded++; } catch (err) { console.error('Auto-grade failed', item._id, err); }
  }
  return graded;
}

async function startup() {
  await connectDb();
  const expiredTimer = setInterval(() => {
    gradeExpiredAttempts().catch(err => console.error('Expired-attempt scan failed', err));
  }, 30000);
  expiredTimer.unref();
  app.listen(PORT, () => console.log(`Drive MCQ Exam running at ${configuredBaseUrl || `http://localhost:${PORT}`}`));
}
if (require.main === module) startup().catch(e => { console.error('Startup failed:', e); process.exit(1); });
module.exports = { app, connectDb, gradeExpiredAttempts, Exam, Attempt, Result, parseDriveFileId, validAnswerList, scoreExam, cleanAnswers };
