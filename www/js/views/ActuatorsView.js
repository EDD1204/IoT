/**
 * ActuatorsView - Vista de Mandos, Interruptores Táctiles y Escenas Rápidas
 * Patrón MVC: Componente de Vista (View)
 */
class ActuatorsView {
    constructor() {
        this.lightTiles = [];
        this.gpios = [18, 19, 21, 22];

        for (let i = 1; i <= 4; i++) {
            this.lightTiles.push({
                index: i,
                tile: document.getElementById(`tile-c${i}`),
                status: document.getElementById(`status-c${i}`)
            });
        }

        this.doorTile = document.getElementById('tile-door');
        this.doorStatus = document.getElementById('status-door');

        this.windowsTile = document.getElementById('tile-windows');
        this.windowsStatus = document.getElementById('status-windows');

        this.windowTiles = [
            { index: 1, tile: document.getElementById('tile-w1'), status: document.getElementById('status-w1'), gpio: 13 },
            { index: 2, tile: document.getElementById('tile-w2'), status: document.getElementById('status-w2'), gpio: 25 },
            { index: 3, tile: document.getElementById('tile-w3'), status: document.getElementById('status-w3'), gpio: 26 }
        ];

        this.sceneButtons = document.querySelectorAll('.scene-btn');

        this._handlers = {
            onLightToggle: null,
            onDoorToggle: null,
            onWindowsToggle: null,
            onSceneClick: null
        };

        this._setupListeners();
    }

    _setupListeners() {
        // Interruptores de Luces
        this.lightTiles.forEach(item => {
            if (item.tile) {
                item.tile.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (typeof this._handlers.onLightToggle === 'function') {
                        this._handlers.onLightToggle(item.index);
                    }
                });
            }
        });

        // Puerta
        if (this.doorTile) {
            this.doorTile.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof this._handlers.onDoorToggle === 'function') {
                    this._handlers.onDoorToggle();
                }
            });
        }

        // Interruptor maestro de Todas las Ventanas
        if (this.windowsTile) {
            this.windowsTile.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof this._handlers.onWindowsToggle === 'function') {
                    this._handlers.onWindowsToggle(null);
                }
            });
        }

        // Interruptores de Ventanas Individuales (V1, V2, V3)
        this.windowTiles.forEach(item => {
            if (item.tile) {
                item.tile.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (typeof this._handlers.onWindowsToggle === 'function') {
                        this._handlers.onWindowsToggle(item.index);
                    }
                });
            }
        });

        // Botones de Escenas
        this.sceneButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const onclickAttr = btn.getAttribute('onclick') || '';
                const match = onclickAttr.match(/ejecutarEscena\('([^']+)'\)/);
                const sceneId = btn.dataset.scene || (match ? match[1] : null);

                if (sceneId && typeof this._handlers.onSceneClick === 'function') {
                    this._handlers.onSceneClick(sceneId);
                }
            });
        });
    }

    bindEvents(handlers = {}) {
        this._handlers = { ...this._handlers, ...handlers };
    }

    /**
     * Sincroniza la visualización de los 4 interruptores de iluminación
     */
    renderLights(lightsState) {
        if (!Array.isArray(lightsState)) return;

        this.lightTiles.forEach((item, idx) => {
            const on = Boolean(lightsState[idx]);
            const gpio = this.gpios[idx];

            if (item.tile) {
                item.tile.classList.toggle('active', on);
                item.tile.setAttribute('aria-checked', String(on));
            }
            if (item.status) {
                item.status.textContent = `${on ? 'Encendido' : 'Apagado'} • GPIO ${gpio}`;
            }
        });
    }

    /**
     * Sincroniza la visualización del interruptor de la puerta
     */
    renderDoor(isOpen) {
        if (this.doorTile) {
            this.doorTile.classList.toggle('active', isOpen);
            this.doorTile.setAttribute('aria-checked', String(isOpen));
        }
        if (this.doorStatus) {
            this.doorStatus.textContent = isOpen ? 'Abierta (90°) • GPIO 27' : 'Cerrada (0°) • GPIO 27';
        }
    }

    /**
     * Sincroniza la visualización del interruptor general e individual de ventanas
     */
    renderWindows(windowsState) {
        const states = Array.isArray(windowsState)
            ? windowsState
            : [Boolean(windowsState), Boolean(windowsState), Boolean(windowsState)];

        const allOpen = states.every(Boolean);
        const someOpen = states.some(Boolean);

        if (this.windowsTile) {
            this.windowsTile.classList.toggle('active', allOpen);
            this.windowsTile.setAttribute('aria-checked', String(allOpen));
        }
        if (this.windowsStatus) {
            this.windowsStatus.textContent = allOpen 
                ? 'Todas Abiertas (90°)' 
                : someOpen 
                    ? 'Parcialmente Abiertas' 
                    : 'Todas Cerradas (0°)';
        }

        this.windowTiles.forEach((item, idx) => {
            const isOpen = Boolean(states[idx]);
            if (item.tile) {
                item.tile.classList.toggle('active', isOpen);
                item.tile.setAttribute('aria-checked', String(isOpen));
            }
            if (item.status) {
                item.status.textContent = `${isOpen ? 'Abierta (90°)' : 'Cerrada (0°)'} • GPIO ${item.gpio}`;
            }
        });
    }

    /**
     * Renderiza todo el conjunto de actuadores
     */
    renderAll(actuators) {
        if (!actuators) return;
        if (actuators.lights) this.renderLights(actuators.lights);
        if (actuators.door !== undefined) this.renderDoor(actuators.door);
        if (actuators.windows !== undefined) this.renderWindows(actuators.windows);
    }
}

if (typeof window !== 'undefined') {
    window.ActuatorsView = ActuatorsView;
}
