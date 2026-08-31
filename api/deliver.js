// Reliable "save" path: verifies the Mini App's initData (per Telegram's official
// HMAC scheme) and pushes the edited image into the user's own chat with the bot.
// This works from inside Telegram's WebView even where <a download> or Web Share fail.
//
// POST /api/deliver   body: { initData: string, image: "data:image/png;base64,..." }
// Requires env var: BOT_TOKEN

const crypto = require('crypto');
const { kvGet } = require('../lib/storage');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

function langFor(user) {
  const code = ((user && user.language_code) || '').toLowerCase();
  return code.startsWith('fa') ? 'fa' : 'en';
}

function validateInitData(initData) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;

  const userStr = params.get('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  try {
    const { initData, image } = req.body || {};
    if (!initData || !image) {
      res.status(400).json({ ok: false, error: 'missing fields' });
      return;
    }

    const user = validateInitData(initData);
    if (!user || !user.id) {
      res.status(401).json({ ok: false, error: 'invalid initData' });
      return;
    }

    const base64 = image.includes(',') ? image.split(',')[1] : image;
    const buf = Buffer.from(base64, 'base64');

    // ~4.5MB request-body ceiling on Vercel serverless functions
    if (buf.byteLength > 4.3 * 1024 * 1024) {
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

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('deliver error', err);
    res.status(500).json({ ok: false, error: 'server error' });
  }
};
