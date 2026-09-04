// Kamerazugriff und Einzelbild-Aufnahme.

const ERROR_MESSAGES = {
  NotAllowedError:
    'Der Kamerazugriff wurde abgelehnt. In Safari unter „aA“ → „Website-Einstellungen“ die Kamera erlauben und die Seite neu laden.',
  NotFoundError: 'Es wurde keine Kamera gefunden.',
  NotReadableError: 'Die Kamera wird gerade von einer anderen App benutzt.',
  OverconstrainedError: 'Die gewünschte Kamera ist auf diesem Gerät nicht verfügbar.',
};

/** Laesst eine Zusage hoechstens `ms` lang laufen - danach geht es weiter. */
function settled(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * Wartet, bis das Videobild seine Masse kennt.
 *
 * Bewusst durch Nachfragen statt ueber `loadedmetadata`: Feuert das Ereignis
 * einen Wimpernschlag zu frueh, wartet ein Zuhoerer, der erst danach angemeldet
 * wird, fuer immer - und die Booth haengt ohne Fehlermeldung im Ladekreis.
 */
async function waitForDimensions(video, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!video.videoWidth) {
    if (Date.now() > deadline) {
      throw new Error(
        'Die Kamera liefert kein Bild. Seite neu laden – und prüfen, ob eine andere App sie gerade benutzt.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export class Camera {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.facingMode = 'user';
  }

  get isRunning() {
    return Boolean(this.stream);
  }

  async start(facingMode = this.facingMode) {
    if (!window.isSecureContext) {
      throw new Error(
        'Safari gibt die Kamera nur über HTTPS frei. Bitte die Fotobox über eine https-Adresse öffnen (siehe README).',
      );
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Dieser Browser unterstützt keinen Kamerazugriff.');
    }
    this.stop();
    this.facingMode = facingMode;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
    } catch (err) {
      throw new Error(ERROR_MESSAGES[err.name] || `Kamera konnte nicht gestartet werden (${err.name}).`);
    }
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    // Safari lehnt play() gelegentlich ab oder antwortet gar nicht, obwohl der
    // Stream laeuft. Beides darf den Start nicht aufhalten - ob wirklich ein
    // Bild ankommt, pruefen wir gleich selbst.
    await settled(this.video.play(), 3000);
    await waitForDimensions(this.video);
    return this.stream;
  }

  stop() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async flip() {
    return this.start(this.facingMode === 'user' ? 'environment' : 'user');
  }

  /**
   * Einzelbild in voller Sensoraufloesung. Die Vorschau ist gespiegelt, das
   * gespeicherte Foto bewusst nicht - sonst stuende jede Schrift im Bild falsch.
   */
  captureFrame() {
    const width = this.video.videoWidth;
    const height = this.video.videoHeight;
    if (!width || !height) throw new Error('Die Kamera liefert noch kein Bild.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(this.video, 0, 0, width, height);
    return canvas;
  }
}
