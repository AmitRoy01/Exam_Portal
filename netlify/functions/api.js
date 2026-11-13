'use strict';
// Netlify Function that serves every /api/* request with the Express app from server.js.
// netlify.toml rewrites /api/* to /.netlify/functions/api/:splat.
process.env.RUNNING_ON_NETLIFY = '1';
// Netlify runtime is always HTTPS; default to production unless running under `netlify dev`.
if (!process.env.NETLIFY_DEV && !process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const serverless = require('serverless-http');
const { app } = require('../../server');

const handle = serverless(app);

exports.handler = async (event, context) => {
  // Return as soon as the response is ready; keep the MongoDB connection open for the next warm invocation.
  context.callbackWaitsForEmptyEventLoop = false;
  return handle(event, context);
};
