/**
 * HouseModel - Núcleo del Modelo de Datos y Lógica de Negocio Domótica
 * Patrón MVC: Modelo (Model)
 */
class HouseModel {
    constructor() {
        // Almacenamiento de observadores / eventos
        this._listeners = new Map();

        // Configuración de Conexión de Red (Por defecto: Red Local DomótiX sin internet)
        const savedBroker = localStorage.getItem('domotix_broker_url');
        if (!savedBroker || savedBroker === 'wss://broker.hivemq.com:8884/mqtt') {
            this.brokerUrl = 'http://192.168.4.1';
            localStorage.setItem('domotix_broker_url', this.brokerUrl);
        } else {
            this.brokerUrl = savedBroker;
        }
        this.topicPrefix = localStorage.getItem('domotix_topic_prefix') || 'uaemex_casa';

        // Preferencias de usuario
        const storedSound = localStorage.getItem('domotix_sound_enabled');
        this.soundEnabled = storedSound !== null ? storedSound === 'true' : true;
        this.demoMode = false;

        // Estado de Actuadores (Hardware)
        this.actuators = {
            lights: [false, false, false, false], // Cuartos 1 a 4 (GPIO 18, 19, 21, 22)
            door: false,                          // Puerta 0° cerrada / 90° abierta (GPIO 27)
            windows: [false, false, false],       // Ventanas individuales 1, 2, 3 (GPIO 13, 25, 26)
            windowsAll: false                     // true si todas están abiertas
        };

        // Estado de Sensores y Telemetría
        this.sensors = {
            temperature: 22.0,                    // DHT22 (°C) (GPIO 04)
            humidity: 50.0,                       // DHT22 (%) (GPIO 04)
            waterLevel: 50,                       // Potenciómetro HW-038 Tinaco (0-100%) (GPIO 34)
            waterLiters: 550,                     // Capacidad calculada: 0 a 1100 Litros
            isRaining: false,                     // Sensor de Lluvia digital (GPIO 32)
            lastUpdate: null                      // Timestamp del último paquete
        };

        // Estado de Conexión de Red
        this.connection = {
            status: 'connecting',                 // 'connecting' | 'online' | 'offline' | 'error' | 'demo'
            text: 'Conectando...',
            lastPing: null
        };

        // Historial métrico para renderizado de curvas fluidas en Canvas
        this.MAX_HISTORY_POINTS = 30;
        this.history = {
            temperature: [21.8, 22.0, 22.2, 22.0, 22.4],
            humidity: [48.0, 49.5, 50.0, 51.0, 49.8],
            waterLevel: [35, 40, 45, 48, 50]
        };

        // Restaurar estado persistido en caché local (Alta Disponibilidad Offline)
        this._restoreCachedState();
    }

    /**
     * Restaura el último estado guardado en LocalStorage para arranque instantáneo offline
     */
    _restoreCachedState() {
        try {
            const raw = localStorage.getItem('domotix_cached_state');
            if (raw) {
                const cached = JSON.parse(raw);
                if (cached.sensors) {
                    this.sensors = { ...this.sensors, ...cached.sensors, lastUpdate: cached.sensors.lastUpdate ? new Date(cached.sensors.lastUpdate) : null };
                }
                if (cached.actuators) {
                    this.actuators = { ...this.actuators, ...cached.actuators };
                }
                if (cached.history) {
                    this.history = { ...this.history, ...cached.history };
                }
            }
        } catch (err) {
            console.warn('[HouseModel] No se pudo restaurar caché previo:', err);
        }
    }

    /**
     * Guarda el estado actual en LocalStorage para disponibilidad sin conexión
     */
    _persistCurrentState() {
        try {
            localStorage.setItem('domotix_cached_state', JSON.stringify({
                sensors: this.sensors,
                actuators: this.actuators,
                history: this.history,
                savedAt: Date.now()
            }));
        } catch (e) {}
    }

