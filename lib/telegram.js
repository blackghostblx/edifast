// Shared helper for verifying Telegram Mini App initData (per Telegram's
// official HMAC scheme) and reading the language out of a Telegram user.

const crypto = require('crypto');

function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push(`${k}=${v}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
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

function langFor(user) {
  const code = ((user && user.language_code) || '').toLowerCase();
  return code.startsWith('fa') ? 'fa' : 'en';
}

module.exports = { validateInitData, langFor };
