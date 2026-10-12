/**
 * SpeechService - Reconocimiento de Voz y Control por Comandos Verbales
 * Patrón MVC: Servicio de Interfaz y Accesibilidad
 * Soporta Web Speech API con interpretación de lenguaje natural en español.
 */
class SpeechService {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this._listeners = new Map();
        this.isSupported = false;

        this._initRecognition();
    }

    _initRecognition() {
        if (typeof window === 'undefined') return;

        const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRec) {
            this.isSupported = false;
            return;
        }

        try {
            this.recognition = new SpeechRec();
            this.recognition.lang = 'es-MX';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;
            this.recognition.maxAlternatives = 1;
            this.isSupported = true;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.emit('listening:changed', { isListening: true });
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.emit('listening:changed', { isListening: false });
            };

            this.recognition.onerror = (event) => {
                this.isListening = false;
                this.emit('error', { error: event.error });
                this.emit('listening:changed', { isListening: false });
            };

            this.recognition.onresult = (event) => {
                if (event.results && event.results[0] && event.results[0][0]) {
                    const transcript = event.results[0][0].transcript.trim().toLowerCase();
                    const action = this._parseCommand(transcript);
                    this.emit('command', { transcript, action });
                }
            };
        } catch (e) {
            this.isSupported = false;
        }
    }

    on(event, callback) {
        if (!this._listeners.has(event)) this._listeners.set(event, []);
        this._listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (!this._listeners.has(event)) return;
        this._listeners.set(event, this._listeners.get(event).filter(cb => cb !== callback));
    }

    emit(event, data) {
        if (!this._listeners.has(event)) return;
        this._listeners.get(event).forEach(cb => {
            try { cb(data); } catch (e) { console.error(`[SpeechService] Error en listener "${event}":`, e); }
        });
    }

    start() {
        if (!this.isSupported || !this.recognition) return false;
        try {
            this.recognition.start();
            return true;
        } catch (e) {
            return false;
        }
    }

    stop() {
        if (!this.recognition) return;
        try {
            this.recognition.stop();
        } catch (e) {}
    }

    toggle() {
        if (this.isListening) {
            this.stop();
            return false;
        } else {
            return this.start();
        }
    }

    /**
     * Analiza la frase verbal y determina la orden domótica correspondiente
     */
    _parseCommand(text) {
        // Luces específicas
        if (text.includes('cuarto 1') || text.includes('recámara') || text.includes('recamara')) {
            const on = text.includes('prender') || text.includes('encender') || text.includes('activar');
            const off = text.includes('apagar') || text.includes('desactivar');
            return { type: 'light', room: 1, state: on ? true : off ? false : 'toggle' };
        }
        if (text.includes('cuarto 2') || text.includes('estudio') || text.includes('oficina')) {
            const on = text.includes('prender') || text.includes('encender') || text.includes('activar');
            const off = text.includes('apagar') || text.includes('desactivar');
            return { type: 'light', room: 2, state: on ? true : off ? false : 'toggle' };
        }
        if (text.includes('cuarto 3') || text.includes('cocina') || text.includes('comedor')) {
            const on = text.includes('prender') || text.includes('encender') || text.includes('activar');
            const off = text.includes('apagar') || text.includes('desactivar');
            return { type: 'light', room: 3, state: on ? true : off ? false : 'toggle' };
        }
        if (text.includes('cuarto 4') || text.includes('sala')) {
            const on = text.includes('prender') || text.includes('encender') || text.includes('activar');
            const off = text.includes('apagar') || text.includes('desactivar');
            return { type: 'light', room: 4, state: on ? true : off ? false : 'toggle' };
        }

        // Escenas de luces globales
        if (text.includes('todas las luces') || text.includes('todas') || text.includes('toda la casa')) {
            if (text.includes('apagar') || text.includes('apaga') || text.includes('fuera')) {
                return { type: 'scene', sceneId: 'todas_off' };
            }
            if (text.includes('prender') || text.includes('enciende') || text.includes('encender')) {
                return { type: 'scene', sceneId: 'todas_on' };
            }
        }

        // Puerta
        if (text.includes('puerta')) {
            if (text.includes('abrir') || text.includes('abre')) {
                return { type: 'door', open: true };
            }
            if (text.includes('cerrar') || text.includes('cierra') || text.includes('bloquear')) {
                return { type: 'door', open: false };
            }
            return { type: 'door', toggle: true };
        }

        // Ventanas
        if (text.includes('ventana') || text.includes('ventanas')) {
            if (text.includes('abrir') || text.includes('abre')) {
                return { type: 'windows', open: true };
            }
            if (text.includes('cerrar') || text.includes('cierra')) {
                return { type: 'windows', open: false };
            }
            return { type: 'windows', toggle: true };
        }

        // Escenas
        if (text.includes('noche') || text.includes('dormir') || text.includes('buenas noches')) {
            return { type: 'scene', sceneId: 'noche' };
        }
        if (text.includes('salir') || text.includes('me voy') || text.includes('fuera de casa')) {
            return { type: 'scene', sceneId: 'salir' };
        }

        return { type: 'unknown', raw: text };
    }
}

if (typeof window !== 'undefined') {
    window.SpeechService = SpeechService;
}
