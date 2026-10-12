/**
 * AuditLogger - Registro cronológico y auditoría del sistema IoT
 * Patrón MVC: Componente del Modelo de Datos
 */
class AuditLogger {
    constructor(maxEntries = 100) {
        this.maxEntries = maxEntries;
        this.entries = [];
        this.listeners = [];
    }

    /**
     * Registra un evento en la cola de auditoría
     * @param {'in'|'out'|'warn'|'info'} type - Categoría visual/semántica del log
     * @param {string} tag - Identificador de origen (MQTT, ORDEN, TELEMETRÍA, etc.)
     * @param {string} message - Descripción legible de la carga o evento
     */
    log(type, tag, message) {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        
        const entry = {
            id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: now.toISOString(),
            timeStr,
            type: type || 'info',
            tag: tag || 'SYS',
            message: String(message)
        };

        this.entries.unshift(entry);
        if (this.entries.length > this.maxEntries) {
            this.entries.pop();
        }

        this._notifyListeners(entry);
        return entry;
    }

    /**
     * Suscribe un listener a nuevos registros
     */
    onLog(callback) {
        if (typeof callback === 'function') {
            this.listeners.push(callback);
        }
    }

    _notifyListeners(entry) {
        this.listeners.forEach(cb => {
            try {
                cb(entry);
            } catch (err) {
                console.error('[AuditLogger] Error en listener:', err);
            }
        });
    }

    /**
     * Retorna copia de las entradas
     */
    getEntries() {
        return [...this.entries];
    }

    /**
     * Descarga el registro histórico en formato JSON
     */
    exportAsJSON() {
        const dataStr = JSON.stringify(this.entries, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `domotix_auditoria_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Limpia la bitácora
     */
    clear() {
        this.entries = [];
    }
}

// Registro global seguro para soporte sin bundler y con ES modules
if (typeof window !== 'undefined') {
    window.AuditLogger = AuditLogger;
}
