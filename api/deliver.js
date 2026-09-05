// Reliable "save" path: verifies the Mini App's initData (per Telegram's official
// HMAC scheme) and pushes the edited image (or a real GIF89a file of it) into the
// user's own chat with the bot. This works from inside Telegram's WebView even
// where <a download> or Web Share fail.
//
// Note: sendAnimation only renders inline as an animated GIF for actual GIF (or
// H.264 mp4) files — a webm video gets delivered as a plain video attachment
// instead, so the client always sends a real image/gif file here, not video.
//
// POST /api/deliver   body: { initData: string, image?: "data:image/png;base64,...", gif?: "base64 gif89a", editedVideo?: "base64 webm" }
// Requires env var: BOT_TOKEN

const { validateInitData, langFor } = require('../lib/telegram');
const { kvGet, kvSet, zIncrBy, lpush, ltrim } = require('../lib/storage');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const MAX_BYTES = 4.3 * 1024 * 1024; // ~4.5MB request-body ceiling on Vercel serverless functions

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const { initData, image, gif, editedVideo } = req.body || {};
    if (!initData || (!image && !gif && !editedVideo)) {
      res.status(400).json({ ok: false, error: 'missing fields' });
      return;
    }

    const user = validateInitData(initData, BOT_TOKEN);
    if (!user || !user.id) {
      res.status(401).json({ ok: false, error: 'invalid initData' });
      return;
    }

    if (editedVideo) {
      const base64 = editedVideo.includes(',') ? editedVideo.split(',')[1] : editedVideo;
      const buf = Buffer.from(base64, 'base64');
      if (buf.byteLength > MAX_BYTES) {
        res.status(413).json({ ok: false, error: 'video too large' });
        return;
      }
      const form = new FormData();
      form.append('chat_id', String(user.id));
      form.append('video', new Blob([buf], { type: 'video/webm' }), 'edifast-video.webm');

      const tgRes = await fetch(`${API}/sendVideo`, { method: 'POST', body: form });
      const data = await tgRes.json();
      if (!data.ok) {
        res.status(502).json({ ok: false, error: data.description || 'telegram error' });
        return;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (gif) {
      const base64 = gif.includes(',') ? gif.split(',')[1] : gif;
      const buf = Buffer.from(base64, 'base64');
      if (buf.byteLength > MAX_BYTES) {
        res.status(413).json({ ok: false, error: 'gif too large' });
        return;
      }
      const form = new FormData();
      form.append('chat_id', String(user.id));
      form.append('animation', new Blob([buf], { type: 'image/gif' }), 'edifast.gif');

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

    // Save it into the user's "my edits" library, most recent first (last 30 kept).
    try {
      const fileId = data.result && data.result.document && data.result.document.file_id;
      if (fileId) {
        await lpush(`history:${user.id}`, JSON.stringify({ file_id: fileId, type: 'image', ts: Date.now() }));
        await ltrim(`history:${user.id}`, 0, 29);
      }
    } catch (e) {
      console.error('history push failed', e);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('deliver error', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};
