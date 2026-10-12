// Service Worker para DomótiX UAEMex PWA (Arquitectura MVC + React Widgets)
// Resiliencia 100% Offline para Red Local DomótiX (ESP32)
const CACHE_NAME = 'domotix-v4';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './css/main.css',
    './css/floorplan.css',
    './css/components.css',
    './css/responsive.css',
    './js/vendor/mqtt.min.js',
    './js/vendor/react.production.min.js',
    './js/vendor/react-dom.production.min.js',
    './js/vendor/htm.umd.js',
    './js/models/AuditLogger.js',
    './js/models/HouseModel.js',
    './js/models/AutomationsModel.js',
    './js/models/NetworkHealthModel.js',
    './js/services/SoundService.js',
    './js/services/MqttService.js',
    './js/services/SpeechService.js',
    './js/views/FloorplanView.js',
    './js/views/ActuatorsView.js',
    './js/views/TelemetryView.js',
    './js/views/ChartsView.js',
    './js/views/AuditView.js',
    './js/views/UIComponents.js',
    './js/views/ReactWidgetsView.js',
    './js/controllers/AppController.js',
    './js/app.js'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS).catch((err) => {
                console.warn('[SW] Cache addAll warning:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Para llamadas MQTT, WebSockets o API REST local directa al ESP32, pasar siempre en vivo
    if (e.request.url.includes('mqtt') || 
        e.request.url.startsWith('ws') || 
        e.request.url.includes('/api/') || 
        e.request.url.includes('192.168.')) {
        return;
    }

    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Devolver recurso en caché e intentar actualizar en segundo plano (Stale-While-Revalidate)
                fetch(e.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(e.request, networkResponse);
                        });
                    }
                }).catch(() => {});
                return cachedResponse;
            }

            return fetch(e.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && e.request.method === 'GET') {
                    const cloned = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, cloned);
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Fallback si no hay conexión
                if (e.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
