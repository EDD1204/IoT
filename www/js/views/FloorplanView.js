/**
 * FloorplanView - Vista del Plano Arquitectónico 2D Interactivo
 * Patrón MVC: Componente de Vista (View)
 */
class FloorplanView {
    constructor() {
        // Elementos DOM del Plano
        this.svg = document.getElementById('floorplan-svg');
        this.rainLayer = document.getElementById('rain-layer');
        this.skyLabel = document.getElementById('sky-label');
        this.skyDot = document.getElementById('sky-dot');

        // Caché de elementos de habitaciones
        this.rooms = [];
        for (let i = 1; i <= 4; i++) {
            this.rooms.push({
                index: i,
                group: document.getElementById(`svg-room-${i}`),
                rect: document.getElementById(`svg-rect-${i}`),
                lightPool: document.getElementById(`svg-lightpool-${i}`),
                bulb: document.getElementById(`svg-bulb-${i}`)
            });
        }

        // Elementos de actuadores
        this.doorBar = document.getElementById('svg-door-bar');
        this.doorTxt = document.getElementById('svg-door-status-text');
        this.doorGroup = document.getElementById('svg-door');

        this.windowSlats = [
            document.getElementById('svg-v1-slat'),
            document.getElementById('svg-v2-slat'),
            document.getElementById('svg-v3-slat')
        ];
        this.windowGroups = [
            document.getElementById('svg-v1'),
            document.getElementById('svg-v2'),
            document.getElementById('svg-v3')
        ];

        this.tinacoTxt = document.getElementById('svg-tinaco-txt');
        this.tinacoHub = document.getElementById('svg-tinaco-hub');

        // Callbacks de interacción
        this._handlers = {
            onRoomClick: null,
            onDoorClick: null,
            onWindowsClick: null,
            onTinacoClick: null
        };

        this._setupListeners();
    }

    _setupListeners() {
        // Clic en habitaciones
        this.rooms.forEach(room => {
            if (room.group) {
                room.group.addEventListener('click', () => {
                    if (typeof this._handlers.onRoomClick === 'function') {
                        this._handlers.onRoomClick(room.index);
                    }
                });
            }
        });

        // Clic en puerta
        if (this.doorGroup) {
            this.doorGroup.addEventListener('click', () => {
                if (typeof this._handlers.onDoorClick === 'function') {
                    this._handlers.onDoorClick();
                }
            });
        }

        // Clic en ventanas individuales (V1, V2, V3)
        this.windowGroups.forEach((wGroup, idx) => {
            if (wGroup) {
                wGroup.addEventListener('click', () => {
                    if (typeof this._handlers.onWindowsClick === 'function') {
                        this._handlers.onWindowsClick(idx + 1);
                    }
                });
            }
        });

        // Clic en tinaco
        if (this.tinacoHub) {
            this.tinacoHub.addEventListener('click', () => {
                if (typeof this._handlers.onTinacoClick === 'function') {
                    this._handlers.onTinacoClick();
                }
            });
        }
    }

    bindEvents(handlers = {}) {
        this._handlers = { ...this._handlers, ...handlers };
    }

    /**
     * Renderiza el estado de las luces en el plano
     */
    renderLights(lightsState) {
        if (!Array.isArray(lightsState)) return;

        this.rooms.forEach((room, idx) => {
            const isOn = Boolean(lightsState[idx]);
            const isWarm = (room.index === 1 || room.index === 4);

            if (room.lightPool) {
                room.lightPool.style.opacity = isOn ? '1' : '0';
            }

            if (room.bulb) {
                if (isOn) {
                    room.bulb.setAttribute('fill', isWarm ? '#d97706' : '#38bdf8');
                    room.bulb.setAttribute('stroke', '#ffffff');
                } else {
                    room.bulb.setAttribute('fill', '#262d42');
                    room.bulb.setAttribute('stroke', '#3b445f');
                }
            }

            if (room.rect) {
                if (isOn) {
                    room.rect.setAttribute('stroke', isWarm ? 'rgba(217, 119, 6, 0.45)' : 'rgba(2, 132, 199, 0.45)');
                } else {
                    room.rect.setAttribute('stroke', '#22283b');
                }
            }
        });
    }

