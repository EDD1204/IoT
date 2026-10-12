/**
 * AppController - Controlador Central de DomótiX UAEMex
 * Patrón MVC: Controlador (Controller)
 * Orquesta la interacción entre el Modelo (HouseModel, AutomationsModel, NetworkHealthModel),
 * los Servicios (MqttService, SoundService, SpeechService)
 * y las distintas Vistas de la aplicación (FloorplanView, ActuatorsView, TelemetryView,
 * ChartsView, AuditView, UIComponents, ReactWidgetsView).
 */
class AppController {
    constructor() {
        // 1. Instanciación de Modelos
        this.model = new HouseModel();
        this.logger = new AuditLogger(80);
        this.automations = new AutomationsModel(this.model);
        this.networkHealth = new NetworkHealthModel();

        // 2. Instanciación de Servicios de Infraestructura
        this.sound = new SoundService(this.model);
        this.mqtt = new MqttService(this.model, this.logger, this.networkHealth);
        this.speech = new SpeechService();

        // 3. Instanciación de Vistas Desacopladas
        this.floorplanView = new FloorplanView();
        this.actuatorsView = new ActuatorsView();
        this.telemetryView = new TelemetryView();
        this.chartsView = new ChartsView();
        this.auditView = new AuditView();
        this.ui = new UIComponents();
        this.reactWidgets = new ReactWidgetsView();

        // Control del ciclo demo
        this.demoTimer = null;

        // 4. Enlaces bidireccionales (Event Bindings)
        this._bindModelEvents();
        this._bindAutomationEvents();
        this._bindNetworkHealthEvents();
        this._bindSpeechEvents();
        this._bindLoggerEvents();
        this._bindViewEvents();
    }

    /**
     * Enlaza los eventos emitidos por el Modelo de la Casa con las Vistas
     */
    _bindModelEvents() {
        // Cambio en actuadores (Luces, Puerta, Ventanas)
        this.model.on('actuators:changed', (actuators) => {
            this.floorplanView.renderLights(actuators.lights);
            this.floorplanView.renderDoor(actuators.door);
            this.floorplanView.renderWindows(actuators.windows);
            this.actuatorsView.renderAll(actuators);

            // Evaluar reglas de automatización autónomas
            this.automations.evaluate(this.model.sensors, actuators);
        });

        // Actualización de telemetría de sensores en tiempo real
        this.model.on('telemetry:updated', ({ sensors, history }) => {
            this.telemetryView.render(sensors);
            this.floorplanView.renderTinaco(sensors.waterLevel);
            this.floorplanView.renderRain(sensors.isRaining);
            this.chartsView.render(history, sensors);

            // Sincronizar estado con la vista React de analítica de confort
            const climateMetrics = this.model.getClimateMetrics();
            this.reactWidgets.updateState({
                sensors,
                climateMetrics
            });

            // Evaluar reglas de automatización autónomas ante nuevas lecturas
            this.automations.evaluate(sensors, this.model.actuators);
        });

        // Bloqueo de seguridad por lluvia
        this.model.on('safety:blocked', (info) => {
            this.sound.alertWarning();
            this.ui.showToast(info.reason, 'warn', 4200);
            this.logger.log('warn', 'BLOQUEO', info.reason);
        });

        // Cierre automático al comenzar la lluvia
        this.model.on('safety:rainAutoClosed', (info) => {
            this.sound.alertWarning();
            this.ui.showToast(info.message, 'warn', 4200);
            this.logger.log('warn', 'SEGURIDAD', info.message);
            this.mqtt.publishWindows(false);
        });

        // Acciones en cola offline guardadas o sincronizadas
        this.model.on('offline:queued', (item) => {
            this.ui.showToast(`Sin conexión: Acción en cola (${item.label || item.topic})`, 'info', 2800);
            this.logger.log('warn', 'COLA', `Guardado para retransmisión: ${item.label}`);
        });

        this.model.on('offline:synced', ({ count }) => {
            this.sound.sceneChime();
            this.ui.showToast(`Conexión reestablecida: ${count} acción(es) sincronizada(s) con el ESP32.`, 'success', 3500);
            this.logger.log('in', 'COLA', `Retransmisión exitosa de ${count} comandos.`);
        });

        // Cambio de estado de red MQTT
        this.model.on('connection:changed', (conn) => {
            this.ui.renderConnection(conn);
        });

        // Toggle de sonido
        this.model.on('sound:toggled', (enabled) => {
            this.ui.renderAudioButton(enabled);
            this.ui.showToast(enabled ? 'Sonido táctil activado' : 'Sonido táctil silenciado', 'info', 2000);
        });

        // Toggle de simulación demo
        this.model.on('demo:toggled', (isDemo) => {
            this.ui.renderDemoButton(isDemo);
            if (isDemo) {
                this._startDemoLoop();
                this.ui.showToast('Modo Simulación Demo activado con telemetría virtual.', 'info', 3000);
            } else {
                this._stopDemoLoop();
                this.ui.showToast('Modo Demo finalizado. Retomando conexión en vivo con ESP32 físico.', 'info', 3000);
            }
        });
    }

