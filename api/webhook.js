// Telegram webhook handler — deploy on Vercel as /api/webhook
// Requires env var: BOT_TOKEN
// Optional env var: APP_URL (e.g. https://edifast.vercel.app) — otherwise inferred from request host

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const WELCOME_TEXT =
  '👋 <b>سلام، خوش اومدی!</b>\n\n' +
  'با این ربات می‌تونی روی عکس‌هات متن فارسی یا انگلیسی بذاری، فونت و افکت انتخاب کنی، و خود متن یا عکس رو هرجور خواستی بکشی و شکلش رو تغییر بدی. 🎨\n\n' +
  '📸 کافیه یه عکس برام بفرستی — بعد لینک ادیتور رو برات می‌فرستم که همون‌جا روش کار کنی.\n\n' +
  'یا می‌تونی با یه بومِ خالی هم شروع کنی 👇';

const GOT_PHOTO_TEXT = '✅ عکس دریافت شد!\nبرای ویرایش، دکمهٔ زیر رو بزن 👇';
const FALLBACK_TEXT = 'یه عکس برام بفرست تا بتونی ویرایشش کنی 🙂\nیا از دستور /start استفاده کن.';

function getAppUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
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

      if (msg.text && msg.text.startsWith('/start')) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: WELCOME_TEXT,
          parse_mode: 'HTML',
          reply_markup: editorButton('🎨 باز کردن ادیتور', appUrl),
        });
      } else if (msg.photo && msg.photo.length) {
        const largest = msg.photo[msg.photo.length - 1];
        const editUrl = `${appUrl}/?file_id=${encodeURIComponent(largest.file_id)}`;
        await tg('sendMessage', {
          chat_id: chatId,
          text: GOT_PHOTO_TEXT,
          reply_markup: editorButton('✏️ ویرایش این عکس', editUrl),
        });
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
        const editUrl = `${appUrl}/?file_id=${encodeURIComponent(msg.document.file_id)}`;
        await tg('sendMessage', {
          chat_id: chatId,
          text: GOT_PHOTO_TEXT,
          reply_markup: editorButton('✏️ ویرایش این عکس', editUrl),
        });
      } else {
        await tg('sendMessage', { chat_id: chatId, text: FALLBACK_TEXT });
      }
    }
  } catch (err) {
    console.error('webhook error', err);
  }

  res.status(200).json({ ok: true });
};
