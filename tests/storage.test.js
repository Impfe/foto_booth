import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { PhotoStore } from '../server/storage.js';

// 1x1 Pixel JPEG, reicht als gueltige Testaufnahme.
const PIXEL_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsL' +
  'DBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

async function tempStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fotobox-test-'));
  const store = new PhotoStore(dir);
  await store.init();
  return store;
}

test('decodeDataUrl akzeptiert JPEG und PNG', () => {
  const jpeg = PhotoStore.decodeDataUrl(PIXEL_JPEG);
  assert.equal(jpeg.ext, 'jpg');
  assert.ok(jpeg.buffer.length > 0);

  const png = PhotoStore.decodeDataUrl(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  );
  assert.equal(png.ext, 'png');
});

test('decodeDataUrl weist alles ab, was kein Bild ist', () => {
  for (const value of [undefined, '', 'hallo', 'data:text/html;base64,PGI+', 'data:image/gif;base64,AAAA']) {
    assert.throws(() => PhotoStore.decodeDataUrl(value), /Ungueltiges Bildformat/);
  }
});

test('speichert, liest und loescht eine Aufnahme', async () => {
  const store = await tempStore();

  const meta = await store.save({ dataUrl: PIXEL_JPEG, kind: 'strip', filter: 'bw', shots: 4 });
  assert.match(meta.id, /^\d{8}-\d{6}-[a-f0-9]{6}$/);
  assert.equal(meta.filter, 'bw');
  assert.equal(meta.shots, 4);

  const stored = await fs.readFile(store.filePath(meta));
  assert.equal(stored.length, meta.bytes);

  assert.deepEqual(await store.get(meta.id), meta);
  assert.deepEqual((await store.list()).map((p) => p.id), [meta.id]);

  assert.equal(await store.remove(meta.id), true);
  assert.equal(await store.get(meta.id), null);
  assert.deepEqual(await store.list(), []);
  assert.equal(await store.remove(meta.id), false);
});

test('list sortiert neueste Aufnahme zuerst', async () => {
  const store = await tempStore();
  const first = await store.save({ dataUrl: PIXEL_JPEG });
  await new Promise((resolve) => setTimeout(resolve, 1100)); // IDs sind sekundengenau
  const second = await store.save({ dataUrl: PIXEL_JPEG });

  const ids = (await store.list()).map((photo) => photo.id);
  assert.deepEqual(ids, [second.id, first.id]);
});

test('unbekannte oder manipulierte IDs liefern nichts', async () => {
  const store = await tempStore();
  for (const id of ['../../etc/passwd', 'nope', '', '20250101-000000-zzzzzz']) {
    assert.equal(await store.get(id), null);
  }
});
