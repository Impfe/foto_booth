// Ablaufsteuerung der Fotobox: Vorschau -> Countdown -> Serie -> Streifen -> QR-Code.
import { fetchAdminState, lockAdmin, openPinPad } from './admin.js';
import { Camera } from './camera.js';
import { FILTERS, applyFilter, getFilter } from './filters.js';
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
  countdownRing: document.getElementById('countdownRing'),
  shotLabel: document.getElementById('shotLabel'),
  shotPreview: document.getElementById('shotPreview'),
  cancel: document.getElementById('cancel'),
  progress: document.getElementById('progress'),
  result: document.getElementById('resultImage'),
  qr: document.getElementById('qr'),
  qrHint: document.getElementById('qrHint'),
  status: document.getElementById('status'),
  again: document.getElementById('again'),
  mailOpen: document.getElementById('mailOpen'),
  mailForm: document.getElementById('mailForm'),
  mailInput: document.getElementById('mailInput'),
  mailCancel: document.getElementById('mailCancel'),
  mailStatus: document.getElementById('mailStatus'),
  flip: document.getElementById('flip'),
  soundToggle: document.getElementById('soundToggle'),
  galleryLink: document.getElementById('galleryLink'),
  admin: document.getElementById('admin'),
  lock: document.getElementById('lock'),
  notice: document.getElementById('notice'),
};

