// Proxies a Telegram file to the Mini App without ever exposing BOT_TOKEN client-side.
// GET /api/image?file_id=xxxx

const BOT_TOKEN = process.env.BOT_TOKEN;

module.exports = async (req, res) => {
  const fileId = req.query.file_id;
  if (!fileId) {
    res.status(400).send('missing file_id');
    return;
  }
  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`
    );
    const meta = await metaRes.json();
    if (!meta.ok) {
      res.status(404).send('file not found');
      return;
    }
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${meta.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      res.status(502).send('could not fetch file');
      return;
    }
    const buf = Buffer.from(await fileRes.arrayBuffer());
    res.setHeader('Content-Type', fileRes.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(buf);
  } catch (err) {
    console.error('image proxy error', err);
    res.status(500).send('server error');
  }
};
