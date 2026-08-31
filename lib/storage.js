// Tiny key-value storage used for admin mode (owner id, pending sticker
// capture, saved sticker file_ids). Backed by Upstash Redis's REST API so no
// extra client library or persistent connection is needed on Vercel.
//
// Requires env vars:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// (create a free Redis database at https://upstash.com — the REST URL and
// token are shown on the database page, no extra setup needed)

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function call(...parts) {
  if (!BASE || !TOKEN) {
    throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN env vars are not set');
  }
  const url = `${BASE}/${parts.map((p) => encodeURIComponent(p)).join('/')}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await r.json();
  return data.result;
}

async function kvGet(key) {
  return call('get', key);
}

async function kvSet(key, value) {
  return call('set', key, value);
}

async function kvDel(key) {
  return call('del', key);
}

// Sorted-set helpers, used for the edit-count leaderboard.
async function zIncrBy(key, increment, member) {
  return call('zincrby', key, String(increment), String(member));
}

async function zScore(key, member) {
  return call('zscore', key, String(member));
}

// Returns a flat [member, score, member, score, ...] array, highest score first.
async function zRevRangeWithScores(key, start, stop) {
  const result = await call('zrevrange', key, String(start), String(stop), 'withscores');
  return result || [];
}

// List helpers, used for each user's "my edits" library (most recent first).
async function lpush(key, value) {
  return call('lpush', key, value);
}

async function ltrim(key, start, stop) {
  return call('ltrim', key, String(start), String(stop));
}

async function lrange(key, start, stop) {
  const result = await call('lrange', key, String(start), String(stop));
  return result || [];
}

module.exports = { kvGet, kvSet, kvDel, zIncrBy, zScore, zRevRangeWithScores, lpush, ltrim, lrange };
