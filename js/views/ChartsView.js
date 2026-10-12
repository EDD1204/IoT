/**
 * ChartsView - Visualización de Gráficas Continuas de Alta Fidelidad en Canvas
 * Patrón MVC: Componente de Vista (View)
 */
class ChartsView {
    constructor() {
        this.canvases = {
            temp: document.getElementById('canvas-temp'),
            hum: document.getElementById('canvas-hum'),
            tinaco: document.getElementById('canvas-tinaco')
        };

        this.currentBadges = {
            temp: document.getElementById('chart-t-cur'),
            hum: document.getElementById('chart-h-cur'),
            tinaco: document.getElementById('chart-tin-cur')
        };

        this._setupResizeObserver();
    }

    _setupResizeObserver() {
        if (typeof ResizeObserver !== 'undefined') {
            this._ro = new ResizeObserver(() => {
                this.redraw();
            });
            Object.values(this.canvases).forEach(canvas => {
                if (canvas && canvas.parentElement) {
                    this._ro.observe(canvas.parentElement);
                }
            });
        }
    }

    /**
     * Dibuja una curva Bézier suave adaptada al DPI de la pantalla
     */
    drawCurve(canvas, dataset, strokeColor, fillColor) {
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;

        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        ctx.clearRect(0, 0, w, h);

        if (!dataset || dataset.length < 2) return;

        // Cálculo de escala con margen visual
        const minVal = Math.min(...dataset);
        const maxVal = Math.max(...dataset);
        const min = minVal * 0.95;
        const max = maxVal * 1.05 || 1;
        const range = max - min || 1;

        // Mapeo de coordenadas
        const points = dataset.map((val, idx) => ({
            x: (idx / (dataset.length - 1)) * w,
            y: h - ((val - min) / range) * (h - 28) - 14
        }));

        // Líneas guía sutiles de fondo
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, h * 0.33);
        ctx.lineTo(w, h * 0.33);
        ctx.moveTo(0, h * 0.66);
        ctx.lineTo(w, h * 0.66);
        ctx.stroke();
        ctx.setLineDash([]);

        // Curva Bézier interpolada
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            const xc = (points[i].x + points[i - 1].x) / 2;
            const yc = (points[i].y + points[i - 1].y) / 2;
            ctx.quadraticCurveTo(points[i - 1].x, points[i - 1].y, xc, yc);
        }
        ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // Relleno degradado atmosférico
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, fillColor);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fill();

        // Punto pulsante al final de la serie
        const last = points[points.length - 1];
        ctx.beginPath();
        ctx.arc(last.x, last.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
    }

    /**
     * Renderiza las 3 gráficas simultáneamente con los datos actuales
     */
    render(history, currentValues) {
        this._cachedHistory = history;
        this._cachedValues = currentValues;

        if (currentValues) {
            if (this.currentBadges.temp && typeof currentValues.temperature === 'number') {
                this.currentBadges.temp.textContent = `${currentValues.temperature.toFixed(1)} °C`;
            }
            if (this.currentBadges.hum && typeof currentValues.humidity === 'number') {
                this.currentBadges.hum.textContent = `${currentValues.humidity.toFixed(1)} %`;
            }
            if (this.currentBadges.tinaco && typeof currentValues.waterLevel === 'number') {
                this.currentBadges.tinaco.textContent = `${currentValues.waterLevel}%`;
            }
        }

        if (history) {
            this.drawCurve(this.canvases.temp, history.temperature, '#f59e0b', 'rgba(245, 158, 11, 0.18)');
            this.drawCurve(this.canvases.hum, history.humidity, '#38bdf8', 'rgba(56, 189, 248, 0.18)');
            this.drawCurve(this.canvases.tinaco, history.waterLevel, '#0284c7', 'rgba(2, 132, 199, 0.18)');
        }
    }

    redraw() {
        if (this._cachedHistory && this._cachedValues) {
            this.render(this._cachedHistory, this._cachedValues);
        }
    }
}

if (typeof window !== 'undefined') {
    window.ChartsView = ChartsView;
}
