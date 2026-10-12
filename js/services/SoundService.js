/**
 * SoundService - Síntesis Acústica y Retroalimentación Háptica
 * Patrón MVC: Servicio de Interfaz y Audio
 */
class SoundService {
    constructor(houseModel) {
        this.model = houseModel;
        this.ctx = null;
        this.initialized = false;
    }

    _initContext() {
        if (!this.ctx && typeof window !== 'undefined') {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
                this.initialized = true;
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    /**
     * Emite un clic mecánico suave de precisión
     */
    click(freq = 520, duration = 0.035, gainVal = 0.035) {
        if (!this.model.soundEnabled) return;
        this._initContext();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.72, now + duration);

            gain.gain.setValueAtTime(gainVal, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + duration);
        } catch (e) {}
    }

    /**
     * Sonido para interruptores de iluminación
     */
    lightSwitch(isOn) {
        this.haptic(25);
        this.click(isOn ? 620 : 440, 0.04, 0.04);
    }

    /**
     * Sonido para actuadores de servomotores (Puerta y Ventanas)
     */
    servoMove(isOpening) {
        this.haptic(35);
        if (!this.model.soundEnabled) return;
        this._initContext();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            const startF = isOpening ? 420 : 540;
            const endF = isOpening ? 680 : 360;

            osc.frequency.setValueAtTime(startF, now);
            osc.frequency.exponentialRampToValueAtTime(endF, now + 0.09);

            gain.gain.setValueAtTime(0.04, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.09);
        } catch (e) {}
    }

    /**
     * Tono suave de alerta para bloqueos de seguridad
     */
    alertWarning() {
        this.haptic([50, 40, 50]);
        if (!this.model.soundEnabled) return;
        this._initContext();
        if (!this.ctx) return;

        try {
            const now = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(290, now);
            osc.frequency.setValueAtTime(260, now + 0.08);

            gain.gain.setValueAtTime(0.06, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.18);
        } catch (e) {}
    }

    /**
     * Acorde armónico para activación de escenas rápidas
     */
    sceneChime() {
        this.haptic(45);
        if (!this.model.soundEnabled) return;
        this._initContext();
        if (!this.ctx) return;

        const chordNotes = [523.25, 659.25, 783.99]; // C5, E5, G5
        chordNotes.forEach((freq, idx) => {
            try {
                const now = this.ctx.currentTime + (idx * 0.035);
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now);

                gain.gain.setValueAtTime(0.025, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.start(now);
                osc.stop(now + 0.16);
            } catch (e) {}
        });
    }

    /**
     * Respuesta háptica (vibración en teléfonos celulares compatibles)
     */
    haptic(pattern = 20) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
                navigator.vibrate(pattern);
            } catch (e) {}
        }
    }
}

if (typeof window !== 'undefined') {
    window.SoundService = SoundService;
}
