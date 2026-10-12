/**
 * TelemetryView - Vista de Métricas Ambientales y Medidores Analógicos
 * Patrón MVC: Componente de Vista (View)
 */
class TelemetryView {
    constructor() {
        this.tempVal = document.getElementById('temp-val');
        this.humVal = document.getElementById('hum-val');
        this.rainVal = document.getElementById('rain-val');
        this.rainPill = document.getElementById('rain-pill');

        this.tinacoPctTxt = document.getElementById('tinaco-pct-txt');
        this.tinacoFluidBar = document.getElementById('tinaco-fluid-bar');
        this.tinacoLitersTxt = document.getElementById('tinaco-liters-txt');
        this.lastPingBadge = document.getElementById('last-ping-badge');
    }

    /**
     * Renderiza el estado completo de sensores
     * @param {Object} sensors - { temperature, humidity, waterLevel, waterLiters, isRaining }
     */
    render(sensors) {
        if (!sensors) return;

        // 1. Temperatura DHT22
        if (this.tempVal && typeof sensors.temperature === 'number') {
            this.tempVal.textContent = `${sensors.temperature.toFixed(1)} °C`;
        }

        // 2. Humedad Relativa
        if (this.humVal && typeof sensors.humidity === 'number') {
            this.humVal.textContent = `${sensors.humidity.toFixed(1)} %`;
        }

        // 3. Sensor de Lluvia y Aviso de Seguridad
        if (this.rainVal) {
            if (sensors.isRaining) {
                this.rainVal.textContent = '¡Lluvia!';
                this.rainVal.style.color = 'var(--status-rose)';
            } else {
                this.rainVal.textContent = 'Seco';
                this.rainVal.style.color = 'var(--status-green)';
            }
        }

        if (this.rainPill) {
            this.rainPill.classList.toggle('active', Boolean(sensors.isRaining));
        }

        // 4. Depósito del Tinaco (HW-038)
        const pct = Math.max(0, Math.min(100, Math.round(sensors.waterLevel || 0)));
        const liters = sensors.waterLiters !== undefined ? sensors.waterLiters : Math.round((pct / 100) * 1100);

        if (this.tinacoPctTxt) {
            this.tinacoPctTxt.textContent = `${pct}%`;
        }

        if (this.tinacoFluidBar) {
            this.tinacoFluidBar.style.width = `${pct}%`;
        }

        if (this.tinacoLitersTxt) {
            this.tinacoLitersTxt.textContent = `${liters} / 1100 L`;
        }
    }

    setLastPing(text) {
        if (this.lastPingBadge && text) {
            this.lastPingBadge.textContent = text;
        }
    }
}

if (typeof window !== 'undefined') {
    window.TelemetryView = TelemetryView;
}
