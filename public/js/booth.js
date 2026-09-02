// Ablaufsteuerung der Fotobox: Vorschau -> Countdown -> Serie -> Streifen -> QR-Code.
import { Camera } from './camera.js';
import { FILTERS, getFilter } from './filters.js';
import { composeStrip } from './strip.js';
import { sound } from './sound.js';

const els = {
  body: document.body,
  video: document.getElementById('preview'),
  flash: document.getElementById('flash'),
  title: document.getElementById('title'),
  subtitle: document.getElementById('subtitle'),
  filters: document.getElementById('filters'),
  shutter: document.getElementById('shutter'),
  hint: document.getElementById('hint'),
  countdown: document.getElementById('countdown'),
  progress: document.getElementById('progress'),
  result: document.getElementById('resultImage'),
  qr: document.getElementById('qr'),
  qrHint: document.getElementById('qrHint'),
  status: document.getElementById('status'),
  again: document.getElementById('again'),
  download: document.getElementById('download'),
  flip: document.getElementById('flip'),
  soundToggle: document.getElementById('soundToggle'),
  notice: document.getElementById('notice'),
};

const camera = new Camera(els.video);
const state = {
  config: null,
  filterId: 'original',
  busy: false,
  reviewTimer: null,
  wakeLock: null,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setState(name) {
  els.body.dataset.state = name;
}

function showNotice(message) {
  els.notice.textContent = message;
  els.notice.hidden = !message;
}

/** Verhindert, dass das iPad waehrend des Events in den Ruhezustand geht. */
async function keepAwake() {
  try {
    state.wakeLock = await navigator.wakeLock?.request('screen');
  } catch {
    // Nicht kritisch - dann dunkelt der Bildschirm eben wie gewohnt ab.
  }
}

function applyPreviewFilter() {
  els.video.style.filter = getFilter(state.filterId).css;
}

function renderFilters() {
  els.filters.replaceChildren(
    ...FILTERS.map((filter) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filters__item';
      button.textContent = filter.name;
      button.dataset.filter = filter.id;
      button.setAttribute('aria-pressed', String(filter.id === state.filterId));
      button.addEventListener('click', () => {
        state.filterId = filter.id;
        applyPreviewFilter();
        for (const item of els.filters.children) {
          item.setAttribute('aria-pressed', String(item.dataset.filter === filter.id));
        }
      });
      return button;
    }),
  );
}

function renderProgress(current, total) {
  els.progress.replaceChildren(
    ...Array.from({ length: total }, (_, index) => {
      const dot = document.createElement('span');
      dot.className = 'progress__dot';
      if (index < current) dot.classList.add('is-done');
      if (index === current) dot.classList.add('is-active');
      return dot;
    }),
  );
}

async function runCountdown(seconds) {
  for (let value = seconds; value > 0; value--) {
    els.countdown.textContent = String(value);
    els.countdown.classList.remove('is-pulsing');
    void els.countdown.offsetWidth; // Neustart der Animation erzwingen
    els.countdown.classList.add('is-pulsing');
    sound.tick();
    await wait(1000);
  }
  els.countdown.textContent = '';
}

async function flash() {
  els.flash.classList.add('is-on');
  sound.shutter();
  await wait(120);
  els.flash.classList.remove('is-on');
}

function canvasToJpeg(canvas) {
  return canvas.toDataURL('image/jpeg', 0.92);
}

async function upload(dataUrl, shots) {
  const response = await fetch('/api/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: dataUrl,
      kind: shots > 1 ? 'strip' : 'single',
      filter: state.filterId,
      shots,
    }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || `Speichern fehlgeschlagen (${response.status}).`);
  }
  return response.json();
}

function scheduleReturnToIdle() {
  clearTimeout(state.reviewTimer);
  const seconds = state.config?.reviewSeconds ?? 60;
  if (seconds > 0) state.reviewTimer = setTimeout(backToIdle, seconds * 1000);
}

