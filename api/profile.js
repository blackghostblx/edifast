// POST /api/profile   body: { initData: string }
// Verifies the Mini App's initData, saves/refreshes the user's info (needed
// so their avatar/name can show up on the leaderboard later), and returns
// their current edit count for the home screen.
// Requires env var: BOT_TOKEN

const { validateInitData } = require('../lib/telegram');
const { kvGet, kvSet, zScore } = require('../lib/storage');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const { initData } = req.body || {};
    const user = validateInitData(initData, process.env.BOT_TOKEN);
    if (!user || !user.id) {
      res.status(401).json({ ok: false, error: 'invalid initData' });
      return;
    }

    const profile = {
      id: user.id,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id),
      username: user.username || '',
      photo_url: user.photo_url || null,
    };

    // Keep the existing photo_url if this session's initData didn't include one.
    try {
      const prevRaw = await kvGet(`user:${user.id}`);
      const prev = prevRaw ? JSON.parse(prevRaw) : null;
      if (!profile.photo_url && prev && prev.photo_url) profile.photo_url = prev.photo_url;
    } catch (e) {}

    await kvSet(`user:${user.id}`, JSON.stringify(profile));
    const score = await zScore('edits_zset', user.id);

    res.status(200).json({ ok: true, profile, edits: Number(score) || 0 });
  } catch (err) {
    console.error('profile error', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};