    /**
     * Calcula métricas climáticas avanzadas basadas en DHT22 y el nivel del depósito
     * @returns {Object} { heatIndex, dewPoint, comfortLevel, autonomyDays, isMoldRisk }
     */
    getClimateMetrics() {
        const T = this.sensors.temperature;
        const H = this.sensors.humidity;

        // Sensación térmica aproximada (Heat Index simplificado)
        let heatIndex = T;
        if (T >= 21) {
            heatIndex = -8.784 + 1.611 * T + 2.338 * (H / 100) - 0.146 * T * (H / 100) + 0.0123 * (T * T) + 0.0164 * (H * H / 1000);
            heatIndex = Math.max(T - 1, Math.min(T + 8, heatIndex));
        }

        // Punto de rocío (Fórmula aproximada de Magnus-Tetens)
        const a = 17.27;
        const b = 237.7;
        const alpha = ((a * T) / (b + T)) + Math.log(Math.max(1, H) / 100.0);
        const dewPoint = (b * alpha) / (a - alpha);

        // Nivel de confort
        let comfortLevel = 'Óptimo';
        let comfortColor = '#10b981';
        if (T > 27 || (T > 25 && H > 70)) {
            comfortLevel = 'Caluroso / Húmedo';
            comfortColor = '#f59e0b';
        } else if (T < 18) {
            comfortLevel = 'Fresco / Frío';
            comfortColor = '#38bdf8';
        } else if (H > 75) {
            comfortLevel = 'Alta Humedad';
            comfortColor = '#0284c7';
        }

        // Estimación de autonomía del tinaco (consumo diario típico de 220 L)
        const autonomyDays = (this.sensors.waterLiters / 220).toFixed(1);

        // Riesgo de condensación o moho
        const isMoldRisk = H >= 72 && T >= 22;

        return {
            heatIndex: +heatIndex.toFixed(1),
            dewPoint: +dewPoint.toFixed(1),
            comfortLevel,
            comfortColor,
            autonomyDays: Math.max(0, +autonomyDays),
            isMoldRisk
        };
    }