function backToIdle() {
  clearTimeout(state.reviewTimer);
  state.busy = false;
  els.result.removeAttribute('src');
  els.qr.removeAttribute('src');
  els.qr.hidden = true;
  els.status.textContent = '';
  setState('idle');
}

async function runSession() {
  if (state.busy) return;
  if (!camera.isRunning) {
    showNotice('Die Kamera ist nicht bereit. Bitte die Seite neu laden.');
    return;
  }
  state.busy = true;
  sound.unlock();
  showNotice('');

  const shots = Math.max(1, Number(state.config.shots) || 1);
  const frames = [];
  try {
    setState('shooting');
    for (let index = 0; index < shots; index++) {
      renderProgress(index, shots);
      await runCountdown(Math.max(1, Number(state.config.countdownSeconds) || 3));
      await flash();
      frames.push(camera.captureFrame());
      if (index < shots - 1) await wait(Number(state.config.pauseBetweenShotsMs) || 1200);
    }
    renderProgress(shots, shots);

    setState('processing');
    const strip = composeStrip({ frames, filterId: state.filterId, config: state.config });
    const dataUrl = canvasToJpeg(strip);

    els.result.src = dataUrl;
    els.download.href = dataUrl;
    els.download.download = `fotobox-${Date.now()}.jpg`;
    els.status.textContent = 'Wird gespeichert …';
    els.qr.hidden = true;
    setState('result');
    sound.done();
    scheduleReturnToIdle();

    const saved = await upload(dataUrl, shots);
    if (saved.qr) {
      els.qr.src = saved.qr;
      els.qr.hidden = false;
      els.qrHint.hidden = false;
      els.status.textContent = 'Gespeichert – QR-Code scannen zum Mitnehmen.';
    } else {
      els.qrHint.hidden = true;
      els.status.textContent = 'Gespeichert.';
    }
  } catch (err) {
    console.error(err);
    els.status.textContent = err.message;
    els.qrHint.hidden = true;
    if (els.body.dataset.state !== 'result') {
      showNotice(err.message);
      backToIdle();
      return;
    }
  } finally {
    state.busy = false;
  }
}

async function init() {
  try {
    state.config = await fetch('/api/config').then((response) => response.json());
  } catch {
    state.config = { shots: 4, countdownSeconds: 3, reviewSeconds: 60, eventTitle: 'Fotobox' };
    showNotice('Einstellungen konnten nicht geladen werden – es gelten Standardwerte.');
  }

  state.filterId = state.config.defaultFilter || 'original';
  els.title.textContent = state.config.eventTitle || 'Fotobox';
  els.subtitle.textContent = state.config.eventSubtitle || '';
  els.subtitle.hidden = !state.config.eventSubtitle;
  document.title = `${state.config.eventTitle || 'Fotobox'} – Fotobox`;
  els.video.classList.toggle('is-mirrored', state.config.mirrorPreview !== false);
  const shots = Math.max(1, Number(state.config.shots) || 1);
  els.hint.textContent =
    shots > 1 ? `${shots} Fotos hintereinander – tippen und Pose halten` : 'Tippen und Pose halten';

  renderFilters();
  applyPreviewFilter();
  renderProgress(0, shots);
  els.soundToggle.setAttribute('aria-pressed', String(sound.enabled));

  els.shutter.addEventListener('click', runSession);
  els.again.addEventListener('click', () => {
    backToIdle();
    runSession();
  });
  els.download.addEventListener('click', () => scheduleReturnToIdle());
  els.flip.addEventListener('click', async () => {
    try {
      await camera.flip();
    } catch (err) {
      showNotice(err.message);
    }
  });
  els.soundToggle.addEventListener('click', () => {
    sound.unlock();
    els.soundToggle.setAttribute('aria-pressed', String(sound.toggle()));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !camera.isRunning) camera.start().catch(() => {});
  });

  try {
    await camera.start();
    setState('idle');
  } catch (err) {
    showNotice(err.message);
    setState('error');
  }
  keepAwake();
}

init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
