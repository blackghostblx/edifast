// Telegram webhook handler — deploy on Vercel as /api/webhook
// Requires env var: BOT_TOKEN
// Optional env var: APP_URL (e.g. https://edifast.vercel.app) — otherwise inferred from request host

const BOT_TOKEN = process.env.BOT_TOKEN;
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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
    fallback: 'یه عکس برام بفرست تا بتونی ویرایشش کنی 🙂\nیا از دستور /start استفاده کن.',
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
    fallback: "Send me a photo so you can edit it 🙂\nOr use /start.",
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
      const lang = langFor(msg.from);
      const s = STR[lang];
      // pass the user's Telegram language through so the mini app opens already matching it
      const withLang = (url) => `${url}${url.includes('?') ? '&' : '?'}lang=${lang}`;

      if (msg.text && msg.text.startsWith('/start')) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.welcome,
          parse_mode: 'HTML',
          reply_markup: editorButton(s.openEditor, withLang(appUrl)),
        });
      } else if (msg.photo && msg.photo.length) {
        const largest = msg.photo[msg.photo.length - 1];
        const editUrl = withLang(`${appUrl}/?file_id=${encodeURIComponent(largest.file_id)}`);
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.gotPhoto,
          reply_markup: editorButton(s.editPhoto, editUrl),
        });
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
        const editUrl = withLang(`${appUrl}/?file_id=${encodeURIComponent(msg.document.file_id)}`);
        await tg('sendMessage', {
          chat_id: chatId,
          text: s.gotPhoto,
          reply_markup: editorButton(s.editPhoto, editUrl),
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
