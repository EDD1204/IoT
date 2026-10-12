/**
 * AutomationsModel - Modelo de Reglas y Automatizaciones Inteligentes
 * Patrón MVC: Modelo (Model)
 * Gestiona la lógica de reglas domóticas autónomas y disparadores inteligentes.
 */
class AutomationsModel {
    constructor(houseModel) {
        this.house = houseModel;
        this._listeners = new Map();

        // Almacenamiento de enfriamiento (cooldowns) para evitar alertas repetitivas
        this._cooldowns = new Map();

        // Temporizador para auto-cierre de puerta
        this._doorTimer = null;

        // Definición de reglas automáticas
        this.rules = [
            {
                id: 'rain_shield',
                name: 'Escudo Anti-Lluvia',
                desc: 'Asegura las 3 ventanas de inmediato ante cualquier indicio de lluvia en el techo.',
                icon: '🌧️',
                category: 'Seguridad',
                enabled: true,
                lastTriggered: null
            },
            {
                id: 'tank_reserve_alert',
                name: 'Alerta de Reserva Tinaco',
                desc: 'Notifica preventivamente si el nivel de agua en el depósito cae por debajo del 20% (< 220 L).',
                icon: '🚰',
                category: 'Recursos',
                enabled: true,
                lastTriggered: null
            },
            {
                id: 'overheat_vent',
                name: 'Ventilación Térmica',
                desc: 'Alerta de bochorno si la temperatura interior supera los 27°C sin lluvia en el exterior.',
                icon: '🌡️',
                category: 'Confort',
                enabled: true,
                lastTriggered: null
            },
            {
                id: 'auto_door_lock',
                name: 'Cierre Seguro de Puerta',
                desc: 'Cierra automáticamente la puerta principal tras 35 segundos de permanecer abierta.',
                icon: '🚪',
                category: 'Acceso',
                enabled: false,
                lastTriggered: null
            },
            {
                id: 'eco_lighting',
                name: 'Ahorro Energético Diurno',
                desc: 'Monitorea el uso de luminarias y sugiere apagar cuartos desocupados.',
                icon: '💡',
                category: 'Energía',
                enabled: true,
                lastTriggered: null
            }
        ];

        this._loadPreferences();
    }

    _loadPreferences() {
        try {
            const raw = localStorage.getItem('domotix_automations_rules');
            if (raw) {
                const saved = JSON.parse(raw);
                this.rules.forEach(rule => {
                    if (saved[rule.id] !== undefined) {
                        rule.enabled = Boolean(saved[rule.id]);
                    }
                });
            }
        } catch (e) {
            console.warn('[AutomationsModel] No se pudieron cargar preferencias de automatización:', e);
        }
    }

    _savePreferences() {
        try {
            const state = {};
            this.rules.forEach(r => state[r.id] = r.enabled);
            localStorage.setItem('domotix_automations_rules', JSON.stringify(state));
        } catch (e) {}
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
            try { cb(data); } catch (err) { console.error(`[AutomationsModel] Error en listener "${event}":`, err); }
        });
    }

    /**
     * Alterna el estado activo de una regla
     */
    toggleRule(ruleId) {
        const rule = this.rules.find(r => r.id === ruleId);
        if (!rule) return null;
        rule.enabled = !rule.enabled;
        this._savePreferences();
        this.emit('rules:changed', this.getRules());
        return rule;
    }

    setRuleEnabled(ruleId, enabled) {
        const rule = this.rules.find(r => r.id === ruleId);
        if (!rule) return null;
        rule.enabled = !!enabled;
        this._savePreferences();
        this.emit('rules:changed', this.getRules());
        return rule;
    }

    getRules() {
        return this.rules.map(r => ({ ...r }));
    }

    /**
     * Evalúa las reglas frente al estado actual de sensores y actuadores
     * @param {Object} sensors
     * @param {Object} actuators
     * @returns {Array} Lista de eventos y acciones disparadas
     */
    evaluate(sensors, actuators) {
        if (!sensors || !actuators) return [];
        const triggered = [];
        const now = Date.now();

        // 1. Regla: Escudo Anti-Lluvia
        const rRain = this.rules.find(r => r.id === 'rain_shield');
        if (rRain && rRain.enabled && sensors.isRaining) {
            const anyWindowOpen = Array.isArray(actuators.windows)
                ? actuators.windows.some(Boolean)
                : Boolean(actuators.windows);

            if (anyWindowOpen) {
                rRain.lastTriggered = new Date();
                triggered.push({
                    ruleId: 'rain_shield',
                    action: 'close_windows',
                    severity: 'warn',
                    title: 'Seguridad Anti-Lluvia',
                    message: 'Precipitación en curso: Se ordenó el cierre de las ventanas para evitar filtraciones.'
                });
            }
        }

        // 2. Regla: Reserva de Tinaco (< 20%)
        const rTank = this.rules.find(r => r.id === 'tank_reserve_alert');
        if (rTank && rTank.enabled && sensors.waterLevel < 20) {
            const lastAlert = this._cooldowns.get('tank_low') || 0;
            // Cooldown de 5 minutos entre alertas
            if (now - lastAlert > 300000) {
                this._cooldowns.set('tank_low', now);
                rTank.lastTriggered = new Date();
                triggered.push({
                    ruleId: 'tank_reserve_alert',
                    action: 'notify',
                    severity: 'warn',
                    title: 'Nivel Crítico de Tinaco',
                    message: `Nivel en reserva: ${sensors.waterLevel}% (${sensors.waterLiters} L). Se aconseja restringir consumo.`
                });
            }
        }

        // 3. Regla: Ventilación Térmica (> 27°C y sin lluvia)
        const rVent = this.rules.find(r => r.id === 'overheat_vent');
        if (rVent && rVent.enabled && sensors.temperature >= 27.5 && !sensors.isRaining && !actuators.windows) {
            const lastAlert = this._cooldowns.get('overheat') || 0;
            if (now - lastAlert > 300000) {
                this._cooldowns.set('overheat', now);
                rVent.lastTriggered = new Date();
                triggered.push({
                    ruleId: 'overheat_vent',
                    action: 'suggest_ventilation',
                    severity: 'info',
                    title: 'Sugerencia de Ventilación',
                    message: `Ambiente cálido (${sensors.temperature.toFixed(1)}°C). Clima exterior despejado ideal para ventilar.`
                });
            }
        }

        // 4. Regla: Auto-cierre de puerta
        const rDoor = this.rules.find(r => r.id === 'auto_door_lock');
        if (rDoor && rDoor.enabled) {
            if (actuators.door && !this._doorTimer) {
                this._doorTimer = setTimeout(() => {
                    this._doorTimer = null;
                    if (this.house && this.house.actuators.door) {
                        rDoor.lastTriggered = new Date();
                        this.emit('automation:triggered', {
                            ruleId: 'auto_door_lock',
                            action: 'close_door',
                            severity: 'info',
                            title: 'Auto-Cierre de Puerta',
                            message: 'Puerta asegurada automáticamente tras 35 segundos sin actividad.'
                        });
                    }
                }, 35000);
            } else if (!actuators.door && this._doorTimer) {
                clearTimeout(this._doorTimer);
                this._doorTimer = null;
            }
        }

        if (triggered.length > 0) {
            triggered.forEach(evt => this.emit('automation:triggered', evt));
            this.emit('rules:changed', this.getRules());
        }

        return triggered;
    }
}

if (typeof window !== 'undefined') {
    window.AutomationsModel = AutomationsModel;
}
