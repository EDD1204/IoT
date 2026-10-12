/**
 * UIComponents - Componentes de Interfaz Global: Header, Tabs, Modales, PWA, Red y Toasts
 * Patrón MVC: Componente de Vista (View)
 */
class UIComponents {
    constructor() {
        // Indicador de conexión y latencia
        this.connDot = document.getElementById('conn-dot');
        this.connText = document.getElementById('conn-text');
        this.connPingPill = document.getElementById('conn-ping-pill');

        // Banner offline
        this.offlineBanner = document.getElementById('offline-banner');

        // Botones de acción del header
        this.btnAudio = document.getElementById('btn-audio');
        this.btnDemo = document.getElementById('btn-demo');
        this.btnVoice = document.getElementById('btn-voice');
        this.btnInstallPwa = document.getElementById('btn-install-pwa');

        // Modal de Ajustes
        this.settingsModal = document.getElementById('settings-modal');
        this.btnOpenSettings = document.getElementById('btn-open-settings');
        this.btnCloseSettings = document.getElementById('btn-close-settings');
        this.btnCancelSettings = document.getElementById('btn-cancel-settings');
        this.btnSaveSettings = document.getElementById('btn-save-settings');
        this.inputBrokerUrl = document.getElementById('cfg-broker-url');
        this.inputTopicPrefix = document.getElementById('cfg-topic-prefix');

        // Modal Guía de Instalación
        this.installGuideModal = document.getElementById('install-guide-modal');
        this.btnCloseInstallGuide = document.getElementById('btn-close-install-guide');
        this.btnDoneInstallGuide = document.getElementById('btn-done-install-guide');

        // Presets de Broker en Modal
        this.brokerPresetButtons = document.querySelectorAll('.broker-preset-btn');

        // Pestañas (Desktop y Móvil)
        this.segmentButtons = document.querySelectorAll('.segment-btn');
        this.mobileTabButtons = document.querySelectorAll('.mob-tab-item');
        this.tabPanels = document.querySelectorAll('.tab-panel');

        // Contenedor de Toasts
        this._initToastContainer();

        // Prompt diferido de PWA
        this.deferredPrompt = null;

        // Handlers
        this._handlers = {
            onTabSwitch: null,
            onAudioToggle: null,
            onDemoToggle: null,
            onVoiceToggle: null,
            onConfigSave: null,
            onPwaInstall: null
        };

        this._setupListeners();
    }

