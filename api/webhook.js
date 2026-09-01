// Telegram webhook handler — deploy on Vercel as /api/webhook
// Requires env var: BOT_TOKEN
// Optional env var: APP_URL (e.g. https://edifast.vercel.app) — otherwise inferred from request host
//
// Admin mode: the very first person who ever sends /start is remembered as
// the owner (see lib/storage.js). Only that user can use the six sticker
// commands below. Sending one of them arms "capture mode" — the next
// sticker that admin sends is saved under that slot. The saved sticker is
// then sent automatically at the matching moment for real users.

const { kvGet, kvSet, kvDel } = require('../lib/storage');

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const ADMIN_ID_KEY = 'admin_id';

// command text (as the owner types it) -> sticker slot name
const ADMIN_COMMANDS = {
  '/ورودفارسی': 'in_fa', // sent before the /start welcome text, Persian users
  '/ورودانگلیسی': 'in_en', // sent before the /start welcome text, English users
  '/دریافتفا': 'recv_fa', // sent after a Persian user uploads a photo
  '/دریافتانگ': 'recv_en', // sent after an English user uploads a photo
  '/ارسالفا': 'send_fa', // sent after the bot delivers the edited image, Persian users
  '/ارسالانگ': 'send_en', // sent after the bot delivers the edited image, English users
};

const STR = {
  fa: {
    welcome:
      '👋 <b>سلام، خوش اومدی!</b>\n\n' +
      'با این ربات می‌تونی روی عکس‌هات متن فارسی یا انگلیسی بذاری، فونت و افکت انتخاب کنی، و خود متن یا عکس رو هرجور خواستی بکشی و شکلش رو تغییر بدی. 🎨\n\n' +
      '📸 کافیه یه عکس برام بفرستی — بعد لینک ادیتور رو برات می‌فرستم که همون‌جا روش کار کنی.\n\n' +
      'یا می‌تونی با یه بومِ خالی هم شروع کنی 👇',
    openEditor: '🎨 باز کردن ادیتور',
    gotPhoto: '✅ عکس دریافت شد!\nبرای ویرایش، دکمهٔ زیر رو بزن 👇',
    editPhoto: '✏️ ویرایش این عکس',
    gotVideo: '✅ ویدیو دریافت شد!\nبرای ویرایش (برش دادن)، دکمهٔ زیر رو بزن 👇',
    editVideo: '🎬 ویرایش این ویدیو',
    fallback: 'یه عکس یا ویدیو برام بفرست تا بتونی ویرایشش کنی 🙂\nیا از دستور /start استفاده کن.',
  },
  en: {
    welcome:
      "👋 <b>Hey, welcome!</b>\n\n" +
      "With this bot you can put Persian or English text on your photos, pick fonts and effects, and stretch or resize the text or the photo however you like. 🎨\n\n" +
      "📸 Just send me a photo — I'll send back a link to the editor so you can work on it right there.\n\n" +
      "Or start with a blank canvas 👇",
    openEditor: '🎨 Open editor',
    gotPhoto: '✅ Photo received!\nTap the button below to edit it 👇',
    editPhoto: '✏️ Edit this photo',
    gotVideo: '✅ Video received!\nTap the button below to trim/edit it 👇',
    editVideo: '🎬 Edit this video',
    fallback: "Send me a photo or video so you can edit it 🙂\nOr use /start.",
  },
};

function langFor(user) {
  const code = ((user && user.language_code) || '').toLowerCase();
  return code.startsWith('fa') ? 'fa' : 'en';
}

function getAppUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

async function tg(method, payload) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function editorButton(text, url) {
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('ok');
    return;
  }

  try {
    const update = req.body || {};
    const appUrl = getAppUrl(req);

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const fromId = msg.from && msg.from.id;
      const lang = langFor(msg.from);
      const s = STR[lang];
      // pass the user's Telegram language through so the mini app opens already matching it
      const withLang = (url) => `${url}${url.includes('?') ? '&' : '?'}lang=${lang}`;

      // The first-ever /start claims ownership; everyone after is a regular user.
      let adminId = await kvGet(ADMIN_ID_KEY);
      if (!adminId && msg.text && msg.text.startsWith('/start')) {
        adminId = String(fromId);
        await kvSet(ADMIN_ID_KEY, adminId);
      }
      const isAdmin = adminId && fromId && String(fromId) === String(adminId);

      // Admin: /ورودفارسی etc. arm capture mode for the next sticker.
      if (isAdmin && msg.text && ADMIN_COMMANDS[msg.text.trim()]) {
        const slot = ADMIN_COMMANDS[msg.text.trim()];
        await kvSet(`pending_sticker:${adminId}`, slot);
        await tg('sendMessage', { chat_id: chatId, text: '🖼 حالا استیکر مورد نظر رو بفرست تا ذخیره بشه.' });
        res.status(200).json({ ok: true });
        return;
      }

      // Admin: a sticker arriving while capture mode is armed gets saved.
      if (isAdmin && msg.sticker) {
        const pendingSlot = await kvGet(`pending_sticker:${adminId}`);
        if (pendingSlot) {
          await kvSet(`sticker:${pendingSlot}`, msg.sticker.file_id);
          await kvDel(`pending_sticker:${adminId}`);
          await tg('sendMessage', { chat_id: chatId, text: '✅ استیکر ذخیره شد.' });
          res.status(200).json({ ok: true });
          return;
        }
      }

      if (msg.text && msg.text.startsWith('/start')) {
        const sticker = await kvGet(`sticker:in_${lang}`);
        if (sticker) await tg('sendSticker', { chat_id: chatId, sticker });
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.welcome,
          parse_mode: 'HTML',
          reply_markup: editorButton(s.openEditor, withLang(appUrl)),
        });
      } else if (msg.photo && msg.photo.length) {
        const largest = msg.photo[msg.photo.length - 1];
        const editUrl = withLang(`${appUrl}/?file_id=${encodeURIComponent(largest.file_id)}`);
        const sticker = await kvGet(`sticker:recv_${lang}`);
        if (sticker) await tg('sendSticker', { chat_id: chatId, sticker });
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.gotPhoto,
          reply_markup: editorButton(s.editPhoto, editUrl),
        });
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
        const editUrl = withLang(`${appUrl}/?file_id=${encodeURIComponent(msg.document.file_id)}`);
        const sticker = await kvGet(`sticker:recv_${lang}`);
        if (sticker) await tg('sendSticker', { chat_id: chatId, sticker });
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.gotPhoto,
          reply_markup: editorButton(s.editPhoto, editUrl),
        });
      } else if (msg.video) {
        const editUrl = withLang(`${appUrl}/?video_file_id=${encodeURIComponent(msg.video.file_id)}`);
        const sticker = await kvGet(`sticker:recv_${lang}`);
        if (sticker) await tg('sendSticker', { chat_id: chatId, sticker });
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.gotVideo,
          reply_markup: editorButton(s.editVideo, editUrl),
        });
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('video/')) {
        const editUrl = withLang(`${appUrl}/?video_file_id=${encodeURIComponent(msg.document.file_id)}`);
        const sticker = await kvGet(`sticker:recv_${lang}`);
        if (sticker) await tg('sendSticker', { chat_id: chatId, sticker });
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.gotVideo,
          reply_markup: editorButton(s.editVideo, editUrl),
        });
      } else {
        await tg('sendMessage', { chat_id: chatId, text: s.fallback });
      }
    }
  } catch (err) {
    console.error('webhook error', err);
  }

  res.status(200).json({ ok: true });
};
