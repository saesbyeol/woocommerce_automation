'use strict';

const log = (level, msg, meta = {}) => {
  console.log(JSON.stringify({ level, msg, ...meta, ts: new Date().toISOString() }));
};

const logger = {
  info:  (msg, meta) => log('info',  msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  error: (msg, meta) => log('error', msg, meta),
};

module.exports = logger;
