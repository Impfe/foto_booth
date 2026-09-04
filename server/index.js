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

/**
 * Basis-URL fuer QR-Codes und Downloadlinks.
 *
 * Der wichtige Fall ist der mittlere: Laeuft die Booth lokal mit einem
 * selbstsignierten Zertifikat, kennt dieses Zertifikat nur das iPad. Jedes
 * Gaestehandy bekaeme beim Scannen eine Sicherheitswarnung. Die Downloadseite
 * braucht aber gar kein HTTPS - Kamera gibt es dort keine. Also zeigen die
 * Links auf den Klartext-Port, und die Gaeste sehen einfach ihr Foto.
 */
function publicBaseUrl(req) {
  if (server.publicUrl) return server.publicUrl;
  if (server.httpPort) return `http://${req.hostname}:${server.httpPort}`;
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

/**
 * Einfache Obergrenze je Absenderadresse.
 *
 * Im heimischen WLAN braucht das niemand. Sobald die Booth aber oeffentlich
 * erreichbar ist, ist /api/photos ein offener Bilder-Upload - und eine volle
 * Festplatte mitten in der Feier waere ein bloedes Ende. Die Grenzen sind so
 * gesetzt, dass ein Abend am iPad (alles von derselben Adresse) bequem
 * darunter bleibt.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [key, entry] of hits) if (now - entry.first > windowMs) hits.delete(key);
    }
    const key = req.ip || 'unbekannt';
    const entry = hits.get(key);
    if (!entry || now - entry.first > windowMs) {
      hits.set(key, { count: 1, first: now });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return res.status(429).json({ error: message });
    return next();
  };
}

const limitUploads = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Gerade zu viele Aufnahmen hintereinander. Bitte kurz warten.',
});

const limitMails = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Gerade zu viele Eintraege hintereinander. Bitte kurz warten.',
});

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

app.post('/api/photos', limitUploads, async (req, res, next) => {
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

app.post('/api/photos/:id/email', limitMails, async (req, res, next) => {
  try {
    const entry = await store.addRecipient(req.params.id, String(req.body?.email ?? ''));
    res.status(201).json({ email: entry.email });
  } catch (err) {
    next(err);
  }
});

app.get('/api/recipients', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await store.recipients());
  } catch (err) {
    next(err);
  }
});

app.get('/api/recipients.csv', requireAdmin, async (_req, res, next) => {
  try {
    const entries = await store.recipients();
    const escape = (value) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['email', 'photoId', 'datei', 'eingetragen'].join(','),
      ...entries.map((entry) =>
        [entry.email, entry.photoId, entry.file, entry.createdAt].map(escape).join(','),
      ),
    ];
    res.attachment(`fotobox-mails-${new Date().toISOString().slice(0, 10)}.csv`);
    res.type('text/csv; charset=utf-8');
    // BOM, damit Excel die Umlaute richtig liest.
    res.send(`\uFEFF${rows.join('\n')}\n`);
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

function describe(scheme, port) {
  const addresses = ['localhost', ...localAddresses()];
  return addresses.map((address) => `${scheme}://${address}:${port}`);
}

const primary = server.tls ? https.createServer(server.tls, app) : http.createServer(app);

primary.listen(server.port, () => {
  const scheme = server.tls ? 'https' : 'http';
  console.log(`\n  Fotobox laeuft.\n`);
  console.log(server.tls ? '  Fuers iPad (Kamera braucht HTTPS):' : '  Adresse:');
  for (const url of describe(scheme, server.port)) console.log(`    ${url}/`);

  if (!server.tls) {
    console.log(`\n  Galerie  ${describe(scheme, server.port).pop()}/gallery`);
    console.log(
      `\n  Hinweis: ohne HTTPS gibt Safari die Kamera nur auf localhost frei.` +
        `\n  Zertifikat erzeugen mit: npm run cert\n`,
    );
  }
  console.log(`\n  Fotos    ${server.dataDir}\n`);
});

// Klartext-Listener fuer die Gaeste. Ihre Handys sollen kein Zertifikat
// installieren muessen, nur um ein Foto herunterzuladen.
if (server.httpPort) {
  http.createServer(app).listen(server.httpPort, () => {
    console.log('  Fuer die Gaeste (Ziel der QR-Codes, ohne Zertifikat):');
    for (const url of describe('http', server.httpPort)) console.log(`    ${url}/`);
    console.log(`\n  Galerie  ${describe('http', server.httpPort).pop()}/gallery\n`);
  });
}

export { app };
