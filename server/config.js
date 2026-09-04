import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  eventTitle: 'Unsere Fotobox',
  eventSubtitle: '',
  shots: 4,
  countdownSeconds: 3,
  frameReviewMs: 1000,
  countdownSecondsNext: 4,
  reviewSeconds: 60,
  defaultFilter: 'original',
  mirrorPreview: true,
  showQrCode: true,
  kioskMode: false,
  adminPin: '',
  strip: { style: 'classic', accent: '#c8a25a', ornament: '' },
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[config] ${file} ist unlesbar (${err.message}) - nutze Standardwerte.`);
    }
    return {};
  }
}

/**
 * Booth-Einstellungen: config.json ueberschreibt die Defaults, verschachtelte
 * Objekte (strip) werden eine Ebene tief gemerged.
 */
export function loadBoothConfig() {
  const file = process.env.CONFIG_FILE
    ? path.resolve(ROOT, process.env.CONFIG_FILE)
    : path.join(ROOT, 'config.json');
  const user = readJson(file);
  const merged = { ...DEFAULTS, ...user, strip: { ...DEFAULTS.strip, ...(user.strip || {}) } };
  // ADMIN_PIN aus der Umgebung schlaegt die Datei - praktisch, wenn die PIN
  // nicht im Repository stehen soll.
  // Leer gesetzt hebt die PIN aus der Datei ausdruecklich auf.
  if (process.env.ADMIN_PIN !== undefined) merged.adminPin = process.env.ADMIN_PIN;
  return { ...merged, adminPin: String(merged.adminPin || '') };
}

/** Server-Einstellungen kommen ausschliesslich aus der Umgebung (.env / Shell). */
export function loadServerConfig() {
  const tlsCert = path.resolve(ROOT, process.env.TLS_CERT || './certs/cert.pem');
  const tlsKey = path.resolve(ROOT, process.env.TLS_KEY || './certs/key.pem');
  const tlsAvailable = fs.existsSync(tlsCert) && fs.existsSync(tlsKey);
  const port = Number(process.env.PORT) || (tlsAvailable ? 8443 : 8080);
  // Zweiter Listener ohne TLS. Er existiert nur, wenn HTTPS laeuft, und traegt
  // die Links fuer die Gaeste - deren Handys kennen unser Zertifikat nicht.
  let httpPort = Number(process.env.HTTP_PORT) || 8080;
  if (tlsAvailable && httpPort === port) httpPort = port + 1;
  return {
    port,
    httpPort: tlsAvailable ? httpPort : null,
    dataDir: path.resolve(ROOT, process.env.DATA_DIR || './data'),
    publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
    galleryPassword: process.env.GALLERY_PASSWORD || '',
    tls: tlsAvailable ? { cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) } : null,
    tlsPaths: { cert: tlsCert, key: tlsKey },
  };
}