    /**
     * Enlaza eventos de automatizaciones inteligentes
     */
    _bindAutomationEvents() {
        this.automations.on('rules:changed', (rules) => {
            this.reactWidgets.updateState({ rules });
        });

        this.automations.on('automation:triggered', (evt) => {
            this.logger.log('info', 'AUTO', `[${evt.title}] ${evt.message}`);

            if (evt.action === 'close_windows') {
                this.sound.alertWarning();
                this.mqtt.publishWindows(false);
                this.ui.showToast(evt.message, evt.severity || 'warn', 4000);
            } else if (evt.action === 'close_door') {
                this.sound.servoMove(false);
                this.mqtt.publishDoor(false);
                this.ui.showToast(evt.message, evt.severity || 'info', 4000);
            } else {
                this.ui.showToast(evt.message, evt.severity || 'info', 4000);
            }
        });
    }

    /**
     * Enlaza eventos de diagnóstico y salud de red
     */
    _bindNetworkHealthEvents() {
        this.networkHealth.on('health:updated', (stats) => {
            this.ui.renderPingLatency(stats.latencyMs, stats.qualityColor);
            this.reactWidgets.updateState({ networkStats: stats });
        });

        this.networkHealth.on('network:status', ({ isOnline, isLocal }) => {
            // Si operamos en Red Local DomótiX y hay enlace local, silenciar advertencias de internet
            if (this.model.isLocalMode && (isLocal || this.mqtt.isLocalApConnected)) {
                this.ui.renderOfflineBanner(false);
                return;
            }

            this.ui.renderOfflineBanner(!isOnline);
            if (!isOnline) {
                this.ui.showToast('Sin conexión a red local ni internet.', 'warn', 4000);
            } else {
                this.ui.showToast('Conexión reestablecida.', 'success', 3000);
            }
        });

        this.networkHealth.on('queue:changed', ({ queue, count }) => {
            const stats = this.networkHealth.getStats();
            this.reactWidgets.updateState({ networkStats: stats });
        });
    }

    /**
     * Enlaza el asistente de voz por lenguaje natural
     */
    _bindSpeechEvents() {
        this.speech.on('listening:changed', ({ isListening }) => {
            this.ui.renderVoiceState(isListening);
            if (isListening) {
                this.sound.click(750, 0.04);
                this.ui.showToast('🎙️ Escuchando comando de voz en español...', 'info', 3000);
            }
        });

        this.speech.on('command', ({ transcript, action }) => {
            this.logger.log('in', 'VOZ', `Comando detectado: "${transcript}"`);
            this._executeVoiceCommand(action, transcript);
        });

        this.speech.on('error', ({ error }) => {
            if (error === 'network') {
                this.ui.showToast('Reconocimiento por voz requiere paquete de voz local o conexión. Controles táctiles y automatizaciones 100% operativos.', 'info', 4000);
            } else if (error !== 'no-speech') {
                this.ui.showToast(`Voz: ${error}`, 'warn', 2500);
            }
        });
    }

    _executeVoiceCommand(action, transcript) {
        if (!action || action.type === 'unknown') {
            this.ui.showToast(`Comando no reconocido: "${transcript}"`, 'info', 3000);
            return;
        }

        this.sound.sceneChime();

        if (action.type === 'light') {
            const targetState = action.state === 'toggle' ? !this.model.actuators.lights[action.room - 1] : action.state;
            this.handleToggleLight(action.room, targetState);
            this.ui.showToast(`Luz de Cuarto ${action.room} -> ${targetState ? 'Encendida' : 'Apagada'}`, 'success', 2500);
        } else if (action.type === 'door') {
            const targetState = action.toggle ? !this.model.actuators.door : action.open;
            if (targetState !== this.model.actuators.door) {
                this.handleToggleDoor();
            }
            this.ui.showToast(`Puerta principal -> ${targetState ? 'Abierta' : 'Cerrada'}`, 'success', 2500);
        } else if (action.type === 'windows') {
            const currentAll = this.model.actuators.windowsAll !== undefined ? this.model.actuators.windowsAll : false;
            const targetState = action.toggle ? !currentAll : action.open;
            if (targetState !== currentAll) {
                this.handleToggleWindows(null);
            }
            this.ui.showToast(`Ventanas -> ${targetState ? 'Abiertas' : 'Cerradas'}`, 'success', 2500);
        } else if (action.type === 'scene') {
            this.handleApplyScene(action.sceneId);
        }
    }

