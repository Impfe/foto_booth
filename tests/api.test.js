import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PIXEL_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
  'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const running = [];
after(() => running.forEach((child) => child.kill()));

/**
 * Startet den Server auf einem eigenen Port, mit leerem Datenverzeichnis und
 * einer eigenen Konfiguration - die Tests duerfen nicht davon abhaengen, was
 * gerade in der config.json des Projekts steht.
 */
async function startServer(port, env = {}, config = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fotobox-api-'));
  const configFile = path.join(dataDir, 'config.json');
  await fs.writeFile(
    configFile,
    JSON.stringify({ eventTitle: 'Testfotobox', shots: 3, ...config }),
  );
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      CONFIG_FILE: configFile,
      TLS_CERT: '/dev/null/x',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return { base, child, dataDir };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Server ist nicht gestartet.');
}

test('kompletter Weg: Foto hochladen, abrufen, teilen, exportieren, loeschen', async () => {
  const { base } = await startServer(8391);

  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(typeof config.eventTitle, 'string');
  assert.ok(config.shots >= 1);

  const created = await fetch(`${base}/api/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: PIXEL_JPEG, kind: 'strip', filter: 'sepia', shots: 4 }),
  });
  assert.equal(created.status, 201);
  const photo = await created.json();
  assert.equal(photo.shareUrl, `${base}/p/${photo.id}`);
  assert.match(photo.qr, /^data:image\/png;base64,/);

  const media = await fetch(`${base}${photo.url}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/jpeg');

  const sharePage = await (await fetch(photo.shareUrl)).text();
  assert.match(sharePage, new RegExp(`/media/${photo.id}`));
  assert.match(sharePage, /Foto speichern/);

  const list = await (await fetch(`${base}/api/photos`)).json();
  assert.deepEqual(list.map((entry) => entry.id), [photo.id]);

  const zip = Buffer.from(await (await fetch(`${base}/api/export.zip`)).arrayBuffer());
  assert.equal(zip.subarray(0, 2).toString(), 'PK');

  assert.equal((await fetch(`${base}/api/photos/${photo.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/api/photos/${photo.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(photo.shareUrl)).status, 404);
});

test('ungueltige Uploads werden abgewiesen', async () => {
  const { base } = await startServer(8392);
  for (const body of [{}, { image: 'nope' }, { image: 'data:text/html;base64,PGI+' }]) {
    const response = await fetch(`${base}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
  }
});

test('GALLERY_PASSWORD schuetzt Galerie und Export, nicht aber die Booth', async () => {
  const { base } = await startServer(8393, { GALLERY_PASSWORD: 'geheim' });

  assert.equal((await fetch(`${base}/api/photos`)).status, 401);
  assert.equal((await fetch(`${base}/api/export.zip`)).status, 401);
  assert.equal((await fetch(`${base}/gallery`)).status, 401);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);

  const authorized = await fetch(`${base}/api/photos`, {
    headers: { Authorization: `Basic ${Buffer.from('booth:geheim').toString('base64')}` },
  });
  assert.equal(authorized.status, 200);

  const wrong = await fetch(`${base}/api/photos`, {
    headers: { Authorization: `Basic ${Buffer.from('booth:falsch').toString('base64')}` },
  });
  assert.equal(wrong.status, 401);
});

test('Admin-PIN sperrt die Galerie und gibt sie nach Eingabe frei', async () => {
  const { base } = await startServer(8394, { ADMIN_PIN: '4711' });

  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.adminRequired, true);
  assert.equal('adminPin' in config, false, 'Die PIN darf den Browser nie erreichen');

  const status = await (await fetch(`${base}/api/admin/status`)).json();
  assert.deepEqual(status, { enabled: true, unlocked: false, pinLength: 4, pinConfigured: true });

  assert.equal((await fetch(`${base}/api/photos`)).status, 401);
  assert.equal((await fetch(`${base}/api/export.zip`)).status, 401);
  // Fotografieren muss auch gesperrt weiterhin gehen.
  assert.equal((await fetch(`${base}/gallery`)).status, 200);

  const unlock = (pin) =>
    fetch(`${base}/api/admin/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

  assert.equal((await unlock('0000')).status, 401);
  assert.equal((await unlock('47110')).status, 401);

  const opened = await unlock('4711');
  assert.equal(opened.status, 200);
  const cookie = opened.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^booth_admin=[a-f0-9]{48}$/);

  const photos = await fetch(`${base}/api/photos`, { headers: { cookie } });
  assert.equal(photos.status, 200);
  assert.equal((await fetch(`${base}/api/export.zip`, { headers: { cookie } })).status, 200);

  const after = await (await fetch(`${base}/api/admin/status`, { headers: { cookie } })).json();
  assert.equal(after.unlocked, true);

  await fetch(`${base}/api/admin/lock`, { method: 'POST', headers: { cookie } });
  // Das Token bleibt gueltig, bis der Server neu startet - die Sperre wirkt im
  // Browser ueber das geloeschte Cookie. Ohne Cookie ist wieder zu.
  assert.equal((await fetch(`${base}/api/photos`)).status, 401);
});

test('zu viele Fehlversuche werden abgewiesen', async () => {
  const { base } = await startServer(8395, { ADMIN_PIN: '4711' });
  const unlock = () =>
    fetch(`${base}/api/admin/unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000' }),
    });

  for (let attempt = 0; attempt < 10; attempt++) {
    assert.equal((await unlock()).status, 401);
  }
  assert.equal((await unlock()).status, 429);
  // Auch die richtige PIN kommt jetzt nicht mehr durch.
  const correct = await fetch(`${base}/api/admin/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '4711' }),
  });
  assert.equal(correct.status, 429);
});

test('ohne PIN und Passwort bleibt alles offen', async () => {
  const { base } = await startServer(8396);
  const status = await (await fetch(`${base}/api/admin/status`)).json();
  assert.equal(status.enabled, false);
  assert.equal(status.unlocked, true);
  assert.equal((await fetch(`${base}/api/photos`)).status, 200);
});

test('E-Mail-Adressen werden zum Foto gesammelt und als CSV ausgegeben', async () => {
  const { base } = await startServer(8397);

  const photo = await (
    await fetch(`${base}/api/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: PIXEL_JPEG }),
    })
  ).json();

  const addMail = (id, email) =>
    fetch(`${base}/api/photos/${id}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

  const created = await addMail(photo.id, '  Anna@Example.COM ');
  assert.equal(created.status, 201);
  assert.equal((await created.json()).email, 'anna@example.com', 'wird normalisiert');

  for (const invalid of ['', 'kein-mail', 'a@b', 'a b@c.de']) {
    assert.equal((await addMail(photo.id, invalid)).status, 400, `abgewiesen: ${invalid}`);
  }
  assert.equal((await addMail('20200101-000000-aaaaaa', 'a@b.de')).status, 404);

  // Dieselbe Adresse zweimal ergibt keinen zweiten Eintrag.
  await addMail(photo.id, 'anna@example.com');
  await addMail(photo.id, 'ben@example.com');

  const recipients = await (await fetch(`${base}/api/recipients`)).json();
  assert.deepEqual(
    recipients.map((entry) => entry.email),
    ['anna@example.com', 'ben@example.com'],
  );
  assert.equal(recipients[0].photoId, photo.id);
  assert.equal(recipients[0].file, photo.file);

  // Bytes lesen, nicht text(): Das BOM, das Excel fuer die Umlaute braucht,
  // wird von Response.text() laut Spezifikation stillschweigend entfernt.
  const raw = Buffer.from(await (await fetch(`${base}/api/recipients.csv`)).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM fuer Excel');
  const csv = raw.toString('utf8').slice(1);
  assert.match(csv, /^email,photoId,datei,eingetragen\n/);
  assert.match(csv, new RegExp(`"anna@example.com","${photo.id}"`));
});

test('die Empfaengerliste haengt am Admin-Zugang', async () => {
  const { base } = await startServer(8398, { ADMIN_PIN: '4711' });
  assert.equal((await fetch(`${base}/api/recipients`)).status, 401);
  assert.equal((await fetch(`${base}/api/recipients.csv`)).status, 401);
});
