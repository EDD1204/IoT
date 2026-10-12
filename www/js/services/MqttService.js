/**
 * MqttService - Servicio Unificado de Comunicación Domótica (Red Local DomótiX + Broker MQTT Dual)
 * Patrón MVC: Servicio de Infraestructura de Red
 * 
 * Diseñado para operar 100% de forma autónoma en Red Local (ESP32 AP http://192.168.4.1)
 * sin requerir conexión a internet, Y AL MISMO TIEMPO compatible de inmediato con
 * el simulador Wokwi mediante WebSockets seguros (HiveMQ).
 * 
 * Incorpora:
 * - Doble despacho simultáneo (HTTP local + MQTT WSS).
 * - Polling HTTP ultrarrápido (800ms) con cálculo de latencia RTT.
 * - Cola offline resiliente para comandos cuando no hay conexión.
 */
class MqttService {
    constructor(houseModel, auditLogger, networkHealthModel = null) {
        this.model = houseModel;
        this.logger = auditLogger;
        this.health = networkHealthModel;
        this.client = null;
        this.isConnected = false;
        this.isMqttConnected = false;
        this.isLocalApConnected = false;

        this._pingTimer = null;
        this._pingTimestamp = 0;
        this._localPollTimer = null;

        // Escuchar cambios de configuración para reconectar en caliente
        this.model.on('config:changed', () => {
            this.reconnect();
        });

        // Escuchar reconexión del navegador
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                if (!this.isConnected && !this.model.demoMode) {
                    this.logger.log('info', 'RED', 'Conectividad detectada. Verificando servicios...');
                    this.connect();
                }
            });
        }
    }

    /**
     * Inicia la conexión en modo dual inteligente:
     * - Sondeo local HTTP al ESP32 (http://192.168.4.1)
     * - Conexión WebSockets segura (WSS) a Broker MQTT (para Wokwi o acceso remoto)
     */
    connect() {
        this.disconnect();

        // 1. Iniciar sondeo HTTP hacia la IP local
        this._startLocalPolling();

        // 2. Iniciar cliente MQTT si la librería está disponible
        if (typeof mqtt !== 'undefined') {
            const brokerUrl = this.model.isLocalMode 
                ? 'wss://broker.hivemq.com:8884/mqtt' 
                : this.model.brokerUrl;
            this._startMqttConnection(brokerUrl);
        }
    }

    // ==========================================
    // CONEXIÓN MQTT WEBSOCKETS (WOKWI / NUBE)
    // ==========================================
    _startMqttConnection(brokerUrl) {
        this.logger.log('info', 'MQTT', `Iniciando conexión a: ${brokerUrl}`);
        const clientId = `DomotixApp_${Math.random().toString(16).substr(2, 8)}`;

        try {
            this.client = mqtt.connect(brokerUrl, {
                clientId,
                clean: true,
                keepalive: 30,
                reconnectPeriod: 4000,
                connectTimeout: 8000
            });

            this.client.on('connect', () => {
                this.isMqttConnected = true;
                this.isConnected = true;
                if (this.health) this.health.setConnected(true, false);

                if (!this.model.demoMode && !this.isLocalApConnected) {
                    this.model.setConnectionStatus('online', 'Broker En Vivo (Wokwi / MQTT)');
                }

                // Suscribirse a tópicos del ESP32
                const topicTelemetria = this.model.topicTelemetry;
                this.client.subscribe(topicTelemetria, (err) => {
                    if (err) {
                        this.logger.log('warn', 'SUB', `Error al suscribir a ${topicTelemetria}`);
                    } else {
                        this.logger.log('in', 'MQTT', `Suscripción activa en: ${topicTelemetria}`);
                    }
                });

                const topicPingEcho = `${this.model.topicPrefix}/ping/echo`;
                this.client.subscribe(topicPingEcho, () => {});

                this.logger.log('in', 'MQTT', 'Conexión exitosa al broker WebSockets.');
                this._flushOfflineQueue();
                this._startPingHeartbeat();
            });

            this.client.on('message', (topic, payload) => {
                if (this.health) this.health.recordRx();
                const messageStr = payload.toString();

                if (topic === `${this.model.topicPrefix}/ping/echo`) {
                    if (this._pingTimestamp > 0) {
                        const rtt = Date.now() - this._pingTimestamp;
                        if (this.health) this.health.recordPing(rtt);
                        this._pingTimestamp = 0;
                    }
                    return;
                }

                if (topic === this.model.topicTelemetry) {
                    try {
                        const data = JSON.parse(messageStr);
                        this.model.updateFromTelemetry(data);
                        this.logger.log('in', 'TELEMETRÍA', `T=${data.temperatura}°C | H=${data.humedad}% | Tinaco=${data.nivel_tinaco}% | Lluvia=${data.lluvia ? 'SÍ' : 'NO'}`);
                    } catch (e) {
                        this.logger.log('warn', 'JSON', `Error al parsear paquete: ${messageStr}`);
                    }
                }
            });

            this.client.on('error', (err) => {
                this.isMqttConnected = false;
                if (!this.isLocalApConnected) {
                    this.isConnected = false;
                    if (this.health) this.health.setConnected(false, false);
                    if (!this.model.demoMode) {
                        this.model.setConnectionStatus('error', 'Fallo de Red MQTT');
                    }
                }
            });

            this.client.on('offline', () => {
                this.isMqttConnected = false;
                if (!this.isLocalApConnected) {
                    this.isConnected = false;
                    if (this.health) this.health.setConnected(false, false);
                    if (!this.model.demoMode) {
                        this.model.setConnectionStatus('offline', 'Desconectado');
                    }
                }
            });

            this.client.on('reconnect', () => {
                if (!this.isLocalApConnected && !this.model.demoMode) {
                    this.model.setConnectionStatus('connecting', 'Reconectando MQTT...');
                }
            });

        } catch (err) {
            console.warn('[MqttService] Error al conectar a broker MQTT:', err);
        }
    }

    // ==========================================
    // MODO RED LOCAL: SONDEO Y COMANDOS HTTP
    // ==========================================
    _startLocalPolling() {
        if (this._localPollTimer) clearInterval(this._localPollTimer);

        const poll = async () => {
            if (this.model.demoMode) return;
            const baseUrl = this.model.localBaseUrl;
            const t0 = Date.now();

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1200);
                const res = await fetch(`${baseUrl}/api/telemetria`, {
                    signal: controller.signal,
                    mode: 'cors'
                });
                clearTimeout(timeoutId);
                const rtt = Math.max(1, Date.now() - t0);

                if (res.ok) {
                    const data = await res.json();
                    this.isLocalApConnected = true;
                    this.isConnected = true;

                    if (!this.model.demoMode) {
                        this.model.setConnectionStatus('online', `Red Local DomótiX (${baseUrl.replace('http://', '')})`);
                    }

                    if (this.health) {
                        this.health.setConnected(true, true);
                        this.health.recordPing(rtt);
                        this.health.recordRx();
                    }

                    this.model.updateFromTelemetry(data);

                    // Sincronizar cola si había comandos pendientes
                    if (this.health && this.health.offlineQueue.length > 0) {
                        this._flushOfflineQueue();
                    }
                } else {
                    this._handleLocalPollFailure(baseUrl);
                }
            } catch (e) {
                this._handleLocalPollFailure(baseUrl);
            }
        };

        poll();
        this._localPollTimer = setInterval(poll, 800);
    }

    _handleLocalPollFailure(baseUrl) {
        if (this.isLocalApConnected) {
            this.isLocalApConnected = false;
            if (!this.isMqttConnected) {
                this.isConnected = false;
                if (!this.model.demoMode) {
                    this.model.setConnectionStatus('offline', `Conectando a ESP32 (${baseUrl.replace('http://', '')})...`);
                }
                if (this.health) this.health.setConnected(false, true);
            }
        }
    }

    async _pollLocalTelemetryOnce() {
        try {
            const baseUrl = this.model.localBaseUrl;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);
            const res = await fetch(`${baseUrl}/api/telemetria`, {
                signal: controller.signal,
                mode: 'cors'
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                this.isLocalApConnected = true;
                this.isConnected = true;
                this.model.updateFromTelemetry(data);
                if (this.health) this.health.recordRx();
            }
        } catch (e) {}
    }

    /**
     * Envío directo de comandos HTTP hacia el ESP32 en red local
     */
    async _sendLocalApi(endpoint, params = {}, actionLabel = '') {
        const baseUrl = this.model.localBaseUrl;
        const query = new URLSearchParams(params).toString();
        const url = `${baseUrl}${endpoint}${query ? '?' + query : ''}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);
            const res = await fetch(url, { signal: controller.signal, mode: 'cors' });
            clearTimeout(timeoutId);

            if (res.ok) {
                if (this.health) this.health.recordTx();
                this.isLocalApConnected = true;
                this.isConnected = true;
                setTimeout(() => this._pollLocalTelemetryOnce(), 100);
                return true;
            }
        } catch (e) {
            return false;
        }
        return false;
    }

    // ==========================================
    // ENVÍO DE ACCIONES A ACTUADORES (DUAL-DISPATCH)
    // ==========================================
    publishLight(room, state) {
        const label = `Cuarto ${room} -> ${state ? 'ENCENDIDO' : 'APAGADO'}`;
        this.logger.log('out', 'ORDEN', label);

        const apiParams = { cuarto: Number(room), estado: state ? 1 : 0 };
        const mqttTopic = this.model.topicLights;
        const mqttPayload = { cuarto: Number(room), estado: Boolean(state) };

        let dispatched = false;

        // 1. Canal MQTT (Simulador Wokwi / HiveMQ)
        if (this.client && this.isMqttConnected) {
            this.publish(mqttTopic, mqttPayload, label);
            dispatched = true;
        }

        // 2. Canal Red Local HTTP (ESP32 Físico en AP Domotix-UAEMex)
        if (this.isLocalApConnected || this.model.isLocalMode) {
            this._sendLocalApi('/api/luz', apiParams, label);
            dispatched = true;
        }

        // 3. Si ninguno de los dos canales está activo, encolar acción
        if (!dispatched && this.health) {
            this.health.enqueueOfflineCommand(mqttTopic, mqttPayload, label);
            this.model.emit('offline:queued', { topic: mqttTopic, payload: mqttPayload, label });
            this.logger.log('warn', 'COLA', `Acción en espera de conexión: ${label}`);
        }
        return dispatched;
    }

    publishDoor(open) {
        const label = `Puerta -> ${open ? 'ABIERTA (90°)' : 'CERRADA (0°)'}`;
        this.logger.log('out', 'ORDEN', label);

        const apiParams = { abrir: open ? 1 : 0 };
        const mqttTopic = this.model.topicDoor;
        const mqttPayload = { abrir: Boolean(open) };

        let dispatched = false;

        // 1. Canal MQTT
        if (this.client && this.isMqttConnected) {
            this.publish(mqttTopic, mqttPayload, label);
            dispatched = true;
        }

        // 2. Canal Red Local HTTP
        if (this.isLocalApConnected || this.model.isLocalMode) {
            this._sendLocalApi('/api/puerta', apiParams, label);
            dispatched = true;
        }

        // 3. Encolar si fuera de línea
        if (!dispatched && this.health) {
            this.health.enqueueOfflineCommand(mqttTopic, mqttPayload, label);
            this.model.emit('offline:queued', { topic: mqttTopic, payload: mqttPayload, label });
            this.logger.log('warn', 'COLA', `Acción en espera de conexión: ${label}`);
        }
        return dispatched;
    }

    publishWindows(open, windowIndex = null) {
        const label = windowIndex 
            ? `Ventana ${windowIndex} -> ${open ? 'ABRIR' : 'CERRAR'}` 
            : `Todas las Ventanas -> ${open ? 'ABRIR' : 'CERRAR'}`;
        this.logger.log('out', 'ORDEN', label);

        const apiParams = windowIndex ? { ventana: windowIndex, abrir: open ? 1 : 0 } : { abrir: open ? 1 : 0 };
        const mqttTopic = this.model.topicWindows;
        const mqttPayload = windowIndex 
            ? { ventana: Number(windowIndex), abrir: Boolean(open) } 
            : { abrir: Boolean(open) };

        let dispatched = false;

        // 1. Canal MQTT
        if (this.client && this.isMqttConnected) {
            this.publish(mqttTopic, mqttPayload, label);
            dispatched = true;
        }

        // 2. Canal Red Local HTTP
        if (this.isLocalApConnected || this.model.isLocalMode) {
            this._sendLocalApi('/api/ventanas', apiParams, label);
            dispatched = true;
        }

        // 3. Encolar si fuera de línea
        if (!dispatched && this.health) {
            this.health.enqueueOfflineCommand(mqttTopic, mqttPayload, label);
            this.model.emit('offline:queued', { topic: mqttTopic, payload: mqttPayload, label });
            this.logger.log('warn', 'COLA', `Acción en espera de conexión: ${label}`);
        }
        return dispatched;
    }

    /**
     * Publicación genérica en Broker MQTT
     */
    publish(topic, payloadObj, actionLabel = '') {
        if (!this.client || !this.isMqttConnected) {
            return false;
        }

        try {
            const messageStr = JSON.stringify(payloadObj);
            this.client.publish(topic, messageStr, { qos: 0 }, (err) => {
                if (err) {
                    this.logger.log('warn', 'PUB', `Error al publicar en ${topic}: ${err.message}`);
                } else {
                    if (this.health) this.health.recordTx();
                    this.logger.log('out', 'PUB', `${actionLabel || topic}: ${messageStr}`);
                }
            });
            return true;
        } catch (e) {
            return false;
        }
    }

    _startPingHeartbeat() {
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
            if (!this.client || !this.isMqttConnected) return;
            this._pingTimestamp = Date.now();
            const pingTopic = `${this.model.topicPrefix}/ping/echo`;
            this.client.publish(pingTopic, JSON.stringify({ ping: this._pingTimestamp }), { qos: 0 });
        }, 12000);
    }

    _flushOfflineQueue() {
        if (!this.health) return;
        const pending = this.health.dequeueAll();
        if (pending.length > 0) {
            this.logger.log('info', 'COLA', `Sincronizando ${pending.length} acciones pendientes con el ESP32...`);
            pending.forEach((cmd, i) => {
                setTimeout(() => {
                    if (this.isLocalApConnected || this.model.isLocalMode) {
                        if (cmd.topic.includes('luz')) {
                            this._sendLocalApi('/api/luz', cmd.payload, cmd.label);
                        } else if (cmd.topic.includes('puerta')) {
                            this._sendLocalApi('/api/puerta', cmd.payload, cmd.label);
                        } else if (cmd.topic.includes('ventanas')) {
                            this._sendLocalApi('/api/ventanas', cmd.payload, cmd.label);
                        }
                    } else if (this.isMqttConnected) {
                        this.publish(cmd.topic, cmd.payload);
                    }
                }, i * 120);
            });
            this.model.emit('offline:synced', { count: pending.length });
        }
    }

    reconnect() {
        this.connect();
    }

    disconnect() {
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
        if (this._localPollTimer) {
            clearInterval(this._localPollTimer);
            this._localPollTimer = null;
        }
        if (this.client) {
            try { this.client.end(true); } catch (e) {}
            this.client = null;
        }
        this.isConnected = false;
        this.isMqttConnected = false;
        this.isLocalApConnected = false;
        if (this.health) this.health.setConnected(false, false);
    }
}

if (typeof window !== 'undefined') {
    window.MqttService = MqttService;
}
