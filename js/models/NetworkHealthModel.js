/**
 * NetworkHealthModel - Modelo de Diagnóstico de Red, Disponibilidad y Resiliencia
 * Patrón MVC: Modelo (Model)
 * Monitorea latencia RTT, brokers alternativos, cola offline y métricas de conexión.
 */
class NetworkHealthModel {
    constructor() {
        this._listeners = new Map();

        // Lista de conexiones de red y brokers (Red Local DomótiX por defecto)
        this.presetBrokers = [
            {
                id: 'local_domotix',
                name: 'Red Local DomótiX (ESP32 - 192.168.4.1)',
                url: 'http://192.168.4.1',
                region: 'Red Local Directa (Sin Internet)',
                isDefault: true
            },
            {
                id: 'hivemq',
                name: 'HiveMQ Public (WSS)',
                url: 'wss://broker.hivemq.com:8884/mqtt',
                region: 'Global / UE',
                isDefault: false
            },
            {
                id: 'emqx',
                name: 'EMQX Cloud Public (WSS)',
                url: 'wss://broker.emqx.io:8084/mqtt',
                region: 'Global CDN'
            },
            {
                id: 'mosquitto',
                name: 'Eclipse Mosquitto (WSS)',
                url: 'wss://test.mosquitto.org:8081/mqtt',
                region: 'Europa'
            }
        ];

        // Estado de métricas de red
        this.latencyMs = null;
        this.latencyHistory = [8, 12, 10, 9, 11];
        this.packetsTx = 0;
        this.packetsRx = 0;
        this.connectedSince = null;
        this.isLocalActive = true;
        this.isOnline = true;

        // Cola de acciones pendientes para disponibilidad sin conexión (Offline Queue)
        this.offlineQueue = [];

        this._setupNavigatorListeners();
    }

    _setupNavigatorListeners() {
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                this.isOnline = true;
                this.emit('network:status', { isOnline: true, isLocal: this.isLocalActive });
            });
            window.addEventListener('offline', () => {
                // Si la red local con el ESP32 está activa, no considerar offline
                if (this.isLocalActive) {
                    this.isOnline = true;
                } else {
                    this.isOnline = false;
                    this.emit('network:status', { isOnline: false, isLocal: false });
                }
            });
        }
    }

    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
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
            try { cb(data); } catch (e) { console.error(`[NetworkHealthModel] Error en listener "${event}":`, e); }
        });
    }

    recordPing(ms) {
        const validMs = Math.max(1, Math.round(ms));
        this.latencyMs = validMs;
        this.latencyHistory.push(validMs);
        if (this.latencyHistory.length > 15) {
            this.latencyHistory.shift();
        }
        this.emit('health:updated', this.getStats());
    }

    recordTx() {
        this.packetsTx++;
        this.emit('health:updated', this.getStats());
    }

    recordRx() {
        this.packetsRx++;
        this.emit('health:updated', this.getStats());
    }

    setConnected(isConnected, isLocal = false) {
        this.isLocalActive = Boolean(isLocal);
        if (isConnected) {
            this.connectedSince = new Date();
            this.isOnline = true;
        } else {
            this.connectedSince = null;
            this.latencyMs = null;
        }
        this.emit('health:updated', this.getStats());
    }

    /**
     * Encola un comando cuando no hay conectividad activa
     */
    enqueueOfflineCommand(topic, payload, label) {
        const item = {
            id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            topic,
            payload,
            label: label || topic,
            timestamp: new Date()
        };
        this.offlineQueue.push(item);
        this.emit('queue:changed', { queue: [...this.offlineQueue], count: this.offlineQueue.length });
        return item;
    }

    dequeueAll() {
        const items = [...this.offlineQueue];
        this.offlineQueue = [];
        this.emit('queue:changed', { queue: [], count: 0 });
        return items;
    }

    removeQueueItem(id) {
        this.offlineQueue = this.offlineQueue.filter(item => item.id !== id);
        this.emit('queue:changed', { queue: [...this.offlineQueue], count: this.offlineQueue.length });
    }

    getStats() {
        let uptimeStr = '--';
        if (this.connectedSince) {
            const secs = Math.floor((Date.now() - this.connectedSince.getTime()) / 1000);
            const m = Math.floor(secs / 60);
            const s = secs % 60;
            uptimeStr = `${m}m ${s}s`;
        }

        // Calidad de latencia
        let quality = 'Excelente';
        let qualityColor = '#10b981';
        if (this.latencyMs === null) {
            quality = this.isLocalActive ? 'Conectando Red Local...' : 'Esperando...';
            qualityColor = '#94a3b8';
        } else if (this.isLocalActive) {
            quality = 'Red Local Directa';
            qualityColor = '#10b981';
        } else if (this.latencyMs > 250) {
            quality = 'Alta Latencia';
            qualityColor = '#e11d48';
        } else if (this.latencyMs > 120) {
            quality = 'Moderada';
            qualityColor = '#f59e0b';
        }

        return {
            latencyMs: this.latencyMs,
            latencyHistory: [...this.latencyHistory],
            packetsTx: this.packetsTx,
            packetsRx: this.packetsRx,
            uptimeStr,
            quality,
            qualityColor,
            isOnline: this.isLocalActive || this.isOnline,
            isLocal: this.isLocalActive,
            queueLength: this.offlineQueue.length
        };
    }
}

if (typeof window !== 'undefined') {
    window.NetworkHealthModel = NetworkHealthModel;
}
