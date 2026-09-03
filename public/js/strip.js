// Baut aus den Einzelaufnahmen den fertigen Fotostreifen.
//
// Es gibt drei Vorlagen, umschaltbar ueber `strip.style` in der config.json.
// Farben lassen sich einzeln ueberschreiben, sonst kommen sie aus der Vorlage.
import { applyFilter } from './filters.js';

const STRIP_WIDTH = 1200;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export const STRIP_STYLES = {
  // Der klassische Automatenstreifen: weisses Papier, randlose Bilder.
  classic: {
    label: 'Klassisch',
    background: '#ffffff',
    backgroundTo: '#f7f2e9',
    foreground: '#14110f',
    padding: 44,
    gap: 18,
    frameLine: 0.12,
    keyline: 'none',
    divider: 'diamond',
    titleSize: 68,
  },
  // Ruhiger, mit Buetten-Anmutung und doppelter Keyline wie auf einer Einladung.
  elegant: {
    label: 'Elegant',
    background: '#f5f0e5',
    backgroundTo: '#ebe3d3',
    foreground: '#2b241c',
    padding: 66,
    gap: 24,
    frameLine: 0.16,
    keyline: 'double',
    divider: 'rule',
    titleSize: 64,
  },
  // Dunkles Papier - wirkt abends und bei Kunstlicht am staerksten.
  midnight: {
    label: 'Mitternacht',
    background: '#17130f',
    backgroundTo: '#0b0907',
    foreground: '#f7f3ec',
    padding: 48,
    gap: 16,
    frameLine: 0.24,
    keyline: 'thin',
    divider: 'diamond',
    titleSize: 66,
  },
};

/** Hexfarbe mit Deckkraft - fuer die gedaempften Zeilen im Fuss. */
function withAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value;
  const number = parseInt(full, 16);
  return `rgba(${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}, ${alpha})`;
}

/** Vorlage plus die Farben, die in der Konfiguration ausdruecklich gesetzt sind. */
function resolveStyle(config) {
  const strip = config?.strip || {};
  const base = STRIP_STYLES[strip.style] || STRIP_STYLES.classic;
  return {
    ...base,
    background: strip.background || base.background,
    backgroundTo: strip.background || base.backgroundTo,
    foreground: strip.foreground || base.foreground,
    accent: strip.accent || '#c8a25a',
  };
}

/** Zeichnet die Quelle formatfuellend in das Zielrechteck (Mittelteil-Crop). */
function drawCover(ctx, source, dx, dy, dw, dh) {
  const scale = Math.max(dw / source.width, dh / source.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (source.width - sw) / 2;
  const sy = (source.height - sh) / 2;
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
}

/**
 * Zentrierter Text mit Sperrung. `ctx.letterSpacing` gibt es erst in neueren
 * Safari-Versionen, deshalb setzen wir die Zeichen selbst.
 */
function drawTracked(ctx, text, centerX, y, spacing) {
  const characters = [...text];
  const width =
    characters.reduce((sum, char) => sum + ctx.measureText(char).width, 0) +
    spacing * Math.max(0, characters.length - 1);
  let x = centerX - width / 2;
  const previousAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const char of characters) {
    ctx.fillText(char, x, y);
    x += ctx.measureText(char).width + spacing;
  }
  ctx.textAlign = previousAlign;
}

/** Trennlinie im Fuss - mit Raute als Blickfang oder als ruhige Linie. */
function drawDivider(ctx, kind, centerX, y, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  if (kind === 'rule') {
    ctx.beginPath();
    ctx.moveTo(centerX - width / 2, y);
    ctx.lineTo(centerX + width / 2, y);
    ctx.stroke();
    return;
  }

  const arm = width / 2 - 22;
  ctx.beginPath();
  ctx.moveTo(centerX - arm, y);
  ctx.lineTo(centerX - 15, y);
  ctx.moveTo(centerX + 15, y);
  ctx.lineTo(centerX + arm, y);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.save();
  ctx.translate(centerX, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();
}

/** Umlaufende Linie(n) am Rand des Streifens. */
function drawKeyline(ctx, kind, width, height, color) {
  if (kind === 'none') return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(20.5, 20.5, width - 41, height - 41);
  if (kind === 'double') {
    ctx.lineWidth = 3;
    ctx.strokeRect(28.5, 28.5, width - 57, height - 57);
  }
}

function formatDate(date) {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement[]} options.frames Aufnahmen in Reihenfolge
 * @param {string} options.filterId Look, der auf jedes Bild kommt
 * @param {object} options.config Booth-Konfiguration (Titel, Vorlage, Farben)
 * @returns {HTMLCanvasElement} fertiger Streifen
 */
export function composeStrip({ frames, filterId = 'original', config, date = new Date() }) {
  if (!frames.length) throw new Error('Keine Aufnahmen zum Montieren.');
  const style = resolveStyle(config);
  const { padding, gap, accent, foreground } = style;

  const frameWidth = STRIP_WIDTH - padding * 2;
  const aspect = frames[0].height / frames[0].width;
  const frameHeight = Math.round(frameWidth * aspect);
  const subtitle = config?.eventSubtitle || '';
  const footerHeight = subtitle ? 248 : 196;
  const height =
    padding * 2 + frames.length * frameHeight + (frames.length - 1) * gap + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Papier: minimal dunkler zum Fuss hin, damit die Flaeche nicht flach wirkt.
  const paper = ctx.createLinearGradient(0, 0, 0, height);
  paper.addColorStop(0, style.background);
  paper.addColorStop(1, style.backgroundTo);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, height);

  drawKeyline(ctx, style.keyline, canvas.width, height, withAlpha(accent, 0.55));

  frames.forEach((frame, index) => {
    const y = padding + index * (frameHeight + gap);
    drawCover(ctx, frame, padding, y, frameWidth, frameHeight);
    applyFilter(ctx, filterId, padding, y, frameWidth, frameHeight);
    // Hauchduenne Kante - trennt helle Motive sichtbar vom Papier.
    ctx.strokeStyle = withAlpha(foreground, style.frameLine);
    ctx.lineWidth = 1;
    ctx.strokeRect(padding + 0.5, y + 0.5, frameWidth - 1, frameHeight - 1);
  });

  const footerTop = height - footerHeight;
  const dividerWidth = style.divider === 'rule' ? frameWidth * 0.3 : frameWidth * 0.42;
  drawDivider(ctx, style.divider, canvas.width / 2, footerTop + 36, dividerWidth, accent);

  ctx.textAlign = 'center';
  ctx.fillStyle = foreground;
  ctx.font = `500 ${style.titleSize}px ${SERIF}`;
  ctx.fillText(config?.eventTitle || 'Fotobox', canvas.width / 2, footerTop + 118, frameWidth);

  ctx.fillStyle = withAlpha(foreground, 0.58);
  if (subtitle) {
    ctx.font = `500 26px ${SANS}`;
    drawTracked(ctx, subtitle.toUpperCase(), canvas.width / 2, footerTop + 166, 5);
    ctx.font = `400 28px ${SERIF}`;
    ctx.fillText(formatDate(date), canvas.width / 2, footerTop + 214, frameWidth);
  } else {
    ctx.font = `400 28px ${SERIF}`;
    ctx.fillText(formatDate(date), canvas.width / 2, footerTop + 166, frameWidth);
  }

  return canvas;
}

/** Einzelbild-Variante: gleicher Rahmen, gleiche Beschriftung, nur ein Foto. */
export function composeSingle(options) {
  return composeStrip({ ...options, frames: options.frames.slice(0, 1) });
}