const camera = new Camera(els.video);
const state = {
  config: null,
  admin: { enabled: false, unlocked: true, pinLength: 4, pinConfigured: false },
  relockTimer: null,
  filterId: 'original',
  busy: false,
  cancelRequested: false,
  photoId: null,
  reviewTimer: null,
  wakeLock: null,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Signalisiert den Abbruch durch die Gaeste - kein Fehler, sondern ein Wunsch. */
class Cancelled extends Error {
  constructor() {
    super('Abgebrochen');
    this.name = 'Cancelled';
  }
}

function stopIfCancelled() {
  if (state.cancelRequested) throw new Cancelled();
}

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

function setShotLabel(index, total) {
  els.shotLabel.textContent = total > 1 ? `Foto ${index + 1} von ${total}` : 'Gleich geht\u2019s los';
}

async function runCountdown(seconds) {
  for (let value = seconds; value > 0; value--) {
    els.countdown.textContent = String(value);
    // Klasse kurz abwerfen, damit Ring und Ziffer die Animation neu starten.
    els.countdownRing.classList.remove('is-running');
    void els.countdownRing.offsetWidth;
    els.countdownRing.classList.add('is-running');
    sound.tick();
    await wait(1000);
    stopIfCancelled();
  }
  els.countdownRing.classList.remove('is-running');
  els.countdown.textContent = '';
}

/**
 * Zeigt die eben gemachte Aufnahme kurz gross an. Ohne das weiss niemand, ob
 * das Foto geklappt hat - und es ist der Moment, in dem gelacht wird.
 *
 * Verkleinert und mit dem gewaehlten Look, damit das Bild dem entspricht, was
 * spaeter auf dem Streifen steht, ohne dass die Vollaufloesung gerechnet wird.
 */
function reviewFrame(frame) {
  const preview = document.createElement('canvas');
  preview.width = 720;
  preview.height = Math.round((frame.height / frame.width) * preview.width);
  const ctx = preview.getContext('2d');
  ctx.drawImage(frame, 0, 0, preview.width, preview.height);
  applyFilter(ctx, state.filterId, 0, 0, preview.width, preview.height);
  els.shotPreview.replaceChildren(preview);
  els.shotPreview.hidden = false;
  els.countdownRing.hidden = true;
}

function hideShotPreview() {
  els.shotPreview.hidden = true;
  els.shotPreview.replaceChildren();
  els.countdownRing.hidden = false;
}

async function flash() {
  els.flash.classList.add('is-on');
  sound.shutter();
  await wait(120);
  els.flash.classList.remove('is-on');
}

function canvasToJpeg(canvas) {
  return canvas.toDataURL('image/jpeg', 0.88);
}

async function sendPhoto(dataUrl, shots) {
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
  if (response.ok) return response.json();
  const detail = await response.json().catch(() => ({}));
  throw Object.assign(new Error(detail.error || `Speichern fehlgeschlagen (${response.status}).`), {
    status: response.status,
  });
}

/**
 * Ein Aussetzer im WLAN darf den Streifen nicht kosten: Schlaegt der erste
 * Versuch am Netz oder am Server fehl, geht zwei Sekunden spaeter einer
 * hinterher. Bei einer Ablehnung (4xx) waere das sinnlos - das Bild wuerde
 * genauso wieder abgelehnt.
 */
async function upload(dataUrl, shots) {
  try {
    return await sendPhoto(dataUrl, shots);
  } catch (err) {
    if (err.status && err.status < 500) throw err;
    els.status.textContent = 'Verbindung wackelt – zweiter Versuch …';
    await wait(2000);
    return sendPhoto(dataUrl, shots);
  }
}

/**
 * Adresse eintragen statt QR-Code scannen - fuer alle, deren Handy gerade
 * leer ist. Das Foto geht nicht sofort raus; die Adresse landet neben der
 * Aufnahme und wird spaeter gesammelt verschickt.
 */
function showMailForm(open) {
  els.mailForm.hidden = !open;
  els.mailOpen.hidden = open;
  // Zwei goldene Knoepfe untereinander streiten sich um den Blick - solange
  // das Feld offen ist, ist "Eintragen" die Hauptsache.
  els.again.classList.toggle('button--primary', !open);
  if (open) {
    // Solange jemand tippt, darf die Booth nicht zurueckspringen.
    clearTimeout(state.reviewTimer);
    els.mailInput.focus();
  } else {
    scheduleReturnToIdle();
  }
}

async function submitMail(event) {
  event.preventDefault();
  const email = els.mailInput.value.trim();
  if (!email || !state.photoId) return;
  els.mailStatus.textContent = 'Wird eingetragen …';
  try {
    const response = await fetch(`/api/photos/${state.photoId}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const detail = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(detail.error || 'Eintragen fehlgeschlagen.');
    els.mailInput.value = '';
    showMailForm(false);
    els.mailOpen.hidden = true;
    els.mailStatus.textContent = `Notiert – das Foto geht an ${detail.email}.`;
  } catch (err) {
    els.mailStatus.textContent = err.message;
  }
}

function scheduleReturnToIdle() {
  clearTimeout(state.reviewTimer);
  const seconds = state.config?.reviewSeconds ?? 60;
  if (seconds > 0) state.reviewTimer = setTimeout(backToIdle, seconds * 1000);
}

function backToIdle() {
  clearTimeout(state.reviewTimer);
  hideShotPreview();
  state.busy = false;
  state.cancelRequested = false;
  state.photoId = null;
  els.mailForm.hidden = true;
  els.mailInput.value = '';
  els.mailStatus.textContent = '';
  els.mailOpen.hidden = true;
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
  state.cancelRequested = false;
  sound.unlock();
  showNotice('');

  const shots = Math.max(1, Number(state.config.shots) || 1);
  const frames = [];
  try {
    setState('shooting');
    for (let index = 0; index < shots; index++) {
      renderProgress(index, shots);
      setShotLabel(index, shots);
      // Vor dem ersten Foto laenger, danach kuerzer - zusammen mit der einen
      // Sekunde Bildkontrolle liegen so rund fuenf Sekunden zwischen zwei
      // Aufnahmen.
      const seconds =
        index === 0
          ? Math.max(1, Number(state.config.countdownSeconds) || 5)
          : Math.max(1, Number(state.config.countdownSecondsNext) || 4);
      await runCountdown(seconds);
      await flash();

      const frame = camera.captureFrame();
      frames.push(frame);
      renderProgress(index + 1, shots);

      reviewFrame(frame);
      await wait(Number(state.config.frameReviewMs) || 1000);
      hideShotPreview();
      stopIfCancelled();
    }

    setState('processing');
    const strip = composeStrip({ frames, filterId: state.filterId, config: state.config });
    const dataUrl = canvasToJpeg(strip);

    els.result.src = dataUrl;
    els.status.textContent = 'Wird gespeichert …';
    els.qr.hidden = true;
    els.mailOpen.hidden = true;
    setState('result');
    sound.done();
    scheduleReturnToIdle();

    const saved = await upload(dataUrl, shots);
    state.photoId = saved.id;
    // Erst jetzt anbieten - vorher gibt es kein Foto, dem die Adresse gehoert.
    els.mailOpen.hidden = false;
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
    if (err instanceof Cancelled) {
      hideShotPreview();
      backToIdle();
      return;
    }
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

/**
 * Im Kiosk-Betrieb sieht die Feiergesellschaft nur den Ausloeser. Galerie,
 * Kameraseite und Ton liegen hinter der PIN - sonst raeumt irgendwann jemand
 * versehentlich die Fotos des Abends weg.
 */
function updateChrome() {
  const kiosk = Boolean(state.config?.kioskMode) && state.admin.enabled;
  const open = !kiosk || state.admin.unlocked;
  els.admin.hidden = open;
  els.lock.hidden = !(kiosk && state.admin.unlocked);
  for (const element of [els.soundToggle, els.flip, els.galleryLink]) element.hidden = !open;
}

/** Nach dem Entsperren wieder zusperren, falls niemand mehr etwas tut. */
function scheduleRelock() {
  clearTimeout(state.relockTimer);
  state.relockTimer = setTimeout(relock, 5 * 60 * 1000);
}

async function relock() {
  clearTimeout(state.relockTimer);
  await lockAdmin();
  state.admin = await fetchAdminState();
  updateChrome();
}

async function openAdmin() {
  if (!state.admin.pinConfigured) {
    window.location.href = '/gallery';
    return;
  }
  openPinPad({
    pinLength: state.admin.pinLength,
    onSuccess: async () => {
      state.admin = await fetchAdminState();
      updateChrome();
      scheduleRelock();
    },
  });
}

async function init() {
  try {
    state.config = await fetch('/api/config').then((response) => response.json());
  } catch {
    state.config = { shots: 4, countdownSeconds: 3, reviewSeconds: 60, eventTitle: 'Fotobox' };
    showNotice('Einstellungen konnten nicht geladen werden – es gelten Standardwerte.');
  }

  state.filterId = state.config.defaultFilter || 'original';
  // Der Akzentton des Streifens faerbt auch die Bedienoberflaeche.
  if (state.config.strip?.accent) {
    document.documentElement.style.setProperty('--gold', state.config.strip.accent);
  }
  els.title.textContent = state.config.eventTitle || 'Fotobox';
  els.subtitle.textContent = state.config.eventSubtitle || '';
  els.subtitle.hidden = !state.config.eventSubtitle;
  document.title = `${state.config.eventTitle || 'Fotobox'} – Fotobox`;
  els.video.classList.toggle('is-mirrored', state.config.mirrorPreview !== false);
  const shots = Math.max(1, Number(state.config.shots) || 1);
  els.hint.textContent =
    shots > 1 ? `${shots} Fotos hintereinander – tippen und Pose halten` : 'Tippen und Pose halten';

  state.admin = await fetchAdminState();
  if (state.config.kioskMode && !state.admin.enabled) {
    console.warn('Kiosk-Modus ohne Admin-PIN - die Bedienelemente bleiben sichtbar.');
  }
  updateChrome();

  renderFilters();
  applyPreviewFilter();
  renderProgress(0, shots);
  els.soundToggle.setAttribute('aria-pressed', String(sound.enabled));

  els.shutter.addEventListener('click', runSession);
  els.cancel.addEventListener('click', () => {
    state.cancelRequested = true;
  });
  els.again.addEventListener('click', () => {
    backToIdle();
    runSession();
  });
  els.mailOpen.addEventListener('click', () => showMailForm(true));
  els.mailCancel.addEventListener('click', () => showMailForm(false));
  els.mailForm.addEventListener('submit', submitMail);
  els.flip.addEventListener('click', async () => {
    try {
      await camera.flip();
    } catch (err) {
      showNotice(err.message);
    }
  });
  els.admin.addEventListener('click', openAdmin);
  els.lock.addEventListener('click', relock);
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
