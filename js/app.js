/**
 * DomótiX UAEMex - Punto de Entrada de la Aplicación
 * Patrón MVC: Bootstrapper
 */
(function() {
    function startApp() {
        if (window.__domotixAppInitialized) return;
        window.__domotixAppInitialized = true;

        try {
            window.app = new AppController();
            window.app.init();
        } catch (err) {
            console.error('[DomótiX] Error crítico al inicializar la aplicación:', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }
})();
