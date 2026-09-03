// Admin-Zugang: PIN-Feld und der Kontakt zum Server.
//
// Die PIN selbst kennt nur der Server. Hier wird sie eingesammelt, hingeschickt
// und das Ergebnis gemeldet - im Browser liegt danach nur ein Sitzungscookie.

export async function fetchAdminState() {
  try {
    return await fetch('/api/admin/status').then((response) => response.json());
  } catch {
    return { enabled: false, unlocked: true, pinLength: 0, pinConfigured: false };
  }
}

export async function lockAdmin() {
  await fetch('/api/admin/lock', { method: 'POST' }).catch(() => {});
}

async function submitPin(pin) {
  const response = await fetch('/api/admin/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (response.ok) return { ok: true };
  const detail = await response.json().catch(() => ({}));
  return { ok: false, error: detail.error || `Fehlgeschlagen (${response.status}).` };
}

/**
 * Zeigt das PIN-Feld an.
 *
 * @param {object} options
 * @param {number} options.pinLength Stellen - danach wird automatisch geprueft
 * @param {boolean} options.dismissible Ob sich das Feld schliessen laesst
 * @param {() => void} options.onSuccess Wird nach erfolgreicher Eingabe gerufen
 */
export function openPinPad({ pinLength = 4, dismissible = true, onSuccess } = {}) {
  const existing = document.querySelector('.pinpad');
  if (existing) return existing;

  let entered = '';
  let busy = false;

  const overlay = document.createElement('div');
  overlay.className = 'pinpad';
  overlay.innerHTML = `
    <div class="pinpad__card" role="dialog" aria-modal="true" aria-label="Admin-Zugang">
      <p class="pinpad__title">Admin-Zugang</p>
      <div class="pinpad__dots" aria-hidden="true"></div>
      <p class="pinpad__error" role="alert"></p>
      <div class="pinpad__keys"></div>
      ${dismissible
        ? '<button type="button" class="pinpad__close">Abbrechen</button>'
        : '<a class="pinpad__close" href="/">Zur Fotobox</a>'}
    </div>`;

  const card = overlay.querySelector('.pinpad__card');
  const dots = overlay.querySelector('.pinpad__dots');
  const keys = overlay.querySelector('.pinpad__keys');
  const error = overlay.querySelector('.pinpad__error');

  function renderDots() {
    dots.replaceChildren(
      ...Array.from({ length: pinLength }, (_, index) => {
        const dot = document.createElement('span');
        dot.className = 'pinpad__dot';
        if (index < entered.length) dot.classList.add('is-filled');
        return dot;
      }),
    );
  }

  async function check() {
    busy = true;
    const result = await submitPin(entered);
    busy = false;
    if (result.ok) {
      overlay.remove();
      onSuccess?.();
      return;
    }
    error.textContent = result.error;
    card.classList.add('is-wrong');
    setTimeout(() => card.classList.remove('is-wrong'), 420);
    entered = '';
    renderDots();
  }

  function press(value) {
    if (busy) return;
    error.textContent = '';
    if (value === 'back') entered = entered.slice(0, -1);
    else if (entered.length < pinLength) entered += value;
    renderDots();
    if (entered.length === pinLength) check();
  }

  for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '←']) {
    if (!label) {
      keys.append(document.createElement('span'));
      continue;
    }
    const key = document.createElement('button');
    key.type = 'button';
    key.className = 'pinpad__key';
    key.textContent = label;
    key.addEventListener('click', () => press(label === '←' ? 'back' : label));
    keys.append(key);
  }

  if (dismissible) {
    overlay.querySelector('.pinpad__close').addEventListener('click', () => overlay.remove());
  }

  document.addEventListener('keydown', function onKey(event) {
    if (!overlay.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (/^[0-9]$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') press('back');
    else if (event.key === 'Escape' && dismissible) overlay.remove();
  });

  renderDots();
  document.body.append(overlay);
  return overlay;
}
