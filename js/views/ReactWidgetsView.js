/**
 * ReactWidgetsView - Vista de Componentes Reactivos basada en React 18 & HTM
 * Patrón MVC: Componente de Vista (View)
 * Renderiza widgets declarativos de alta fidelidad:
 * - Tarjeta de Confort Ambiental y Autonomía
 * - Hub de Automatizaciones y Seguridad Autónoma
 * - Diagnóstico de Red, Latencia RTT y Cola Offline
 * - Asistente de Voz Manos Libres
 */
class ReactWidgetsView {
    constructor() {
        this.containerComfort = document.getElementById('react-comfort-mount');
        this.containerAutomations = document.getElementById('react-automations-mount');
        this.containerNetwork = document.getElementById('react-network-mount');

        this.handlers = {
            onToggleRule: null,
            onSelectBroker: null,
            onFlushQueue: null,
            onVoiceToggle: null
        };

        this.state = {
            sensors: { temperature: 22.0, humidity: 50.0, waterLevel: 50, waterLiters: 550, isRaining: false },
            climateMetrics: { heatIndex: 22.0, dewPoint: 11.1, comfortLevel: 'Óptimo', comfortColor: '#10b981', autonomyDays: 2.5, isMoldRisk: false },
            rules: [],
            networkStats: { latencyMs: 40, packetsTx: 0, packetsRx: 0, uptimeStr: '--', quality: 'Excelente', qualityColor: '#10b981', isOnline: true, queueLength: 0 },
            presetBrokers: [],
            activeBrokerUrl: '',
            speechState: { isListening: false, lastTranscript: '', isSupported: true }
        };

        this.roots = {
            comfort: null,
            automations: null,
            network: null
        };

        this._initReactRoots();
    }

    _initReactRoots() {
        if (typeof ReactDOM === 'undefined' || typeof React === 'undefined' || typeof htm === 'undefined') {
            console.warn('[ReactWidgetsView] Librerías React / HTM no disponibles. Saltando renderizado reactivo.');
            return;
        }

        this.html = htm.bind(React.createElement);

        if (this.containerComfort && ReactDOM.createRoot) {
            this.roots.comfort = ReactDOM.createRoot(this.containerComfort);
        }
        if (this.containerAutomations && ReactDOM.createRoot) {
            this.roots.automations = ReactDOM.createRoot(this.containerAutomations);
        }
        if (this.containerNetwork && ReactDOM.createRoot) {
            this.roots.network = ReactDOM.createRoot(this.containerNetwork);
        }
    }

    bindEvents(handlers = {}) {
        this.handlers = { ...this.handlers, ...handlers };
    }

    updateState(partial) {
        this.state = { ...this.state, ...partial };
        this.render();
    }

    render() {
        if (!this.html) return;
        const html = this.html;

        // 1. Renderizar Widget de Confort Ambiental
        if (this.roots.comfort) {
            this.roots.comfort.render(this._renderComfortWidget(html));
        }

        // 2. Renderizar Widget de Automatizaciones Inteligentes
        if (this.roots.automations) {
            this.roots.automations.render(this._renderAutomationsWidget(html));
        }

        // 3. Renderizar Diagnóstico de Red y Disponibilidad
        if (this.roots.network) {
            this.roots.network.render(this._renderNetworkWidget(html));
        }
    }

    _renderComfortWidget(html) {
        const { sensors, climateMetrics } = this.state;
        const { heatIndex, dewPoint, comfortLevel, comfortColor, autonomyDays, isMoldRisk } = climateMetrics;

        return html`
            <div className="card-surface comfort-analytics-card">
                <div className="card-title-row">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        Analítica de Confort y Recursos
                    </h2>
                    <span className="subtle-badge" style=${{ color: comfortColor, borderColor: `${comfortColor}40`, background: `${comfortColor}15` }}>
                        ${comfortLevel}
                    </span>
                </div>

                <div className="comfort-grid">
                    <div className="comfort-metric-box">
                        <span className="comfort-label">Sensación Térmica</span>
                        <div className="comfort-val">${heatIndex} °C</div>
                        <span className="comfort-sub">Índice combinado de calor</span>
                    </div>

                    <div className="comfort-metric-box">
                        <span className="comfort-label">Punto de Rocío</span>
                        <div className="comfort-val">${dewPoint} °C</div>
                        <span className="comfort-sub">
                            ${isMoldRisk ? '⚠️ Riesgo de condensación' : 'Normal / Seco'}
                        </span>
                    </div>

                    <div className="comfort-metric-box">
                        <span className="comfort-label">Autonomía Tinaco</span>
                        <div className="comfort-val">${autonomyDays} días</div>
                        <span className="comfort-sub">Consumo promedio ~220L/d</span>
                    </div>
                </div>

                <div className="comfort-autonomy-bar-wrap">
                    <div className="comfort-autonomy-header">
                        <span>Reserva Hídrica Domiciliaria</span>
                        <strong>${sensors.waterLiters || 0} de 1100 Litros</strong>
                    </div>
                    <div className="comfort-progress-track">
                        <div
                            className="comfort-progress-fill"
                            style=${{
                                width: `${Math.min(100, Math.max(0, sensors.waterLevel || 0))}%`,
                                backgroundColor: (sensors.waterLevel < 20) ? 'var(--status-rose)' : 'var(--accent-cool-soft)'
                            }}
                        />
                    </div>
                </div>
            </div>
        `;
    }