    /**
     * Renderiza la apertura de la puerta (0° o 90°) con animación angular
     */
    renderDoor(isOpen) {
        if (this.doorBar) {
            if (isOpen) {
                this.doorBar.setAttribute('x1', '280');
                this.doorBar.setAttribute('y1', '415');
                this.doorBar.setAttribute('x2', '280');
                this.doorBar.setAttribute('y2', '375');
                this.doorBar.setAttribute('stroke', '#10b981');
                this.doorBar.style.transformOrigin = '280px 415px';
            } else {
                this.doorBar.setAttribute('x1', '240');
                this.doorBar.setAttribute('y1', '415');
                this.doorBar.setAttribute('x2', '280');
                this.doorBar.setAttribute('y2', '415');
                this.doorBar.setAttribute('stroke', '#ef4444');
            }
        }

        if (this.doorTxt) {
            this.doorTxt.textContent = isOpen ? 'PUERTA 90° (27) ABIERTA' : 'PUERTA 0° (27) BLOQUEADA';
            this.doorTxt.setAttribute('fill', isOpen ? '#10b981' : '#94a3b8');
        }
    }

    /**
     * Renderiza el estado de las 3 persianas de ventana con animación de lamas individual
     */
    renderWindows(windowsState) {
        const states = Array.isArray(windowsState)
            ? windowsState
            : [Boolean(windowsState), Boolean(windowsState), Boolean(windowsState)];

        this.windowSlats.forEach((slat, idx) => {
            if (slat) {
                const isOpen = Boolean(states[idx]);
                const color = isOpen ? '#10b981' : '#ef4444';
                slat.setAttribute('stroke', color);
                slat.setAttribute('stroke-width', isOpen ? '1.8' : '3.5');
                slat.setAttribute('stroke-dasharray', isOpen ? '6,3' : 'none');
            }
        });
    }

    /**
     * Renderiza el nivel del tinaco en el nodo central con pulso líquido
     */
    renderTinaco(levelPct) {
        const pct = Math.max(0, Math.min(100, Math.round(levelPct)));
        if (this.tinacoTxt) {
            this.tinacoTxt.textContent = `${pct}%`;
        }
        const core = document.getElementById('svg-tinaco-core');
        if (core) {
            // Radio de 6 a 22 según llenado
            const r = 6 + (pct / 100) * 16;
            core.setAttribute('r', r.toFixed(1));
            core.setAttribute('fill', pct < 20 ? 'rgba(239, 68, 68, 0.45)' : 'rgba(56, 189, 248, 0.45)');
        }
    }

    /**
     * Renderiza la capa atmosférica de lluvia y el indicador de cielo
     */
    renderRain(isRaining) {
        // Indicador de cielo
        if (this.skyLabel) {
            if (isRaining) {
                this.skyLabel.innerHTML = `<span style="width: 6px; height: 6px; border-radius: 50%; background: #ef4444;"></span> Precipitación`;
                this.skyLabel.style.color = 'var(--status-rose)';
            } else {
                this.skyLabel.innerHTML = `<span id="sky-dot" style="width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span> Ambiente Seco`;
                this.skyLabel.style.color = 'var(--text-secondary)';
            }
        }

        // Capa de partículas de lluvia
        if (!this.rainLayer) return;

        if (!isRaining) {
            this.rainLayer.innerHTML = '';
            return;
        }

        if (this.rainLayer.children.length === 0) {
            const dropCount = 24;
            const frag = document.createDocumentFragment();
            for (let i = 0; i < dropCount; i++) {
                const drop = document.createElement('div');
                drop.className = 'subtle-drop';
                drop.style.left = `${(Math.random() * 98).toFixed(1)}%`;
                drop.style.top = `${(-15 - Math.random() * 20).toFixed(1)}px`;
                drop.style.animationDelay = `${(Math.random() * 1.2).toFixed(2)}s`;
                drop.style.animationDuration = `${(0.65 + Math.random() * 0.35).toFixed(2)}s`;
                frag.appendChild(drop);
            }
            this.rainLayer.appendChild(frag);
        }
    }
}

if (typeof window !== 'undefined') {
    window.FloorplanView = FloorplanView;
}