    /**
     * Enlaza el registro de auditoría a la consola de visualización
     */
    _bindLoggerEvents() {
        this.logger.onLog((entry) => {
            this.auditView.addEntry(entry);
        });
    }

    /**
     * Enlaza las interacciones del usuario en las Vistas hacia el Modelo y la Red
     */
    _bindViewEvents() {
        // --- Interacción en el Plano Arquitectónico 2D ---
        this.floorplanView.bindEvents({
            onRoomClick: (roomIndex) => this.handleToggleLight(roomIndex),
            onDoorClick: () => this.handleToggleDoor(),
            onWindowsClick: (windowIndex) => this.handleToggleWindows(windowIndex),
            onTinacoClick: () => this.handleTabSwitch('analytics')
        });

        // --- Interacción en el Mando de Actuadores ---
        this.actuatorsView.bindEvents({
            onLightToggle: (roomIndex) => this.handleToggleLight(roomIndex),
            onDoorToggle: () => this.handleToggleDoor(),
            onWindowsToggle: (windowIndex) => this.handleToggleWindows(windowIndex),
            onSceneClick: (sceneId) => this.handleApplyScene(sceneId)
        });

        // --- Interacción en la Consola de Auditoría ---
        this.auditView.bindExport(() => {
            this.logger.exportAsJSON();
            this.ui.showToast('Bitácora de auditoría exportada como JSON.', 'success', 2500);
        });

        // --- Interacción en los Widgets React ---
        this.reactWidgets.bindEvents({
            onToggleRule: (ruleId) => {
                const rule = this.automations.toggleRule(ruleId);
                if (rule) {
                    this.sound.click(600, 0.03);
                    this.ui.showToast(`Regla "${rule.name}" ${rule.enabled ? 'activada' : 'desactivada'}`, 'info', 2000);
                    this.logger.log('info', 'AUTO', `Regla ${ruleId} -> ${rule.enabled ? 'ON' : 'OFF'}`);
                }
            },
            onSelectBroker: (brokerUrl) => {
                this.model.updateBrokerConfig(brokerUrl, this.model.topicPrefix);
                this.ui.showToast(`Cambiando a broker: ${brokerUrl}`, 'info', 3000);
            },
            onFlushQueue: () => {
                this.mqtt._flushOfflineQueue();
            }
        });

        // --- Componentes Globales del Sistema (UI) ---
        this.ui.bindEvents({
            onTabSwitch: (tabId) => this.handleTabSwitch(tabId),
            onAudioToggle: () => {
                const newState = !this.model.soundEnabled;
                this.model.setSoundEnabled(newState);
                if (newState) this.sound.click(650, 0.05);
            },
            onDemoToggle: () => {
                this.model.setDemoMode(!this.model.demoMode);
            },
            onVoiceToggle: () => {
                if (!this.speech.isSupported) {
                    this.ui.showToast('El navegador no soporta reconocimiento de voz nativo.', 'warn', 3000);
                    return;
                }
                this.speech.toggle();
            },
            onConfigSave: (url, prefix) => {
                this.model.updateBrokerConfig(url, prefix);
                const isLocal = !url.startsWith('ws://') && !url.startsWith('wss://');
                const msg = isLocal ? `Configurado en Red Local DomótiX (${url})` : `Conectando a broker: ${url}`;
                this.ui.showToast(msg, 'info', 3000);
            }
        });
    }

    // ==========================================
    // MANEJADORES DE ACCIONES DE USUARIO
    // ==========================================
    handleToggleLight(roomIndex, forcedState = null) {
        let result;
        if (forcedState !== null) {
            result = this.model.setLight(roomIndex, forcedState);
        } else {
            result = this.model.toggleLight(roomIndex);
        }

        if (result) {
            this.sound.lightSwitch(result.state);
            this.mqtt.publishLight(roomIndex, result.state);
        }
    }

    handleToggleDoor() {
        const result = this.model.toggleDoor();
        if (result) {
            this.sound.servoMove(result.isOpen);
            this.mqtt.publishDoor(result.isOpen);
        }
    }

    handleToggleWindows(windowIndex = null) {
        const result = this.model.toggleWindows(windowIndex);
        if (result && !result.blocked) {
            this.sound.servoMove(result.isOpen);
            this.mqtt.publishWindows(result.isOpen, windowIndex);
        }
    }

