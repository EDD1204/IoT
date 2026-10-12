/**
 * AuditView - Vista de la Consola de Auditoría y Paquetes de Red
 * Patrón MVC: Componente de Vista (View)
 * Soporta filtrado por tipo de evento, búsqueda y exportación JSON/CSV.
 */
class AuditView {
    constructor() {
        this.streamBox = document.getElementById('console-stream-box');
        this.exportBtn = document.getElementById('btn-export-audit');
        this.clearBtn = document.getElementById('btn-clear-audit');
        this.filterSelect = document.getElementById('audit-filter-select');

        this._onExport = null;
        this._entries = [];
        this._activeFilter = 'all';

        this._setupListeners();
    }

    _setupListeners() {
        if (this.exportBtn) {
            this.exportBtn.addEventListener('click', () => {
                if (typeof this._onExport === 'function') {
                    this._onExport();
                }
            });
        }

        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clear());
        }

        if (this.filterSelect) {
            this.filterSelect.addEventListener('change', (e) => {
                this._activeFilter = e.target.value;
                this._rerender();
            });
        }
    }

    bindExport(handler) {
        this._onExport = handler;
    }

    /**
     * Inserta un nuevo paquete o registro en la consola en tiempo real
     */
    addEntry(entry) {
        if (!entry) return;
        this._entries.unshift(entry);
        if (this._entries.length > 80) {
            this._entries.pop();
        }

        if (this._matchesFilter(entry)) {
            this._appendRowDOM(entry, true);
        }
    }

    _matchesFilter(entry) {
        if (this._activeFilter === 'all') return true;
        if (this._activeFilter === 'telemetry') return entry.tag === 'TELEMETRÍA';
        if (this._activeFilter === 'orders') return entry.tag === 'ORDEN' || entry.tag === 'ESCENA';
        if (this._activeFilter === 'alerts') return entry.type === 'warn' || entry.type === 'error' || entry.tag === 'BLOQUEO';
        return true;
    }

    _appendRowDOM(entry, prepend = false) {
        if (!this.streamBox) return;

        const row = document.createElement('div');
        row.className = 'stream-row';
        row.innerHTML = `
            <span class="time">${entry.timeStr}</span>
            <span class="tag ${entry.type}">${entry.tag}</span>
            <span>${entry.message}</span>
        `;

        if (prepend && this.streamBox.firstChild) {
            this.streamBox.insertBefore(row, this.streamBox.firstChild);
        } else {
            this.streamBox.appendChild(row);
        }

        while (this.streamBox.children.length > 60) {
            this.streamBox.removeChild(this.streamBox.lastChild);
        }
    }

    _rerender() {
        if (!this.streamBox) return;
        this.streamBox.innerHTML = '';
        this._entries.filter(e => this._matchesFilter(e)).forEach(e => {
            this._appendRowDOM(e, false);
        });
    }

    clear() {
        this._entries = [];
        if (this.streamBox) {
            this.streamBox.innerHTML = `
                <div class="stream-row">
                    <span class="time">--:--:--</span>
                    <span class="tag in">SYS</span>
                    <span>Consola de auditoría reiniciada.</span>
                </div>
            `;
        }
    }
}

if (typeof window !== 'undefined') {
    window.AuditView = AuditView;
}
