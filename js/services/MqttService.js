/**
 * MqttService - Servicio Unificado de Comunicación Domótica (Red Local DomótiX + MQTT Opcional)
 * Patrón MVC: Servicio de Infraestructura de Red
 * 
 * Diseñado para operar 100% de forma autónoma en Red Local (ESP32 AP http://192.168.4.1)
 * sin requerir conexión a internet.
 * Incorpora: Polling ultrarrápido (800ms), latencia RTT real por paquete,
 * cola offline resiliente y soporte para Broker MQTT WebSockets secundario.
 */
class MqttService {
    constructor(houseModel, auditLogger, networkHealthModel = null) {
        this.model = houseModel;
        this.logger = auditLogger;
        this.health = networkHealthModel;
        this.client = null;
        this.isConnected = false;
        this.isLocalApConnected = false;

        this._pingTimer = null;
        this._pingTimestamp = 0;
        this._localPollTimer = null;

        // Escuchar cambios de configuración para reconectar en caliente
        this.model.on('config:changed', () => {
            this.reconnect();
        });

        // Escuchar reconexión del navegador (solo relevante si se usa broker en la nube)
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                if (!this.isConnected && !this.model.demoMode && !this.model.isLocalMode) {
                    this.logger.log('info', 'RED', 'Conexión a internet restaurada. Reconectando MQTT...');
                    this.connect();
                }
            });
        }
    }

    /**
     * Inicia la conexión según el modo configurado:
     * - Modo Red Local DomótiX: HTTP REST directo hacia 192.168.4.1 (100% Sin Internet)
     * - Modo Broker MQTT: Conexión WebSockets segura (WSS)
     */
    connect() {
        // Limpiar conexiones previas
        if (this.client) {
            try { this.client.end(true); } catch (e) {}
            this.client = null;
        }
        if (this._pingTimer) {
            clearInterval(this._pingTimer);
            this._pingTimer = null;
        }
        if (this._localPollTimer) {
            clearInterval(this._localPollTimer);
            this._localPollTimer = null;
        }

        // ==========================================
        // 1. MODO RED LOCAL DOMÓTIX (SIN INTERNET)
        // ==========================================
        if (this.model.isLocalMode) {
            const baseUrl = this.model.localBaseUrl;
            this.model.setConnectionStatus('connecting', `Conectando a Red Local (${baseUrl.replace('http://', '')})...`);
            this.logger.log('info', 'RED LOCAL', `Iniciando comunicación directa con ESP32 en ${baseUrl} (Modo Autónomo)`);
            this._startLocalPolling();
            return;
        }

        // ==========================================
        // 2. MODO BROKER MQTT WEBSOCKETS (OPCIONAL)
        // ==========================================
        if (typeof mqtt === 'undefined') {
            console.error('[MqttService] Librería MQTT.js no encontrada.');
            this.model.setConnectionStatus('error', 'Error: MQTT no cargado');
            return;
        }

        const brokerUrl = this.model.brokerUrl;
        this.model.setConnectionStatus('connecting', 'Conectando a Broker...');
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
                this.isConnected = true;
                if (this.health) this.health.setConnected(true, false);

                if (!this.model.demoMode) {
                    this.model.setConnectionStatus('online', 'Broker En Vivo');
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
                this.isConnected = false;
                if (this.health) this.health.setConnected(false, false);
                if (!this.model.demoMode) {
                    this.model.setConnectionStatus('error', 'Fallo de Red MQTT');
                }
                this.logger.log('warn', 'ERROR', err.message || 'Error en socket MQTT');
            });

            this.client.on('offline', () => {
                this.isConnected = false;
                if (this.health) this.health.setConnected(false, false);
                if (!this.model.demoMode) {
                    this.model.setConnectionStatus('offline', 'Desconectado');
                }
            });

            this.client.on('reconnect', () => {
                if (!this.model.demoMode) {
                    this.model.setConnectionStatus('connecting', 'Reconectando...');
                }
            });

        } catch (err) {
            console.error('[MqttService] Error fatal al conectar:', err);
            this.model.setConnectionStatus('error', 'Fallo al iniciar cliente');
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

        // Primer sondeo de inmediato
        poll();
        this._localPollTimer = setInterval(poll, 800);
    }

    _handleLocalPollFailure(baseUrl) {
        if (this.isLocalApConnected) {
            this.isLocalApConnected = false;
            this.isConnected = false;
            if (!this.model.demoMode) {
                this.model.setConnectionStatus('offline', `Conectando a ESP32 (${baseUrl.replace('http://', '')})...`);
            }
            if (this.health) this.health.setConnected(false, true);
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
                // Refrescar telemetría confirmada desde el microcontrolador
                setTimeout(() => this._pollLocalTelemetryOnce(), 100);
                return true;
            }
        } catch (e) {
            // Si el microcontrolador no responde, encolar acción
            if (this.health) {
                this.health.enqueueOfflineCommand(endpoint, params, actionLabel);
                this.model.emit('offline:queued', { topic: endpoint, payload: params, label: actionLabel });
                this.logger.log('warn', 'COLA', `Acción en espera de conexión: ${actionLabel || endpoint}`);
            }
            return false;
        }
        return false;
    }

    // ==========================================
    // ENVÍO DE ACCIONES A ACTUADORES
    // ==========================================
    publishLight(room, state) {
        const label = `Cuarto ${room} -> ${state ? 'ENCENDIDO' : 'APAGADO'}`;
        this.logger.log('out', 'ORDEN', label);

        if (this.model.isLocalMode) {
            this._sendLocalApi('/api/luz', { cuarto: room, estado: state ? 1 : 0 }, label);
            return true;
        }

        // Modo MQTT en la nube
        const topic = this.model.topicLights;
        const payload = { cuarto: Number(room), estado: Boolean(state) };
        const ok = this.publish(topic, payload, label);
        if (!ok) {
            this._sendLocalApi('/api/luz', { cuarto: room, estado: state ? 1 : 0 }, label);
        }
        return ok;
    }

    publishDoor(open) {
        const label = `Puerta -> ${open ? 'ABIERTA (90°)' : 'CERRADA (0°)'}`;
        this.logger.log('out', 'ORDEN', label);

        if (this.model.isLocalMode) {
            this._sendLocalApi('/api/puerta', { abrir: open ? 1 : 0 }, label);
            return true;
        }

        // Modo MQTT en la nube
        const topic = this.model.topicDoor;
        const payload = { abrir: Boolean(open) };
        const ok = this.publish(topic, payload, label);
        if (!ok) {
            this._sendLocalApi('/api/puerta', { abrir: open ? 1 : 0 }, label);
        }
        return ok;
    }

    publishWindows(open, windowIndex = null) {
        const label = windowIndex 
            ? `Ventana ${windowIndex} -> ${open ? 'ABRIR' : 'CERRAR'}` 
            : `Todas las Ventanas -> ${open ? 'ABRIR' : 'CERRAR'}`;
        this.logger.log('out', 'ORDEN', label);

        const apiParams = windowIndex ? { ventana: windowIndex, abrir: open ? 1 : 0 } : { abrir: open ? 1 : 0 };

        if (this.model.isLocalMode) {
            this._sendLocalApi('/api/ventanas', apiParams, label);
            return true;
        }

        // Modo MQTT en la nube
        const topic = this.model.topicWindows;
        const payload = windowIndex 
            ? { ventana: Number(windowIndex), abrir: Boolean(open) } 
            : { abrir: Boolean(open) };
        const ok = this.publish(topic, payload, label);
        if (!ok) {
            this._sendLocalApi('/api/ventanas', apiParams, label);
        }
        return ok;
    }

    /**
     * Publica vía WebSocket MQTT si el cliente está conectado
     */
    publish(topic, payloadObj, actionLabel = '') {
        if (this.health) this.health.recordTx();

        if (this.client && this.isConnected) {
            const payloadStr = JSON.stringify(payloadObj);
            this.client.publish(topic, payloadStr, { qos: 0 }, (err) => {
                if (err) {
                    this.logger.log('warn', 'PUB', `Fallo al publicar en ${topic}`);
                }
            });
            return true;
        }

        if (this.isLocalApConnected) {
            return true;
        }

        if (this.health) {
            this.health.enqueueOfflineCommand(topic, payloadObj, actionLabel);
            this.model.emit('offline:queued', { topic, payload: payloadObj, label: actionLabel });
            this.logger.log('warn', 'COLA', `Acción en espera de conexión: ${actionLabel || topic}`);
        }
        return false;
    }

    _startPingHeartbeat() {
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
            if (!this.client || !this.isConnected) return;
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
                    if (this.model.isLocalMode) {
                        if (cmd.topic.includes('luz')) {
                            this._sendLocalApi('/api/luz', cmd.payload, cmd.label);
                        } else if (cmd.topic.includes('puerta')) {
                            this._sendLocalApi('/api/puerta', cmd.payload, cmd.label);
                        } else if (cmd.topic.includes('ventanas')) {
                            this._sendLocalApi('/api/ventanas', cmd.payload, cmd.label);
                        }
                    } else {
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
        this.isLocalApConnected = false;
        if (this.health) this.health.setConnected(false, false);
    }
}

if (typeof window !== 'undefined') {
    window.MqttService = MqttService;
}
