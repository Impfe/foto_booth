import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ID_PATTERN = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}$/;
const DATA_URL_PATTERN = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Ablage der Aufnahmen: pro Foto eine Bilddatei plus eine JSON-Datei mit
 * Metadaten. Kein Index, keine Datenbank - ein Verzeichnis, das man auch von
 * Hand kopieren oder aufraeumen kann.
 */
export class PhotoStore {
  constructor(dir) {
    this.dir = dir;
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  newId(now = new Date()) {
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
  }

  isValidId(id) {
    return typeof id === 'string' && ID_PATTERN.test(id);
  }

  /** Wandelt eine Data-URL in Buffer + Dateiendung um; wirft bei ungueltiger Eingabe. */
  static decodeDataUrl(dataUrl) {
    const match = typeof dataUrl === 'string' && dataUrl.match(DATA_URL_PATTERN);
    if (!match) throw Object.assign(new Error('Ungueltiges Bildformat'), { status: 400 });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) throw Object.assign(new Error('Leeres Bild'), { status: 400 });
    if (buffer.length > MAX_BYTES) {
      throw Object.assign(new Error('Bild ist zu gross'), { status: 413 });
    }
    return { buffer, ext: match[1] === 'png' ? 'png' : 'jpg' };
  }

  async save({ dataUrl, kind = 'strip', filter = 'original', shots = null }) {
    const { buffer, ext } = PhotoStore.decodeDataUrl(dataUrl);
    const id = this.newId();
    const meta = {
      id,
      file: `${id}.${ext}`,
      kind,
      filter,
      shots,
      bytes: buffer.length,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(this.dir, meta.file), buffer);
    await fs.writeFile(path.join(this.dir, `${id}.json`), JSON.stringify(meta, null, 2));
    return meta;
  }

  async get(id) {
    if (!this.isValidId(id)) return null;
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, `${id}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  /** Neueste zuerst - die IDs sind durch den Zeitstempel bereits sortierbar. */
  async list() {
    const entries = await fs.readdir(this.dir).catch(() => []);
    const ids = entries.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    const metas = await Promise.all(ids.map((id) => this.get(id)));
    return metas.filter(Boolean).sort((a, b) => b.id.localeCompare(a.id));
  }

  filePath(meta) {
    return path.join(this.dir, meta.file);
  }

  async remove(id) {
    const meta = await this.get(id);
    if (!meta) return false;
    await fs.rm(this.filePath(meta), { force: true });
    await fs.rm(path.join(this.dir, `${id}.json`), { force: true });
    return true;
  }
}
