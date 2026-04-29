const dayjs = require('dayjs');

function nowIso() {
  return dayjs().toISOString();
}

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return v === true || v === 'true' || v === 1 || v === '1';
}

function parsePagination(query) {
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '10', 10), 1), 100);
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

function toInClause(ids = []) {
  if (!ids.length) return { clause: '(NULL)', params: {} };
  const keys = ids.map((_, i) => `id${i}`);
  const params = keys.reduce((acc, key, i) => {
    acc[key] = ids[i];
    return acc;
  }, {});
  return { clause: `(${keys.map((k) => `@${k}`).join(',')})`, params };
}

module.exports = { nowIso, parseBool, parsePagination, toInClause };
