# Panel de Control Domótico IoT - UAEMex

Panel web interactivo de control domótico y telemetría en tiempo real conectado mediante protocolo MQTT (vía WebSockets con HiveMQ) para simulación con ESP32 / Wokwi.

## 🚀 Características
- **Telemetría y Sensores en Tiempo Real**:
  - Lectura de temperatura y humedad ambiental.
  - Sensor de detección de lluvia.
  - Medición del nivel de tinaco con barra de progreso animada.
- **Control de Actuadores**:
  - Control de iluminación independiente (Cuartos 1 al 4).
  - Control de acceso y ventilación con servomotores (Puerta y Ventanas).
- **Conectividad MQTT**:
  - Conexión directa mediante WebSockets seguros (`wss://broker.hivemq.com:8884/mqtt`).
  - Indicador de estado de conexión al broker en tiempo real.
  - Sincronización bidireccional de comandos y telemetría.

## 👥 Integrantes
- **Arcos Gómez Eduardo**
- **Núñez de los Santos Yael Alejandro**
- **Tovar Espinoza Fernando de Jesus**

## 💻 Cómo ejecutar
1. Clona este repositorio o descarga los archivos.
2. Abre el archivo `index.html` en cualquier navegador web moderno (Chrome, Edge, Brave, Firefox, etc.).
