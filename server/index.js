import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';

import archiver from 'archiver';
import express from 'express';
import QRCode from 'qrcode';

import { AdminAccess } from './admin.js';
import { ROOT, loadBoothConfig, loadServerConfig } from './config.js';
import { PhotoStore } from './storage.js';

const server = loadServerConfig();
const store = new PhotoStore(server.dataDir);
await store.init();

const admin = new AdminAccess({
  loadConfig: loadBoothConfig,
  galleryPassword: server.galleryPassword,
});

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));

/** Basis-URL fuer QR-Codes: feste PUBLIC_URL, sonst die Adresse dieser Anfrage. */
function publicBaseUrl(req) {
  if (server.publicUrl) return server.publicUrl;
  return `${req.protocol}://${req.get('host')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/**
 * Die Booth-Konfiguration, wie sie der Browser sehen darf: ohne die PIN,
 * dafuer mit der Information, ob ueberhaupt eine gesetzt ist.
 */
function publicBoothConfig() {
  const { adminPin, ...rest } = loadBoothConfig();
  return { ...rest, adminRequired: admin.isEnabled };
}

const requireAdmin = admin.middleware();

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/config', (_req, res) => {
  res.json(publicBoothConfig());
});

app.get('/api/admin/status', (req, res) => {
  res.json(admin.status(req));
});

app.post('/api/admin/unlock', (req, res) => {
  const ip = req.ip || 'unbekannt';
  if (!admin.pin) {
    return res.status(409).json({ error: 'Es ist keine Admin-PIN eingerichtet.' });
  }
  if (admin.tooManyAttempts(ip)) {
    return res.status(429).json({ error: 'Zu viele Fehlversuche. Bitte spaeter erneut versuchen.' });
  }
  const given = String(req.body?.pin ?? '');
  if (given.length !== admin.pin.length || !admin.isCorrectPin(given)) {
    admin.noteFailure(ip);
    return res.status(401).json({ error: 'Falsche PIN.' });
  }
  admin.setCookie(req, res);
  res.json({ unlocked: true });
});

app.post('/api/admin/lock', (_req, res) => {
  admin.clearCookie(res);
  res.json({ unlocked: false });
});

app.post('/api/photos', async (req, res, next) => {
  try {
    const { image, kind, filter, shots } = req.body || {};
    const meta = await store.save({ dataUrl: image, kind, filter, shots });
    const shareUrl = `${publicBaseUrl(req)}/p/${meta.id}`;
    const qr = loadBoothConfig().showQrCode
      ? await QRCode.toDataURL(shareUrl, { margin: 1, width: 512, errorCorrectionLevel: 'M' })
      : null;
    res.status(201).json({ ...meta, url: `/media/${meta.id}`, shareUrl, qr });
  } catch (err) {
    next(err);
  }
});

app.get('/api/photos', requireAdmin, async (_req, res, next) => {
  try {
    const photos = await store.list();
    res.json(photos.map((meta) => ({ ...meta, url: `/media/${meta.id}` })));
  } catch (err) {
    next(err);
  }
});

app.delete('/api/photos/:id', requireAdmin, async (req, res, next) => {
  try {
    const removed = await store.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Unbekanntes Foto' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

app.get('/media/:id', async (req, res, next) => {
  try {
    const meta = await store.get(req.params.id);
    if (!meta) return res.status(404).send('Foto nicht gefunden.');
    res.type(path.extname(meta.file));
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(store.filePath(meta));
  } catch (err) {
    next(err);
  }
});

app.get('/api/export.zip', requireAdmin, async (_req, res, next) => {
  try {
    const photos = await store.list();
    const stamp = new Date().toISOString().slice(0, 10);
    res.attachment(`fotobox-${stamp}.zip`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('warning', (err) => console.warn('[export]', err.message));
    archive.on('error', (err) => res.destroy(err));
    archive.pipe(res);
    for (const meta of photos) archive.file(store.filePath(meta), { name: meta.file });
    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

// Downloadseite fuer Gaeste - das Ziel hinter dem QR-Code.
app.get('/p/:id', async (req, res, next) => {
  try {
    const meta = await store.get(req.params.id);
    if (!meta) return res.status(404).send('Dieses Foto gibt es (nicht mehr).');
    const booth = loadBoothConfig();
    const created = new Date(meta.createdAt).toLocaleString('de-DE', {
      dateStyle: 'long',
      timeStyle: 'short',
    });
    res.type('html').send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dein Foto | ${escapeHtml(booth.eventTitle)}</title>
<link rel="stylesheet" href="/css/share.css">
</head>
<body>
<main class="share">
  <h1>${escapeHtml(booth.eventTitle)}</h1>
  <p class="share__meta">Aufgenommen am ${escapeHtml(created)}</p>
  <img class="share__photo" src="/media/${escapeHtml(meta.id)}" alt="Dein Foto von der Fotobox">
  <a class="share__button" href="/media/${escapeHtml(meta.id)}" download="${escapeHtml(meta.file)}">
    Foto speichern
  </a>
  <p class="share__hint">
    Auf dem iPhone: lange auf das Bild tippen und &bdquo;Zu Fotos hinzuf&uuml;gen&ldquo; w&auml;hlen.
  </p>
</main>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

app.get('/gallery', (req, res, next) => {
  // Mit Passwortschutz fragt schon der Server; mit PIN uebernimmt das die Seite.
  if (server.galleryPassword && !admin.isUnlocked(req)) return requireAdmin(req, res, next);
  res.sendFile(path.join(ROOT, 'public', 'gallery.html'));
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.use((_req, res) => res.status(404).send('Seite nicht gefunden.'));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[server]', err);
  res.status(status).json({ error: err.message || 'Serverfehler' });
});

/** Alle IPv4-Adressen dieses Rechners - damit man die iPad-URL nicht suchen muss. */
function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((nic) => nic && nic.family === 'IPv4' && !nic.internal)
    .map((nic) => nic.address);
}

const instance = server.tls
  ? https.createServer(server.tls, app)
  : http.createServer(app);

instance.listen(server.port, () => {
  const scheme = server.tls ? 'https' : 'http';
  console.log(`\n  Fotobox laeuft auf Port ${server.port}\n`);
  for (const address of ['localhost', ...localAddresses()]) {
    console.log(`    Booth    ${scheme}://${address}:${server.port}/`);
  }
  console.log(`    Galerie  ${scheme}://${localAddresses()[0] || 'localhost'}:${server.port}/gallery`);
  console.log(`    Fotos    ${server.dataDir}`);
  if (!server.tls) {
    console.log(
      `\n  Hinweis: ohne HTTPS gibt Safari die Kamera nur auf localhost frei.` +
        `\n  Zertifikat erzeugen mit: npm run cert (erwartet ${path.relative(ROOT, server.tlsPaths.cert)})\n`,
    );
  } else {
    console.log('');
  }
});

export { app };