    handleApplyScene(sceneId) {
        const commands = this.model.applyScene(sceneId);
        this.sound.sceneChime();

        // Enviar ráfaga de comandos al ESP32
        commands.forEach(cmd => {
            if (cmd.type === 'light') {
                this.mqtt.publishLight(cmd.room, cmd.state);
            } else if (cmd.type === 'door') {
                this.mqtt.publishDoor(cmd.state);
            } else if (cmd.type === 'windows') {
                this.mqtt.publishWindows(cmd.state, cmd.windowIndex || null);
            }
        });

        const sceneLabels = {
            todas_on: 'Iluminación Total encendida',
            todas_off: 'Todas las luces apagadas',
            noche: 'Escena Noche: Perímetro asegurado',
            salir: 'Escena Salir: Todo apagado y asegurado'
        };
        this.ui.showToast(sceneLabels[sceneId] || `Escena ${sceneId} aplicada`, 'success', 2500);
        this.logger.log('out', 'ESCENA', `Ejecutada escena preconfigurada: ${sceneId}`);
    }

    handleTabSwitch(tabId) {
        this.sound.click(520, 0.03);
        this.ui.switchTab(tabId);

        // Si se cambia a la pestaña de analítica, redibujar curvas Bézier
        if (tabId === 'analytics') {
            setTimeout(() => {
                this.chartsView.redraw();
            }, 60);
        }
    }

    // ==========================================
    // SIMULACIÓN DEMO
    // ==========================================
    _startDemoLoop() {
        if (this.demoTimer) clearInterval(this.demoTimer);
        this.model.generateDemoStep();
        this.demoTimer = setInterval(() => {
            this.model.generateDemoStep();
        }, 2200);
    }

    _stopDemoLoop() {
        if (this.demoTimer) {
            clearInterval(this.demoTimer);
            this.demoTimer = null;
        }
        if (this.mqtt.isConnected) {
            this.model.setConnectionStatus('online', 'ESP32 En Vivo');
        } else {
            this.model.setConnectionStatus('offline', 'Desconectado');
        }
    }

    // ==========================================
    // INICIALIZACIÓN
    // ==========================================
    init() {
        this.logger.log('info', 'SYS', 'Inicializando DomótiX UAEMex (Arquitectura MVC + React Widgets)...');

        // 1. Renderizar estado inicial en vistas DOM
        this.floorplanView.renderLights(this.model.actuators.lights);
        this.floorplanView.renderDoor(this.model.actuators.door);
        this.floorplanView.renderWindows(this.model.actuators.windows);
        this.floorplanView.renderTinaco(this.model.sensors.waterLevel);
        this.floorplanView.renderRain(this.model.sensors.isRaining);

        this.actuatorsView.renderAll(this.model.actuators);
        this.telemetryView.render(this.model.sensors);
        this.chartsView.render(this.model.history, this.model.sensors);

        this.ui.renderConnection(this.model.connection);
        this.ui.renderAudioButton(this.model.soundEnabled);
        this.ui.renderDemoButton(this.model.demoMode);
        this.ui.renderOfflineBanner(!this.networkHealth.isOnline);

        // 2. Inicializar estado de widgets reactivos en React
        this.reactWidgets.updateState({
            sensors: { ...this.model.sensors },
            climateMetrics: this.model.getClimateMetrics(),
            rules: this.automations.getRules(),
            networkStats: this.networkHealth.getStats(),
            presetBrokers: this.networkHealth.presetBrokers,
            activeBrokerUrl: this.model.brokerUrl
        });

        // 3. Conectar cliente MQTT
        this.mqtt.connect();

        // 4. Registrar Service Worker para PWA (Garantizar registro offline e instalación)
        if ('serviceWorker' in navigator) {
            const registerSW = () => {
                navigator.serviceWorker.register('./sw.js', { scope: './' })
                    .then((reg) => {
                        console.log('[PWA] Service Worker registrado exitosamente con scope:', reg.scope);
                    })
                    .catch((err) => {
                        console.warn('[PWA] Fallo en registro de Service Worker:', err);
                    });
            };

            if (document.readyState === 'complete' || document.readyState === 'interactive') {
                registerSW();
            } else {
                window.addEventListener('load', registerSW);
                setTimeout(registerSW, 1200);
            }
        }

        this.logger.log('info', 'SYS', 'Sistema preparado y operativo en todas las vistas.');
    }
}

if (typeof window !== 'undefined') {
    window.AppController = AppController;
}
