// POST /api/history   body: { initData: string }
// Returns the user's most recent photo edits (file_id + type + timestamp) so
// the home screen can show them as a library and let the user tap one to
// re-open it in the editor.

const { validateInitData } = require('../lib/telegram');
const { lrange } = require('../lib/storage');

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

    const raw = await lrange(`history:${user.id}`, 0, 29);
    const history = raw
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);

    res.status(200).json({ ok: true, history });
  } catch (err) {
    console.error('history error', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};
