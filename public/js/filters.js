// Bildlooks fuer Vorschau und fertiges Foto.
//
// `css` faerbt die Live-Vorschau (CSS-Filter auf dem <video>), `px` ist die
// Umsetzung fuers Canvas. Safari kann `ctx.filter` erst ab 16.4 - deshalb
// rechnen wir den Look immer selbst, dann sieht das Ergebnis ueberall gleich aus.

const clamp = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);

function mix(original, target, amount) {
  return original + (target - original) * amount;
}

/** Kontrast um den Mittelwert 128 herum. */
function contrast(value, amount) {
  return (value - 128) * amount + 128;
}

function grayscale(data, amount = 1) {
  for (let i = 0; i < data.length; i += 4) {
    const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = clamp(mix(data[i], luma, amount));
    data[i + 1] = clamp(mix(data[i + 1], luma, amount));
    data[i + 2] = clamp(mix(data[i + 2], luma, amount));
  }
}

function sepia(data, amount = 1) {
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    data[i] = clamp(mix(r, r * 0.393 + g * 0.769 + b * 0.189, amount));
    data[i + 1] = clamp(mix(g, r * 0.349 + g * 0.686 + b * 0.168, amount));
    data[i + 2] = clamp(mix(b, r * 0.272 + g * 0.534 + b * 0.131, amount));
  }
}

function tone(data, { rGain = 1, gGain = 1, bGain = 1, contrastAmount = 1, brightness = 1 }) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(contrast(data[i] * rGain * brightness, contrastAmount));
    data[i + 1] = clamp(contrast(data[i + 1] * gGain * brightness, contrastAmount));
    data[i + 2] = clamp(contrast(data[i + 2] * bGain * brightness, contrastAmount));
  }
}

/** Weicher dunkler Rand - gibt Vintage- und S/W-Look Tiefe. */
function vignette(data, width, height, strength = 0.45) {
  const cx = width / 2;
  const cy = height / 2;
  const maxDistance = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ratio = Math.hypot(x - cx, y - cy) / maxDistance;
      const factor = 1 - strength * Math.pow(Math.max(0, ratio - 0.55) / 0.45, 2);
      const i = (y * width + x) * 4;
      data[i] = clamp(data[i] * factor);
      data[i + 1] = clamp(data[i + 1] * factor);
      data[i + 2] = clamp(data[i + 2] * factor);
    }
  }
}

/** Hebt die Tiefen an und nimmt den Lichtern die Spitze - der ausgewaschene
 *  Look von Film, der jahrelang in der Schublade lag. */
function fade(data, lift = 26, compress = 0.84) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp(data[i] * compress + lift);
    data[i + 1] = clamp(data[i + 1] * compress + lift);
    data[i + 2] = clamp(data[i + 2] * compress + lift);
  }
}

/**
 * Faerbt Tiefen und Lichter unterschiedlich ein. Alte Kameras und alternde
 * Filme kippen die Schatten ins Kuehle und die Lichter ins Warme - genau das
 * macht den Look aus, nicht der Sepiaschleier ueber allem.
 */
function splitTone(data, shadows, highlights, amount = 1) {
  for (let i = 0; i < data.length; i += 4) {
    const t = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    for (let c = 0; c < 3; c++) {
      data[i + c] = clamp(data[i + c] + (shadows[c] * (1 - t) + highlights[c] * t) * amount);
    }
  }
}

/**
 * Gleichmaessiges Korn ueber alle Kanaele - farbiges Rauschen wirkt digital.
 * Das Korn sitzt in kleinen Bloecken statt auf einzelnen Pixeln: so sieht es
 * bei 1200 Pixeln Streifenbreite nach Film aus statt nach Sensorrauschen, und
 * die JPEG-Datei bleibt ein Bruchteil so gross.
 */
function grain(data, width, height, strength = 16, size = 3) {
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const noise = (Math.random() - 0.5) * strength;
      for (let dy = 0; dy < size && y + dy < height; dy++) {
        const row = (y + dy) * width;
        for (let dx = 0; dx < size && x + dx < width; dx++) {
          const i = (row + x + dx) * 4;
          data[i] = clamp(data[i] + noise);
          data[i + 1] = clamp(data[i + 1] + noise);
          data[i + 2] = clamp(data[i + 2] + noise);
        }
      }
    }
  }
}

export const FILTERS = [
  {
    id: 'original',
    name: 'Original',
    css: 'none',
    px: null,
  },
  {
    id: 'bw',
    name: 'S/W',
    css: 'grayscale(1) contrast(1.12)',
    px: (data, w, h) => {
      grayscale(data, 1);
      tone(data, { contrastAmount: 1.12 });
      vignette(data, w, h, 0.35);
    },
  },
  {
    id: 'sepia',
    name: 'Sepia',
    css: 'sepia(0.85) contrast(1.05) saturate(1.1)',
    px: (data) => {
      sepia(data, 0.85);
      tone(data, { contrastAmount: 1.05 });
    },
  },
  {
    // Alte Kleinbildkamera: verblasste Tiefen, kuehle Schatten, warme Lichter,
    // sichtbares Korn und ein kraeftiger Randabfall.
    id: 'vintage',
    name: 'Vintage',
    css: 'sepia(0.3) saturate(0.72) contrast(0.9) brightness(1.1)',
    px: (data, w, h) => {
      grayscale(data, 0.28);
      sepia(data, 0.22);
      fade(data, 26, 0.84);
      splitTone(data, [-10, -2, 14], [18, 8, -10]);
      tone(data, { contrastAmount: 1.06 });
      grain(data, w, h, 16, 3);
      vignette(data, w, h, 0.62);
    },
  },
  {
    id: 'cool',
    name: 'Kühl',
    css: 'saturate(1.1) contrast(1.05) hue-rotate(-8deg) brightness(1.02)',
    px: (data) => tone(data, { rGain: 0.94, bGain: 1.1, contrastAmount: 1.05, brightness: 1.02 }),
  },
  {
    id: 'warm',
    name: 'Warm',
    css: 'saturate(1.15) contrast(1.05) sepia(0.15) brightness(1.04)',
    px: (data) => {
      sepia(data, 0.15);
      tone(data, { rGain: 1.08, bGain: 0.93, contrastAmount: 1.05, brightness: 1.04 });
    },
  },
];

export function getFilter(id) {
  return FILTERS.find((filter) => filter.id === id) || FILTERS[0];
}

/** Wendet einen Look auf einen bereits gezeichneten Canvas-Bereich an. */
export function applyFilter(ctx, filterId, x, y, width, height) {
  const filter = getFilter(filterId);
  if (!filter.px || width < 1 || height < 1) return;
  const image = ctx.getImageData(x, y, width, height);
  filter.px(image.data, image.width, image.height);
  ctx.putImageData(image, x, y);
}