    // ==========================================
    // SISTEMA DE EVENTOS (OBSERVER / PUBSUB)
    // ==========================================
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        if (!this._listeners.has(event)) return;
        const filtered = this._listeners.get(event).filter(cb => cb !== callback);
        this._listeners.set(event, filtered);
    }

    emit(event, data) {
        if (!this._listeners.has(event)) return;
        this._listeners.get(event).forEach(cb => {
            try {
                cb(data);
            } catch (err) {
                console.error(`[HouseModel] Error en observer del evento "${event}":`, err);
            }
        });
    }

    // ==========================================
    // TÓPICOS MQTT Y MODO DE RED LOCAL
    // ==========================================
    get topicTelemetry() { return `${this.topicPrefix}/telemetria`; }
    get topicLights()    { return `${this.topicPrefix}/actuadores/luces`; }
    get topicDoor()      { return `${this.topicPrefix}/actuadores/puerta`; }
    get topicWindows()   { return `${this.topicPrefix}/actuadores/ventanas`; }

    get isLocalMode() {
        return !this.brokerUrl.startsWith('ws://') && !this.brokerUrl.startsWith('wss://');
    }

    get localBaseUrl() {
        if (this.isLocalMode) {
            let url = this.brokerUrl.replace(/\/+$/, '');
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = `http://${url}`;
            }
            return url;
        }
        return 'http://192.168.4.1';
    }

    // ==========================================
    // CONFIGURACIÓN Y PERSISTENCIA
    // ==========================================
    updateBrokerConfig(newBrokerUrl, newTopicPrefix) {
        this.brokerUrl = (newBrokerUrl || '').trim();
        this.topicPrefix = (newTopicPrefix || '').trim();

        localStorage.setItem('domotix_broker_url', this.brokerUrl);
        localStorage.setItem('domotix_topic_prefix', this.topicPrefix);

        this.emit('config:changed', {
            brokerUrl: this.brokerUrl,
            topicPrefix: this.topicPrefix
        });
    }

    setSoundEnabled(enabled) {
        this.soundEnabled = !!enabled;
        localStorage.setItem('domotix_sound_enabled', String(this.soundEnabled));
        this.emit('sound:toggled', this.soundEnabled);
    }

    setDemoMode(enabled) {
        this.demoMode = !!enabled;
        if (this.demoMode) {
            this.setConnectionStatus('demo', 'Modo Demo Activo');
        }
        this.emit('demo:toggled', this.demoMode);
    }

    setConnectionStatus(status, text) {
        this.connection.status = status;
        this.connection.text = text || (status === 'online' ? 'Wokwi En Vivo' : status === 'offline' ? 'Desconectado' : 'Conectando...');
        this.connection.lastPing = new Date();
        this.emit('connection:changed', this.connection);
    }

    // ==========================================
    // LÓGICA DE NEGOCIO: ACTUADORES
    // ==========================================
    /**
     * Alterna la luz de una habitación (1 a 4)
     * @param {number} roomIndex - Índice 1 a 4
     */
    toggleLight(roomIndex) {
        const idx = roomIndex - 1;
        if (idx < 0 || idx > 3) return null;
        return this.setLight(roomIndex, !this.actuators.lights[idx]);
    }

    setLight(roomIndex, state) {
        const idx = roomIndex - 1;
        if (idx < 0 || idx > 3) return null;
        
        const newState = !!state;
        this.actuators.lights[idx] = newState;

        const payload = {
            room: roomIndex,
            state: newState,
            allLights: [...this.actuators.lights]
        };

        this.emit('light:changed', payload);
        this.emit('actuators:changed', this.actuators);
        return payload;
    }

    /**
     * Alterna apertura de la puerta principal (GPIO 27)
     */
    toggleDoor() {
        return this.setDoor(!this.actuators.door);
    }

    setDoor(state) {
        const newState = !!state;
        this.actuators.door = newState;

        const payload = {
            isOpen: newState,
            angle: newState ? 90 : 0
        };

        this.emit('door:changed', payload);
        this.emit('actuators:changed', this.actuators);
        return payload;
    }

    /**
     * Alterna ventanas con validación estricta de seguridad meteorológica
     * @param {number|null} windowIndex - 1, 2, 3 para ventana individual o null para todas
     */
    toggleWindows(windowIndex = null) {
        if (windowIndex !== null && windowIndex >= 1 && windowIndex <= 3) {
            const current = Boolean(this.actuators.windows[windowIndex - 1]);
            return this.setWindows(!current, windowIndex);
        }
        return this.setWindows(!this.actuators.windowsAll, null);
    }

    setWindows(state, windowIndex = null) {
        const wantsOpen = !!state;

        // REGLA DE NEGOCIO CRÍTICA: Bloqueo de seguridad si hay lluvia activa
        if (wantsOpen && this.sensors.isRaining) {
            const blockInfo = {
                blocked: true,
                reason: 'Protección Meteorológica: Sensor en GPIO 32 detecta agua. Ventanas bloqueadas para evitar filtraciones.'
            };
            this.emit('safety:blocked', blockInfo);
            return blockInfo;
        }

        if (windowIndex !== null && windowIndex >= 1 && windowIndex <= 3) {
            this.actuators.windows[windowIndex - 1] = wantsOpen;
            this.actuators.windowsAll = this.actuators.windows.every(Boolean);
        } else {
            this.actuators.windows = [wantsOpen, wantsOpen, wantsOpen];
            this.actuators.windowsAll = wantsOpen;
        }

        const payload = {
            isOpen: wantsOpen,
            windowIndex,
            windows: [...this.actuators.windows],
            allOpen: this.actuators.windowsAll,
            angle: wantsOpen ? 90 : 0,
            blocked: false
        };

        this.emit('windows:changed', payload);
        this.emit('actuators:changed', this.actuators);
        return payload;
    }

    /**
     * Aplica escenas domóticas inteligentes
     */
    applyScene(sceneId) {
        const commands = [];

        switch (sceneId) {
            case 'todas_on':
                for (let r = 1; r <= 4; r++) {
                    if (!this.actuators.lights[r - 1]) {
                        commands.push({ type: 'light', room: r, state: true });
                        this.setLight(r, true);
                    }
                }
                break;

            case 'todas_off':
                for (let r = 1; r <= 4; r++) {
                    if (this.actuators.lights[r - 1]) {
                        commands.push({ type: 'light', room: r, state: false });
                        this.setLight(r, false);
                    }
                }
                break;

            case 'noche':
                // Cerrar accesos por seguridad
                if (this.actuators.door) {
                    commands.push({ type: 'door', state: false });
                    this.setDoor(false);
                }
                if (this.actuators.windows) {
                    commands.push({ type: 'windows', state: false });
                    this.setWindows(false);
                }
                // Iluminación tenue en recámara principal
                if (!this.actuators.lights[0]) {
                    commands.push({ type: 'light', room: 1, state: true });
                    this.setLight(1, true);
                }
                // Apagar resto de cuartos
                for (let r = 2; r <= 4; r++) {
                    if (this.actuators.lights[r - 1]) {
                        commands.push({ type: 'light', room: r, state: false });
                        this.setLight(r, false);
                    }
                }
                break;

            case 'salir':
                // Apagar todo y asegurar perímetro
                for (let r = 1; r <= 4; r++) {
                    if (this.actuators.lights[r - 1]) {
                        commands.push({ type: 'light', room: r, state: false });
                        this.setLight(r, false);
                    }
                }
                if (this.actuators.door) {
                    commands.push({ type: 'door', state: false });
                    this.setDoor(false);
                }
                if (this.actuators.windows) {
                    commands.push({ type: 'windows', state: false });
                    this.setWindows(false);
                }
                break;
        }

        this.emit('scene:applied', { sceneId, commands });
        return commands;
    }

    // ==========================================
    // PROCESAMIENTO DE TELEMETRÍA ENTRANTE
    // ==========================================
    updateFromTelemetry(data) {
        if (!data || typeof data !== 'object') return;

        const prevRaining = this.sensors.isRaining;

        // 1. Sensores ambientales y depósito
        if (typeof data.temperatura === 'number') {
            this.sensors.temperature = Number(data.temperatura);
        }
        if (typeof data.humedad === 'number') {
            this.sensors.humidity = Number(data.humedad);
        }
        if (typeof data.nivel_tinaco === 'number') {
            const raw = Math.max(0, Math.min(100, Math.round(data.nivel_tinaco)));
            this.sensors.waterLevel = raw;
            this.sensors.waterLiters = Math.round((raw / 100) * 1100);
        }
        if (data.lluvia !== undefined) {
            this.sensors.isRaining = Boolean(data.lluvia);
            // Si comienza a llover y las ventanas estaban abiertas, cerrar por seguridad
            const anyOpen = Array.isArray(this.actuators.windows)
                ? this.actuators.windows.some(Boolean)
                : Boolean(this.actuators.windows);

            if (this.sensors.isRaining && !prevRaining && anyOpen) {
                this.setWindows(false, null);
                this.emit('safety:rainAutoClosed', {
                    message: 'Precipitación detectada: Ventanas aseguradas automáticamente.'
                });
            }
        }
        this.sensors.lastUpdate = new Date();

        // 2. Sincronización de actuadores si vienen en el paquete
        if (data.puerta_abierta !== undefined) {
            this.actuators.door = Boolean(data.puerta_abierta);
        }
        if (data.ventanas && typeof data.ventanas === 'object') {
            this.actuators.windows[0] = Boolean(data.ventanas.v1);
            this.actuators.windows[1] = Boolean(data.ventanas.v2);
            this.actuators.windows[2] = Boolean(data.ventanas.v3);
            this.actuators.windowsAll = this.actuators.windows.every(Boolean);
        } else if (data.ventanas_abiertas !== undefined) {
            const all = Boolean(data.ventanas_abiertas);
            this.actuators.windows = [all, all, all];
            this.actuators.windowsAll = all;
        }
        if (data.luces && typeof data.luces === 'object') {
            if (data.luces.c1 !== undefined) this.actuators.lights[0] = Boolean(data.luces.c1);
            if (data.luces.c2 !== undefined) this.actuators.lights[1] = Boolean(data.luces.c2);
            if (data.luces.c3 !== undefined) this.actuators.lights[2] = Boolean(data.luces.c3);
            if (data.luces.c4 !== undefined) this.actuators.lights[3] = Boolean(data.luces.c4);
        }

        // 3. Cola histórica
        this.history.temperature.push(this.sensors.temperature);
        this.history.humidity.push(this.sensors.humidity);
        this.history.waterLevel.push(this.sensors.waterLevel);

        if (this.history.temperature.length > this.MAX_HISTORY_POINTS) {
            this.history.temperature.shift();
            this.history.humidity.shift();
            this.history.waterLevel.shift();
        }

        // 4. Notificaciones desacopladas
        this.emit('telemetry:updated', {
            sensors: { ...this.sensors },
            history: { ...this.history }
        });

        this.emit('actuators:changed', { ...this.actuators });
        this._persistCurrentState();
    }

    /**
     * Genera datos simulados plausibles para el modo demo
     */
    generateDemoStep() {
        const simT = +(21.0 + Math.random() * 4.0).toFixed(1);
        const simH = +(45.0 + Math.random() * 15.0).toFixed(1);
        const deltaTin = Math.floor((Math.random() - 0.48) * 6);
        const simTin = Math.min(100, Math.max(10, this.sensors.waterLevel + deltaTin));

        this.updateFromTelemetry({
            temperatura: simT,
            humedad: simH,
            nivel_tinaco: simTin,
            lluvia: this.sensors.isRaining,
            puerta_abierta: this.actuators.door,
            ventanas_abiertas: this.actuators.windowsAll,
            ventanas: {
                v1: this.actuators.windows[0],
                v2: this.actuators.windows[1],
                v3: this.actuators.windows[2]
            },
            luces: {
                c1: this.actuators.lights[0],
                c2: this.actuators.lights[1],
                c3: this.actuators.lights[2],
                c4: this.actuators.lights[3]
            }
        });
    }
}

if (typeof window !== 'undefined') {
    window.HouseModel = HouseModel;
}
