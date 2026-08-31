// GET /api/leaderboard — top 3 users by edit count, for the home screen.

const { kvGet, zRevRangeWithScores } = require('../lib/storage');

module.exports = async (req, res) => {
  try {
    const flat = await zRevRangeWithScores('edits_zset', 0, 2);
    const list = [];
    for (let i = 0; i < flat.length; i += 2) {
      const id = flat[i];
      const edits = Number(flat[i + 1]) || 0;
      let user = {};
      try {
        const raw = await kvGet(`user:${id}`);
        user = raw ? JSON.parse(raw) : {};
      } catch (e) {}
      list.push({
        id,
        edits,
        name: user.name || '',
        username: user.username || '',
        photo_url: user.photo_url || null,
      });
    }
    res.status(200).json({ ok: true, leaderboard: list });
  } catch (err) {
    console.error('leaderboard error', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};
