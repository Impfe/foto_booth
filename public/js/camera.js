// Kamerazugriff und Einzelbild-Aufnahme.

const ERROR_MESSAGES = {
  NotAllowedError:
    'Der Kamerazugriff wurde abgelehnt. In Safari unter „aA“ → „Website-Einstellungen“ die Kamera erlauben und die Seite neu laden.',
  NotFoundError: 'Es wurde keine Kamera gefunden.',
  NotReadableError: 'Die Kamera wird gerade von einer anderen App benutzt.',
  OverconstrainedError: 'Die gewünschte Kamera ist auf diesem Gerät nicht verfügbar.',
};

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
    await this.video.play();
    // Auf dem iPad meldet play() manchmal Erfolg, bevor die Masse feststehen.
    if (!this.video.videoWidth) {
      await new Promise((resolve) => this.video.addEventListener('loadedmetadata', resolve, { once: true }));
    }
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
