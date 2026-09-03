import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ID_PATTERN = /^[0-9]{8}-[0-9]{6}-[a-z0-9]{6}$/;
// Absichtlich grosszuegig: hier soll niemand aussperrt werden, der eine
// ungewoehnliche, aber gueltige Adresse hat.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
const RECIPIENTS_FILE = 'recipients.jsonl';
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

  static isValidEmail(value) {
    return typeof value === 'string' && value.length <= 254 && EMAIL_PATTERN.test(value);
  }

  /**
   * Merkt sich, an wen ein Foto spaeter gehen soll.
   *
   * Anhaengende Zeilen statt einer Datei, die neu geschrieben wird: Faellt
   * mitten im Abend der Strom aus, sind die bisherigen Adressen trotzdem da.
   */
  async addRecipient(id, email) {
    const meta = await this.get(id);
    if (!meta) throw Object.assign(new Error('Unbekanntes Foto'), { status: 404 });
    // Erst aufraeumen, dann pruefen - iOS haengt beim Tippen gern ein
    // Leerzeichen an, und daran soll niemand scheitern.
    const address = String(email ?? '').trim().toLowerCase();
    if (!PhotoStore.isValidEmail(address)) {
      throw Object.assign(new Error('Das sieht nicht nach einer E-Mail-Adresse aus.'), {
        status: 400,
      });
    }
    const entry = {
      photoId: meta.id,
      file: meta.file,
      email: address,
      createdAt: new Date().toISOString(),
    };
    await fs.appendFile(path.join(this.dir, RECIPIENTS_FILE), `${JSON.stringify(entry)}\n`);
    return entry;
  }

  /** Alle Empfaenger, Doppelnennungen derselben Adresse zum selben Foto entfernt. */
  async recipients() {
    let raw = '';
    try {
      raw = await fs.readFile(path.join(this.dir, RECIPIENTS_FILE), 'utf8');
    } catch {
      return [];
    }
    const seen = new Set();
    const entries = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const key = `${entry.photoId}|${entry.email}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
      } catch {
        // Eine kaputte Zeile darf nicht die ganze Liste unbrauchbar machen.
      }
    }
    return entries;
  }

  async remove(id) {
    const meta = await this.get(id);
    if (!meta) return false;
    await fs.rm(this.filePath(meta), { force: true });
    await fs.rm(path.join(this.dir, `${id}.json`), { force: true });
    return true;
  }
}
