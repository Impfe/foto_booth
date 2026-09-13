import crypto from 'node:crypto';

const COOKIE = 'booth_admin';
const BOOTH_COOKIE = 'booth_pass';
const BOOTH_DAYS = 30;
const SESSION_SECONDS = 8 * 60 * 60;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

/** Vergleich ohne Laufzeitunterschied - beide Seiten erst auf gleiche Laenge hashen. */
function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(req) {
  const cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

/**
 * Zugang zur Galerie im Kiosk-Betrieb.
 *
 * Die PIN bleibt auf dem Server - der Browser bekommt nur ein Sitzungstoken
 * als HttpOnly-Cookie. Das Token entsteht beim Start neu, ein Serverneustart
 * sperrt also alle offenen Sitzungen.
 *
 * Zur Einordnung: das ist ein Riegel gegen neugierige Gaeste, kein Schutz
 * gegen jemanden, der es ernsthaft darauf anlegt. Eine vierstellige PIN im
 * eigenen WLAN ist genau so viel Sicherheit, wie eine Fotobox braucht.
 */
export class AdminAccess {
  constructor({ loadConfig, galleryPassword = '' }) {
    this.loadConfig = loadConfig;
    this.galleryPassword = galleryPassword;
    this.token = crypto.randomBytes(24).toString('hex');
    this.attempts = new Map();
  }

  get pin() {
    return this.loadConfig().adminPin || '';
  }

  /** Ohne PIN und ohne Passwort bleibt alles offen - wie bisher. */
  get isEnabled() {
    return Boolean(this.pin) || Boolean(this.galleryPassword);
  }

  isCorrectPin(given) {
    return Boolean(this.pin) && safeEqual(given, this.pin);
  }

  hasValidCookie(req) {
    const given = parseCookies(req)[COOKIE];
    return Boolean(given) && safeEqual(given, this.token);
  }

  hasValidBasicAuth(req) {
    if (!this.galleryPassword) return false;
    const [scheme, encoded] = (req.get('authorization') || '').split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    const [, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    return safeEqual(rest.join(':'), this.galleryPassword);
  }

  isUnlocked(req) {
    return !this.isEnabled || this.hasValidCookie(req) || this.hasValidBasicAuth(req);
  }

  /** Zaehlt Fehlversuche je Adresse, damit die PIN nicht durchprobiert wird. */
  tooManyAttempts(ip) {
    const entry = this.attempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
      this.attempts.delete(ip);
      return false;
    }
    return entry.count >= MAX_ATTEMPTS;
  }

  noteFailure(ip) {
    const entry = this.attempts.get(ip);
    if (!entry || Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
      this.attempts.set(ip, { count: 1, first: Date.now() });
    } else {
      entry.count += 1;
    }
  }

  setCookie(req, res) {
    const parts = [
      `${COOKIE}=${this.token}`,
      'Path=/',
      `Max-Age=${SESSION_SECONDS}`,
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (req.protocol === 'https') parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  clearCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  }

  status(req) {
    return {
      enabled: this.isEnabled,
      unlocked: this.isUnlocked(req),
      pinLength: this.pin.length,
      pinConfigured: Boolean(this.pin),
    };
  }

  /** Express-Middleware fuer alles, was nur die Veranstalterin sehen soll. */
  middleware() {
    return (req, res, next) => {
      if (this.isUnlocked(req)) return next();
      if (this.galleryPassword) {
        res.set('WWW-Authenticate', 'Basic realm="Fotobox-Galerie", charset="UTF-8"');
        return res.status(401).send('Zugang nur mit Passwort.');
      }
      return res.status(401).json({ error: 'Admin-Zugang gesperrt.' });
    };
  }
}

export const ADMIN_COOKIE = COOKIE;

/**
 * Schloss vor der Booth selbst.
 *
 * Unter einer oeffentlichen Adresse koennte sonst jeder, der sie kennt, Fotos
 * hochladen. Die Veranstalterin gibt den Code einmal auf dem iPad ein, danach
 * bleibt das Geraet offen - Gaeste bekommen davon nichts mit.
 *
 * Anders als beim Admin-Zugang wird das Token aus der PIN abgeleitet statt bei
 * jedem Start neu gewuerfelt. Ein Deploy mitten am Abend soll das iPad nicht
 * aussperren. Wer den abgeleiteten Wert kennt, kennt ohnehin die PIN.
 */
export class BoothGate {
  constructor({ loadConfig }) {
    this.loadConfig = loadConfig;
  }

  get pin() {
    return this.loadConfig().boothPin || '';
  }

  /** Ohne PIN bleibt die Booth offen - so laeuft der lokale Betrieb wie bisher. */
  get isEnabled() {
    return Boolean(this.pin);
  }

  get token() {
    return crypto.createHash('sha256').update(`fotobox-booth:${this.pin}`).digest('hex');
  }

  isOpen(req) {
    if (!this.isEnabled) return true;
    const given = parseCookies(req)[BOOTH_COOKIE];
    return Boolean(given) && safeEqual(given, this.token);
  }

  isCorrectPin(given) {
    return this.isEnabled && safeEqual(given, this.pin);
  }

  setCookie(req, res) {
    const parts = [
      `${BOOTH_COOKIE}=${this.token}`,
      'Path=/',
      `Max-Age=${BOOTH_DAYS * 24 * 60 * 60}`,
      'HttpOnly',
      'SameSite=Lax',
    ];
    if (req.protocol === 'https') parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  status(req) {
    return { enabled: this.isEnabled, open: this.isOpen(req), pinLength: this.pin.length };
  }

  /** Schuetzt alles, was Daten anlegt - nicht aber die Seiten fuer die Gaeste. */
  middleware() {
    return (req, res, next) => {
      if (this.isOpen(req)) return next();
      return res.status(401).json({ error: 'Die Fotobox ist gesperrt.' });
    };
  }
}
