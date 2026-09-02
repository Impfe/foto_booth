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

/** Startet den Server auf einem eigenen Port mit leerem Datenverzeichnis. */
async function startServer(port, env = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fotobox-api-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, TLS_CERT: '/dev/null/x', ...env },
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
