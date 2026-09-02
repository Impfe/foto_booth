// Kurze Toene fuer Countdown und Ausloeser - erzeugt im Browser, keine Dateien.
let context = null;

export const sound = {
  enabled: localStorage.getItem('booth.sound') !== 'off',

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('booth.sound', this.enabled ? 'on' : 'off');
    return this.enabled;
  },

  /** Muss aus einer Nutzergeste heraus laufen, sonst bleibt iOS stumm. */
  unlock() {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) context = new AudioContextClass();
    }
    if (context?.state === 'suspended') context.resume();
  },

  tone(frequency, duration = 0.12, volume = 0.2) {
    if (!this.enabled || !context) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  },

  tick() {
    this.tone(660, 0.09, 0.15);
  },

  shutter() {
    this.tone(1180, 0.06, 0.25);
    setTimeout(() => this.tone(520, 0.12, 0.2), 60);
  },

  done() {
    [523, 659, 784].forEach((frequency, index) => {
      setTimeout(() => this.tone(frequency, 0.18, 0.18), index * 120);
    });
  },
};