    _initToastContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        this.toastContainer = container;
    }

    _setupListeners() {
        // Pestañas Desktop
        this.segmentButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab && typeof this._handlers.onTabSwitch === 'function') {
                    this._handlers.onTabSwitch(tab);
                }
            });
        });

        // Pestañas Móvil
        this.mobileTabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                if (tab && typeof this._handlers.onTabSwitch === 'function') {
                    this._handlers.onTabSwitch(tab);
                }
            });
        });

        // Toggle Audio
        if (this.btnAudio) {
            this.btnAudio.addEventListener('click', () => {
                if (typeof this._handlers.onAudioToggle === 'function') {
                    this._handlers.onAudioToggle();
                }
            });
        }

        // Toggle Demo
        if (this.btnDemo) {
            this.btnDemo.addEventListener('click', () => {
                if (typeof this._handlers.onDemoToggle === 'function') {
                    this._handlers.onDemoToggle();
                }
            });
        }

        // Toggle Asistente de Voz
        if (this.btnVoice) {
            this.btnVoice.addEventListener('click', () => {
                if (typeof this._handlers.onVoiceToggle === 'function') {
                    this._handlers.onVoiceToggle();
                }
            });
        }

        // Presets de broker en modal
        this.brokerPresetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const url = btn.dataset.url;
                if (url && this.inputBrokerUrl) {
                    this.inputBrokerUrl.value = url;
                    this.brokerPresetButtons.forEach(b => b.classList.remove('selected'));
                    btn.classList.add('selected');
                }
            });
        });

        // Abrir Ajustes
        if (this.btnOpenSettings) {
            this.btnOpenSettings.addEventListener('click', () => this.openSettingsModal());
        }

        // Cerrar Ajustes
        if (this.btnCloseSettings) {
            this.btnCloseSettings.addEventListener('click', () => this.closeSettingsModal());
        }
        if (this.btnCancelSettings) {
            this.btnCancelSettings.addEventListener('click', () => this.closeSettingsModal());
        }

        // Guardar Ajustes
        if (this.btnSaveSettings) {
            this.btnSaveSettings.addEventListener('click', () => {
                const url = (this.inputBrokerUrl ? this.inputBrokerUrl.value : '').trim();
                const prefix = (this.inputTopicPrefix ? this.inputTopicPrefix.value : '').trim();
                if (typeof this._handlers.onConfigSave === 'function') {
                    this._handlers.onConfigSave(url, prefix);
                }
                this.closeSettingsModal();
            });
        }

        // Cerrar modal con tecla Escape o clic fuera
        if (this.settingsModal) {
            this.settingsModal.addEventListener('click', (e) => {
                if (e.target === this.settingsModal) this.closeSettingsModal();
            });
        }
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.settingsModal && this.settingsModal.classList.contains('active')) {
                    this.closeSettingsModal();
                }
                if (this.installGuideModal && this.installGuideModal.classList.contains('active')) {
                    this.closeInstallGuideModal();
                }
            }
        });

        // Detectar si ya corre instalada en pantalla completa
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                             window.navigator.standalone === true ||
                             (typeof document !== 'undefined' && document.referrer && document.referrer.includes('android-app://'));

        if (this.btnInstallPwa) {
            this.btnInstallPwa.style.display = isStandalone ? 'none' : 'inline-flex';
        }

        // PWA Install prompt listener
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            if (this.btnInstallPwa) {
                this.btnInstallPwa.style.display = 'inline-flex';
            }
        });

        if (this.btnInstallPwa) {
            this.btnInstallPwa.addEventListener('click', () => {
                if (this.deferredPrompt) {
                    this.deferredPrompt.prompt();
                    this.deferredPrompt.userChoice.then((choice) => {
                        if (choice && choice.outcome === 'accepted') {
                            this.showToast('¡Instalando DomótiX en tu dispositivo!', 'success', 3000);
                            this.btnInstallPwa.style.display = 'none';
                        }
                        this.deferredPrompt = null;
                    });
                } else {
                    // Abrir guía paso a paso con instrucciones precisas para celular
                    this.openInstallGuideModal();
                }
            });
        }

        // Listeners para modal de guía de instalación
        if (this.btnCloseInstallGuide) {
            this.btnCloseInstallGuide.addEventListener('click', () => this.closeInstallGuideModal());
        }
        if (this.btnDoneInstallGuide) {
            this.btnDoneInstallGuide.addEventListener('click', () => this.closeInstallGuideModal());
        }
        if (this.installGuideModal) {
            this.installGuideModal.addEventListener('click', (e) => {
                if (e.target === this.installGuideModal) this.closeInstallGuideModal();
            });
        }
    }

    bindEvents(handlers = {}) {
        this._handlers = { ...this._handlers, ...handlers };
    }

    /**
     * Cambia de panel visual y sincroniza estados activos
     */
    switchTab(targetTabId) {
        // Desktop segmented control
        this.segmentButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === targetTabId);
        });

        // Mobile tab bar
        this.mobileTabButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === targetTabId);
        });

        // Paneles
        this.tabPanels.forEach(panel => {
            panel.classList.toggle('active', panel.id === `panel-${targetTabId}`);
        });
    }

    /**
     * Actualiza el indicador de conexión
     */
    renderConnection(connection) {
        if (!connection) return;

        if (this.connDot) {
            this.connDot.className = 'status-dot';
            if (connection.status === 'online' || connection.status === 'demo') {
                this.connDot.classList.add('online');
            } else if (connection.status === 'offline' || connection.status === 'error') {
                this.connDot.classList.add('offline');
            }
        }

        if (this.connText) {
            this.connText.textContent = connection.text;
        }
    }

    renderPingLatency(ms, qualityColor = '#10b981') {
        if (!this.connPingPill) return;
        if (ms !== null && ms !== undefined) {
            this.connPingPill.style.display = 'inline-flex';
            this.connPingPill.textContent = `${ms}ms`;
            this.connPingPill.style.color = qualityColor;
            this.connPingPill.style.borderColor = `${qualityColor}40`;
        } else {
            this.connPingPill.style.display = 'none';
        }
    }

    renderOfflineBanner(isOffline) {
        if (this.offlineBanner) {
            this.offlineBanner.classList.toggle('active', Boolean(isOffline));
        }
    }

    renderVoiceState(isListening) {
        if (this.btnVoice) {
            this.btnVoice.classList.toggle('listening', Boolean(isListening));
            this.btnVoice.title = isListening ? 'Escuchando comando de voz...' : 'Activar control por voz';
        }
    }

    renderAudioButton(isEnabled) {
        if (this.btnAudio) {
            this.btnAudio.classList.toggle('active', Boolean(isEnabled));
            this.btnAudio.title = isEnabled ? 'Sonido táctil activado' : 'Sonido táctil silenciado';
        }
    }

    renderDemoButton(isDemo) {
        if (this.btnDemo) {
            this.btnDemo.classList.toggle('active', Boolean(isDemo));
            this.btnDemo.title = isDemo ? 'Modo Demo Activo (Pausar)' : 'Iniciar Modo Simulación Demo';
        }
    }

    openSettingsModal(currentUrl, currentPrefix) {
        const url = currentUrl || (window.app ? window.app.model.brokerUrl : localStorage.getItem('domotix_broker_url')) || 'http://192.168.4.1';
        const prefix = currentPrefix || (window.app ? window.app.model.topicPrefix : localStorage.getItem('domotix_topic_prefix')) || 'uaemex_casa';
        if (this.inputBrokerUrl) this.inputBrokerUrl.value = url;
        if (this.inputTopicPrefix) this.inputTopicPrefix.value = prefix;
        this.brokerPresetButtons.forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.url === url);
        });
        if (this.settingsModal) {
            this.settingsModal.classList.add('active');
            if (this.inputBrokerUrl) this.inputBrokerUrl.focus();
        }
    }

    closeSettingsModal() {
        if (this.settingsModal) {
            this.settingsModal.classList.remove('active');
        }
    }

    openInstallGuideModal() {
        if (this.installGuideModal) {
            this.installGuideModal.classList.add('active');
        }
    }

    closeInstallGuideModal() {
        if (this.installGuideModal) {
            this.installGuideModal.classList.remove('active');
        }
    }

    /**
     * Muestra una notificación toast flotante y elegante
     */
    showToast(message, type = 'info', duration = 3400) {
        if (!this.toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `app-toast toast-${type}`;

        const iconSvg = type === 'warn'
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
            : type === 'success'
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

        toast.innerHTML = `
            <div class="toast-icon">${iconSvg}</div>
            <div class="toast-body">${message}</div>
            <button class="toast-close" aria-label="Cerrar">&times;</button>
        `;

        const closeBtn = toast.querySelector('.toast-close');
        const dismiss = () => {
            toast.classList.add('hiding');
            setTimeout(() => {
                if (toast.parentElement) toast.parentElement.removeChild(toast);
            }, 250);
        };

        if (closeBtn) closeBtn.addEventListener('click', dismiss);
        setTimeout(dismiss, duration);

        this.toastContainer.appendChild(toast);
    }
}

if (typeof window !== 'undefined') {
    window.UIComponents = UIComponents;
}
