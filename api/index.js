'use strict';
// Vercel Function that serves every /api/* request with the Express app from server.js.
// vercel.json rewrites /api/* here; req.url keeps the original path, so Express routes match as usual.
// Vercel runtime is always HTTPS; default to production unless running under `vercel dev`.
if (process.env.VERCEL_ENV !== 'development' && !process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const { app } = require('../server');

module.exports = app;