    _renderAutomationsWidget(html) {
        const { rules } = this.state;

        return html`
            <div className="card-surface automations-card">
                <div className="card-title-row">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </svg>
                        Reglas y Automatizaciones Inteligentes
                    </h2>
                    <span className="subtle-badge">Protección Autónoma</span>
                </div>

                <p className="automations-intro">
                    Lógica domótica ejecutada en tiempo real. Actúa de forma preventiva ante factores ambientales y de seguridad.
                </p>

                <div className="rules-list">
                    ${rules.map(rule => html`
                        <div key=${rule.id} className=${`rule-item-card ${rule.enabled ? 'active' : 'disabled'}`}>
                            <div className="rule-icon-box">${rule.icon}</div>
                            <div className="rule-content">
                                <div className="rule-header">
                                    <strong className="rule-name">${rule.name}</strong>
                                    <span className="rule-badge-cat">${rule.category}</span>
                                </div>
                                <p className="rule-desc">${rule.desc}</p>
                            </div>
                            <div className="rule-switch-wrapper">
                                <button
                                    className=${`tactile-switch-btn ${rule.enabled ? 'on' : 'off'}`}
                                    onClick=${() => {
                                        if (typeof this.handlers.onToggleRule === 'function') {
                                            this.handlers.onToggleRule(rule.id);
                                        }
                                    }}
                                    aria-label=${`Alternar regla ${rule.name}`}
                                    role="switch"
                                    aria-checked=${rule.enabled}
                                >
                                    <span className="knob" />
                                </button>
                            </div>
                        </div>
                    `)}
                </div>
            </div>
        `;
    }

    _renderNetworkWidget(html) {
        const { networkStats, presetBrokers, activeBrokerUrl } = this.state;
        const { latencyMs, packetsTx, packetsRx, uptimeStr, quality, qualityColor, isOnline, queueLength } = networkStats;

        return html`
            <div className="card-surface network-diagnostics-card">
                <div className="card-title-row">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                            <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                            <line x1="12" y1="20" x2="12.01" y2="20"/>
                        </svg>
                        Disponibilidad de Red y Telemetría WSS
                    </h2>
                    <div className="net-status-pill" style=${{ color: qualityColor, borderColor: `${qualityColor}40` }}>
                        <span className="pulse-dot" style=${{ backgroundColor: qualityColor }} />
                        <span>${isOnline ? quality : 'Sin Internet'}</span>
                    </div>
                </div>

                <div className="net-stats-row">
                    <div className="net-stat-box">
                        <span className="net-stat-label">Latencia RTT</span>
                        <div className="net-stat-val" style=${{ color: qualityColor }}>
                            ${latencyMs !== null ? `${latencyMs} ms` : '--'}
                        </div>
                        <span className="net-stat-sub">Ping WebSockets</span>
                    </div>

                    <div className="net-stat-box">
                        <span className="net-stat-label">Paquetes TX / RX</span>
                        <div className="net-stat-val">${packetsTx} / ${packetsRx}</div>
                        <span className="net-stat-sub">Tráfico en sesión</span>
                    </div>

                    <div className="net-stat-box">
                        <span className="net-stat-label">Tiempo Activo</span>
                        <div className="net-stat-val">${uptimeStr}</div>
                        <span className="net-stat-sub">Uptime de conexión</span>
                    </div>
                </div>

                ${queueLength > 0 ? html`
                    <div className="offline-queue-alert">
                        <div className="queue-left">
                            <strong>⚠️ Modo Sin Conexión</strong>
                            <span>${queueLength} acción(es) domótica(s) en cola esperando enlace MQTT.</span>
                        </div>
                        <button
                            className="btn-sync-queue"
                            onClick=${() => {
                                if (typeof this.handlers.onFlushQueue === 'function') {
                                    this.handlers.onFlushQueue();
                                }
                            }}
                        >
                            Sincronizar Ahora
                        </button>
                    </div>
                ` : null}

                <div className="broker-selector-section">
                    <label className="broker-sel-label" htmlFor="react-broker-select">
                        Modo de Conexión y Enlace IoT:
                    </label>
                    <div className="broker-sel-wrap">
                        <select
                            id="react-broker-select"
                            className="broker-dropdown"
                            value=${activeBrokerUrl}
                            onChange=${(e) => {
                                if (typeof this.handlers.onSelectBroker === 'function') {
                                    this.handlers.onSelectBroker(e.target.value);
                                }
                            }}
                        >
                            ${presetBrokers.map(b => html`
                                <option key=${b.id} value=${b.url}>
                                    ${b.name} (${b.region})
                                </option>
                            `)}
                        </select>
                    </div>
                </div>
            </div>
        `;
    }
}

if (typeof window !== 'undefined') {
    window.ReactWidgetsView = ReactWidgetsView;
}
