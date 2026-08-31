// Reliable "save" path: verifies the Mini App's initData (per Telegram's official
// HMAC scheme) and pushes the edited image (or a short silent GIF-style video of it)
// into the user's own chat with the bot. This works from inside Telegram's WebView
// even where <a download> or Web Share fail.
//
// POST /api/deliver   body: { initData: string, image?: "data:image/png;base64,...", video?: "base64 webm" }
// Requires env var: BOT_TOKEN

const { validateInitData, langFor } = require('../lib/telegram');
const { kvGet, kvSet, zIncrBy } = require('../lib/storage');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MAX_BYTES = 4.3 * 1024 * 1024; // ~4.5MB request-body ceiling on Vercel serverless functions

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const { initData, image, video } = req.body || {};
    if (!initData || (!image && !video)) {
      res.status(400).json({ ok: false, error: 'missing fields' });
      return;
    }

    const user = validateInitData(initData, BOT_TOKEN);
    if (!user || !user.id) {
      res.status(401).json({ ok: false, error: 'invalid initData' });
      return;
    }

    if (video) {
      const base64 = video.includes(',') ? video.split(',')[1] : video;
      const buf = Buffer.from(base64, 'base64');
      if (buf.byteLength > MAX_BYTES) {
        res.status(413).json({ ok: false, error: 'video too large' });
        return;
      }
      const form = new FormData();
      form.append('chat_id', String(user.id));
      form.append('animation', new Blob([buf], { type: 'video/webm' }), 'edifast.webm');

      const tgRes = await fetch(`${API}/sendAnimation`, { method: 'POST', body: form });
      const data = await tgRes.json();
      if (!data.ok) {
        res.status(502).json({ ok: false, error: data.description || 'telegram error' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    const base64 = image.includes(',') ? image.split(',')[1] : image;
    const buf = Buffer.from(base64, 'base64');
    if (buf.byteLength > MAX_BYTES) {
      res.status(413).json({ ok: false, error: 'image too large' });
      return;
    }

    const form = new FormData();
    form.append('chat_id', String(user.id));
    form.append('document', new Blob([buf], { type: 'image/png' }), 'edited-image.png');

    const tgRes = await fetch(`${API}/sendDocument`, { method: 'POST', body: form });
    const data = await tgRes.json();
    if (!data.ok) {
      res.status(502).json({ ok: false, error: data.description || 'telegram error' });
      return;
    }

    // Owner-configured "delivered" sticker, sent after the edited image.
    const lang = langFor(user);
    const sticker = await kvGet(`sticker:send_${lang}`);
    if (sticker) {
      await fetch(`${API}/sendSticker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: user.id, sticker }),
      });
    }

    // Count this as one edit, for the home-screen profile card + leaderboard.
    try {
      await zIncrBy('edits_zset', 1, user.id);
      const existing = await kvGet(`user:${user.id}`);
      if (!existing) {
        const profile = {
          id: user.id,
          name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || String(user.id),
          username: user.username || '',
          photo_url: user.photo_url || null,
        };
        await kvSet(`user:${user.id}`, JSON.stringify(profile));
      }
    } catch (e) {
      console.error('edit-count update failed', e);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('deliver error', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};
