'use strict';
// Netlify Scheduled Function (schedule is set in netlify.toml): grades attempts whose timer has expired,
// so results are saved even when the student closed the tab. Replaces the local setInterval in server.js.
process.env.RUNNING_ON_NETLIFY = '1';
if (!process.env.NETLIFY_DEV && !process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const { gradeExpiredAttempts } = require('../../server');

exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  let total = 0;
  // Keep going while full batches come back, but stay well inside the scheduled-function time limit.
  const startedAt = Date.now();
  for (;;) {
    const graded = await gradeExpiredAttempts(100);
    total += graded;
    if (graded < 100 || Date.now() - startedAt > 20000) break;
  }
  if (total) console.log(`Auto-graded ${total} expired attempt(s).`);
  return { statusCode: 200 };
};
