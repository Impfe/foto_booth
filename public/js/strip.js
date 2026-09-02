// Baut aus den Einzelaufnahmen den fertigen Fotostreifen.
import { applyFilter } from './filters.js';

const STRIP_WIDTH = 1200;
const PADDING = 44;
const GAP = 18;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

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

/** Feine Trennlinie mit Raute in der Mitte - der Blickfang im Fuss. */
function drawDivider(ctx, centerX, y, width, color) {
  const arm = width / 2 - 22;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centerX - arm, y);
  ctx.lineTo(centerX - 12, y);
  ctx.moveTo(centerX + 12, y);
  ctx.lineTo(centerX + arm, y);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.save();
  ctx.translate(centerX, y);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();
}

function formatDate(date) {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement[]} options.frames Aufnahmen in Reihenfolge
 * @param {string} options.filterId Look, der auf jedes Bild kommt
 * @param {object} options.config Booth-Konfiguration (Titel, Farben)
 * @returns {HTMLCanvasElement} fertiger Streifen
 */
export function composeStrip({ frames, filterId = 'original', config, date = new Date() }) {
  if (!frames.length) throw new Error('Keine Aufnahmen zum Montieren.');
  const colors = config?.strip || {};
  const background = colors.background || '#ffffff';
  const foreground = colors.foreground || '#14110f';
  const accent = colors.accent || '#c8a25a';

  const frameWidth = STRIP_WIDTH - PADDING * 2;
  const aspect = frames[0].height / frames[0].width;
  const frameHeight = Math.round(frameWidth * aspect);
  const subtitle = config?.eventSubtitle || '';
  const footerHeight = subtitle ? 248 : 196;
  const height =
    PADDING * 2 + frames.length * frameHeight + (frames.length - 1) * GAP + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Papier: minimal waermer zum Fuss hin, damit die Flaeche nicht flach wirkt.
  const paper = ctx.createLinearGradient(0, 0, 0, height);
  paper.addColorStop(0, background);
  paper.addColorStop(1, background === '#ffffff' ? '#f7f2e9' : background);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, height);

  frames.forEach((frame, index) => {
    const y = PADDING + index * (frameHeight + GAP);
    drawCover(ctx, frame, PADDING, y, frameWidth, frameHeight);
    applyFilter(ctx, filterId, PADDING, y, frameWidth, frameHeight);
    // Hauchduenne Kante - trennt helle Motive sichtbar vom Papier.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PADDING + 0.5, y + 0.5, frameWidth - 1, frameHeight - 1);
  });

  const footerTop = height - footerHeight;
  drawDivider(ctx, canvas.width / 2, footerTop + 36, frameWidth * 0.42, accent);

  ctx.textAlign = 'center';
  ctx.fillStyle = foreground;
  ctx.font = `500 68px ${SERIF}`;
  ctx.fillText(config?.eventTitle || 'Fotobox', canvas.width / 2, footerTop + 118, frameWidth);

  ctx.fillStyle = 'rgba(20, 17, 15, 0.55)';
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
