// Baut aus den Einzelaufnahmen den fertigen Fotostreifen.
import { applyFilter } from './filters.js';

const STRIP_WIDTH = 1200;
const PADDING = 46;
const GAP = 24;

/** Zeichnet die Quelle formatfuellend in das Zielrechteck (Mittelteil-Crop). */
function drawCover(ctx, source, dx, dy, dw, dh) {
  const scale = Math.max(dw / source.width, dh / source.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (source.width - sw) / 2;
  const sy = (source.height - sh) / 2;
  ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
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
  const hasSubtitle = Boolean(config?.eventSubtitle);
  const footerHeight = hasSubtitle ? 190 : 150;
  const height =
    PADDING * 2 + frames.length * frameHeight + (frames.length - 1) * GAP + footerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = STRIP_WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  frames.forEach((frame, index) => {
    const y = PADDING + index * (frameHeight + GAP);
    drawCover(ctx, frame, PADDING, y, frameWidth, frameHeight);
    applyFilter(ctx, filterId, PADDING, y, frameWidth, frameHeight);
  });

  const footerTop = height - footerHeight;
  ctx.fillStyle = accent;
  ctx.fillRect(PADDING, footerTop + 18, frameWidth, 3);

  ctx.textAlign = 'center';
  ctx.fillStyle = foreground;
  ctx.font = '600 54px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillText(config?.eventTitle || 'Fotobox', canvas.width / 2, footerTop + 90, frameWidth);

  ctx.font = '400 32px "Helvetica Neue", Helvetica, Arial, sans-serif';
  ctx.fillStyle = 'rgba(20, 17, 15, 0.65)';
  if (hasSubtitle) {
    ctx.fillText(config.eventSubtitle, canvas.width / 2, footerTop + 136, frameWidth);
    ctx.fillText(formatDate(date), canvas.width / 2, footerTop + 176, frameWidth);
  } else {
    ctx.fillText(formatDate(date), canvas.width / 2, footerTop + 134, frameWidth);
  }

  return canvas;
}

/** Einzelbild-Variante: gleicher Rahmen, gleiche Beschriftung, nur ein Foto. */
export function composeSingle(options) {
  return composeStrip({ ...options, frames: options.frames.slice(0, 1) });
}
