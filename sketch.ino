#include <ArduinoJson.h>
#include <DHT.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <WiFi.h>

// ==========================================
// CONFIGURACIÓN DE PINES (HARDWARE FÍSICO / 8 LEDs)
// ==========================================
// 1. Iluminación de recámaras (4 LEDs físicos / Relevador)
const int PIN_LEDS[4] = {18, 19, 21, 22}; // Cuarto 1: 18, Cuarto 2: 19, Cuarto 3: 21, Cuarto 4: 22

// 2. Actuadores de Puerta y Ventanas (LEDs que SIMULAN Servomotores)
// HIGH = Abierta / Activa (LED Encendido)
// LOW  = Cerrada / Inactiva (LED Apagado)
#define PIN_LED_PUERTA 27 // GPIO 27 (LED que simula servomotor de Puerta)
const int PIN_VENTANAS[3] = {13, 25, 26}; // V1: GPIO 13, V2: GPIO 25, V3: GPIO 26 (LEDs que simulan servomotores de Ventanas)

// 3. Sensores
#define DHTPIN 4
#define DHTTYPE DHT22 // Sensor de temperatura y humedad (DHT22 o DHT11)
#define PIN_TINACO 34 // ADC1_CH6 (Sensor de nivel de agua HW-038 en físico / Potenciómetro)
#define PIN_LLUVIA 32 // ADC1_CH4 (Sensor de lluvia HW-80 con placa controladora HW-103 v0.1)

// ==========================================
// PARÁMETROS DE CALIBRACIÓN DE SENSORES
// ==========================================
// Sensor de Nivel de Agua HW-038 (Tinaco):
// En agua corriente a 3.3V el sensor suele medir entre 1800 y 2200 sumergido al máximo.
#define TINACO_ADC_MIN 80    // 0% (sensor seco al aire libre)
#define TINACO_ADC_MAX 2100  // 100% (sensor totalmente sumergido en agua corriente)

// Sensor de Lluvia HW-80 + Módulo LM393 HW-103 v0.1:
// Compatible automáticamente si conectas al pin DO o al pin AO del HW-103:
// - Si usas DO: en seco el comparador da HIGH (1); con gotas conmuta a LOW (0).
// - Si usas AO: en seco el ADC mide ~3500-4095; con gotas cae a < 2500.
#define UMBRAL_LLUVIA_ADC 2500 // Umbral para salida analógica (AO)

// ==========================================
// CONFIGURACIÓN DE RED (MODO DUAL AP + STA/MQTT)
// ==========================================
// 1. Red propia emitida por el ESP32 (Punto de Acceso Autónomo - 100% Sin Internet)
const char *AP_SSID = "Domotix-UAEMex";
const char *AP_PASS = "12345678"; // Contraseña de la red Wi-Fi del ESP32

// IP estática fija garantizada para la red local
const IPAddress AP_IP(192, 168, 4, 1);
const IPAddress AP_GATEWAY(192, 168, 4, 1);
const IPAddress AP_SUBNET(255, 255, 255, 0);

// 2. Red externa opcional (Router local "Domotix" o simulador "Wokwi-GUEST")
const char *STA_SSID = "Domotix";
const char *STA_PASS = "12345678";

// 3. Broker MQTT (Activo solo si STA se conecta a un router o simulador)
const bool HABILITAR_MQTT = true;
const char *mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;

// Tópicos MQTT estándar del proyecto DomótiX
const char *TOPIC_TELEMETRIA = "uaemex_casa/telemetria";
const char *TOPIC_LUCES      = "uaemex_casa/actuadores/luces";
const char *TOPIC_PUERTA     = "uaemex_casa/actuadores/puerta";
const char *TOPIC_VENTANAS   = "uaemex_casa/actuadores/ventanas";

// ==========================================
// OBJETOS Y VARIABLES DE ESTADO
// ==========================================
DHT dht(DHTPIN, DHTTYPE);
WiFiClient espClient;
PubSubClient client(espClient);
WebServer server(80);

bool estadoLuces[4] = {false, false, false, false};
bool puertaAbierta = false;
bool estadoVentanas[3] = {false, false, false}; // Estado individual de V1, V2, V3
bool ventanasAbiertas = false;                  // true si todas están abiertas
bool lluviaDetectada = false;
int contadorFiltroLluvia = 0;                   // Filtro antirebote / debouncing para lluvia

unsigned long ultimoEnvio = 0;
unsigned long ultimoIntentoMQTT = 0;

// Declaraciones de funciones
void enviarTelemetria();
void setup_web_server();
void setCORSHeaders();
void handleOptions();
void moverPuerta(bool abrir);
void controlarVentana(int numVentana, bool abrir);
void moverVentanas(bool abrir);
void controlarLuz(int cuarto, bool estado);

// ==========================================
// FUNCIONES DE CONTROL DE HARDWARE (LEDS FÍSICOS)
// ==========================================
void controlarLuz(int cuarto, bool estado) {
  if (cuarto >= 1 && cuarto <= 4) {
    estadoLuces[cuarto - 1] = estado;
    digitalWrite(PIN_LEDS[cuarto - 1], estado ? HIGH : LOW);
    Serial.printf("[ACCIÓN] Luz Cuarto %d (GPIO %d) -> %s\n", cuarto,
                  PIN_LEDS[cuarto - 1], estado ? "ENCENDIDA (HIGH)" : "APAGADA (LOW)");
  }
}

void moverPuerta(bool abrir) {
  puertaAbierta = abrir;
  digitalWrite(PIN_LED_PUERTA, abrir ? HIGH : LOW);
  Serial.printf("[ACCIÓN] Puerta (LED Simulado) -> %s (GPIO %d -> %s)\n",
                abrir ? "ABIERTA" : "CERRADA",
                PIN_LED_PUERTA, abrir ? "HIGH (ENCENDIDO)" : "LOW (APAGADO)");
}

void controlarVentana(int numVentana, bool abrir) {
  if (abrir && lluviaDetectada) {
    Serial.printf("[ALERTA] Bloqueo de seguridad: No se puede abrir Ventana %d mientras llueve (HW-80 mojado).\n", numVentana);
    return;
  }
  if (numVentana >= 1 && numVentana <= 3) {
    estadoVentanas[numVentana - 1] = abrir;
    digitalWrite(PIN_VENTANAS[numVentana - 1], abrir ? HIGH : LOW);
    ventanasAbiertas = (estadoVentanas[0] && estadoVentanas[1] && estadoVentanas[2]);
    Serial.printf("[ACCIÓN] Ventana %d (LED Simulado en GPIO %d) -> %s (%s)\n",
                  numVentana, PIN_VENTANAS[numVentana - 1],
                  abrir ? "ABIERTA" : "CERRADA", abrir ? "HIGH (ENCENDIDO)" : "LOW (APAGADO)");
  }
}

void moverVentanas(bool abrir) {
  if (abrir && lluviaDetectada) {
    Serial.println("[ALERTA] Bloqueo de seguridad: No se pueden abrir ventanas mientras llueve (HW-80 mojado).");
    return;
  }
  for (int i = 0; i < 3; i++) {
    estadoVentanas[i] = abrir;
    digitalWrite(PIN_VENTANAS[i], abrir ? HIGH : LOW);
  }
  ventanasAbiertas = abrir;
  Serial.printf("[ACCIÓN] Todas las Ventanas (LEDs en GPIO 13, 25, 26) -> %s (%s)\n",
                abrir ? "ABIERTAS" : "CERRADAS", abrir ? "HIGH (ENCENDIDOS)" : "LOW (APAGADOS)");
}

// ==========================================
// CONSTRUCCIÓN DEL JSON DE TELEMETRÍA
// ==========================================
String obtenerJsonTelemetria() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  // Lectura analógica estabilizada del Tinaco HW-038 (Promedio de 4 muestras)
  long sumaTinaco = 0;
  for (int i = 0; i < 4; i++) {
    sumaTinaco += analogRead(PIN_TINACO);
    delay(2);
  }
  int lecturaTinaco = sumaTinaco / 4;

  // Calibración adaptada al HW-038 en agua (0% a 100%)
  int nivelTinaco = map(lecturaTinaco, TINACO_ADC_MIN, TINACO_ADC_MAX, 0, 100);
  nivelTinaco = constrain(nivelTinaco, 0, 100);

  if (isnan(t) || isnan(h)) {
    t = 22.5; // Respaldo térmico en caso de retardo del sensor
    h = 50.0;
  }

  int adcRawLluvia = analogRead(PIN_LLUVIA);
  int doRawLluvia = digitalRead(PIN_LLUVIA);

#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<512> doc;
#endif

  doc["temperatura"] = t;
  doc["humedad"] = h;
  doc["nivel_tinaco"] = nivelTinaco;
  doc["tinaco_adc_raw"] = lecturaTinaco; // Lectura cruda para facilitar calibración
  doc["lluvia"] = lluviaDetectada;
  doc["lluvia_adc"] = adcRawLluvia;       // Lectura analógica HW-80 / HW-103
  doc["lluvia_do"] = doRawLluvia;         // Lectura digital HW-103 (0 = Lluvia, 1 = Seco)
  doc["puerta_abierta"] = puertaAbierta;
  doc["ventanas_abiertas"] = ventanasAbiertas;

  JsonObject vent = doc.createNestedObject("ventanas");
  vent["v1"] = estadoVentanas[0];
  vent["v2"] = estadoVentanas[1];
  vent["v3"] = estadoVentanas[2];

  JsonObject luces = doc.createNestedObject("luces");
  luces["c1"] = estadoLuces[0];
  luces["c2"] = estadoLuces[1];
  luces["c3"] = estadoLuces[2];
  luces["c4"] = estadoLuces[3];

  String jsonOutput;
  serializeJson(doc, jsonOutput);
  return jsonOutput;
}

void enviarTelemetria() {
  String json = obtenerJsonTelemetria();
  if (HABILITAR_MQTT && client.connected()) {
    client.publish(TOPIC_TELEMETRIA, json.c_str());
    Serial.printf("[MQTT PUB] %s\n", json.c_str());
  } else {
    Serial.printf("[DOMÓTIX LOCAL] %s\n", json.c_str());
  }
}

// ==========================================
// CALLBACK MQTT (RECEPCIÓN DESDE LA NUBE / WOKWI)
// ==========================================
void mqttCallback(char *topic, byte *payload, unsigned int length) {
#if ARDUINOJSON_VERSION_MAJOR >= 7
  JsonDocument doc;
#else
  StaticJsonDocument<256> doc;
#endif

  DeserializationError error = deserializeJson(doc, payload, length);
  if (error) {
    Serial.println("[ERROR MQTT] Fallo al deserializar JSON entrante.");
    return;
  }

  String strTopic = String(topic);

  if (strTopic == TOPIC_LUCES) {
    int cuarto = doc["cuarto"];
    bool estado = doc["estado"];
    controlarLuz(cuarto, estado);
  } else if (strTopic == TOPIC_PUERTA) {
    bool abrir = doc["abrir"];
    moverPuerta(abrir);
  } else if (strTopic == TOPIC_VENTANAS) {
    if (doc.containsKey("ventana")) {
      int numV = doc["ventana"];
      bool abrir = doc["abrir"];
      controlarVentana(numV, abrir);
    } else {
      bool abrir = doc["abrir"];
      moverVentanas(abrir);
    }
  }

  // Notificar de inmediato el nuevo estado
  enviarTelemetria();
}

// ==========================================
// SERVIDOR WEB HTTP LOCAL (CORS COMPLETO)
// ==========================================
void setCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Origin, Accept");
}

void handleOptions() {
  setCORSHeaders();
  server.send(204);
}

void handleApiTelemetria() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  setCORSHeaders();
  String json = obtenerJsonTelemetria();
  server.send(200, "application/json", json);
}

void handleApiLuz() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  setCORSHeaders();
  if (server.hasArg("cuarto") && server.hasArg("estado")) {
    int cuarto = server.arg("cuarto").toInt();
    bool estado = (server.arg("estado") == "1" || server.arg("estado") == "true");
    controlarLuz(cuarto, estado);
    enviarTelemetria();
    server.send(200, "application/json", "{\"status\":\"ok\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Faltan parametros cuarto y estado\"}");
  }
}

void handleApiPuerta() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  setCORSHeaders();
  if (server.hasArg("abrir")) {
    bool abrir = (server.arg("abrir") == "1" || server.arg("abrir") == "true");
    moverPuerta(abrir);
    enviarTelemetria();
    server.send(200, "application/json", "{\"status\":\"ok\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Falta parametro abrir\"}");
  }
}

void handleApiVentanas() {
  if (server.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  setCORSHeaders();
  if (server.hasArg("abrir")) {
    bool abrir = (server.arg("abrir") == "1" || server.arg("abrir") == "true");
    if (server.hasArg("ventana")) {
      int numV = server.arg("ventana").toInt();
      controlarVentana(numV, abrir);
    } else {
      moverVentanas(abrir);
    }
    enviarTelemetria();
    server.send(200, "application/json", "{\"status\":\"ok\"}");
  } else {
    server.send(400, "application/json", "{\"error\":\"Falta parametro abrir\"}");
  }
}

// Panel web de control directo integrado en el ESP32
void handleRoot() {
  setCORSHeaders();
  String html = R"rawliteral(
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DomótiX UAEMex - ESP32 Direct Control</title>
  <style>
    :root { --bg: #090b10; --card: #141721; --accent: #10b981; --text: #e2e8f0; }
    body { font-family: -apple-system, system-ui, sans-serif; background: var(--bg); color: var(--text); padding: 1.5rem; margin: 0; }
    .container { max-width: 500px; margin: 0 auto; }
    h1 { font-size: 1.4rem; color: var(--accent); margin-bottom: 0.2rem; }
    .badge { background: rgba(16,185,129,0.15); color: var(--accent); padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; }
    .card { background: var(--card); border-radius: 12px; padding: 1rem; margin-top: 1rem; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
    .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 10px; }
    button { background: #1e2433; border: 1px solid #334155; color: white; padding: 12px 8px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; font-size: 0.85rem; }
    button:active { transform: scale(0.96); }
    button.on { background: #059669; border-color: #10b981; }
    .status-val { font-size: 1.1rem; font-weight: 700; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="container">
    <h1>DomótiX UAEMex <span class="badge">ESP32 8 LEDs Control</span></h1>
    <p style="color:#94a3b8; font-size:0.9rem;">Servidor Web Local • Red Wi-Fi: <b>Domotix-UAEMex</b></p>
    
    <div class="card">
      <h3>💡 Iluminación de Cuartos (4 LEDs)</h3>
      <div class="grid">
        <button id="btn-l1" onclick="toggleLuz(1)">Cuarto 1 (GPIO 18)</button>
        <button id="btn-l2" onclick="toggleLuz(2)">Cuarto 2 (GPIO 19)</button>
        <button id="btn-l3" onclick="toggleLuz(3)">Cuarto 3 (GPIO 21)</button>
        <button id="btn-l4" onclick="toggleLuz(4)">Cuarto 4 (GPIO 22)</button>
      </div>
    </div>

    <div class="card">
      <h3>🚪 Accesos y Ventanas (4 LEDs Simulados)</h3>
      <div class="grid">
        <button id="btn-door" onclick="togglePuerta()">Puerta (GPIO 27)</button>
        <button id="btn-win-all" onclick="toggleTodasVentanas()">Todas Ventanas</button>
      </div>
      <div class="grid-3">
        <button id="btn-w1" onclick="toggleVentana(1)">V1 (GPIO 13)</button>
        <button id="btn-w2" onclick="toggleVentana(2)">V2 (GPIO 25)</button>
        <button id="btn-w3" onclick="toggleVentana(3)">V3 (GPIO 26)</button>
      </div>
    </div>

    <div class="card">
      <h3>📊 Telemetría de Sensores en Vivo</h3>
      <p>Temperatura: <span id="temp" class="status-val">--</span> °C</p>
      <p>Humedad: <span id="hum" class="status-val">--</span> %</p>
      <p>Tinaco HW-038: <span id="tinaco" class="status-val">--</span></p>
      <p>Lluvia (HW-80 / HW-103): <span id="lluvia" class="status-val">--</span></p>
    </div>
  </div>

  <script>
    let pOpen = false, vOpen = false;
    let luces = [false, false, false, false];
    let vent = [false, false, false];

    async function update() {
      try {
        const res = await fetch('/api/telemetria');
        const d = await res.json();
        document.getElementById('temp').innerText = d.temperatura;
        document.getElementById('hum').innerText = d.humedad;
        document.getElementById('tinaco').innerText = d.nivel_tinaco + '% (ADC: ' + (d.tinaco_adc_raw !== undefined ? d.tinaco_adc_raw : '--') + ')';
        
        const lluviaInfo = d.lluvia 
          ? '🌧️ ¡LLUVIA ACTIVA! (ADC: ' + (d.lluvia_adc || '--') + ' | DO: ' + (d.lluvia_do !== undefined ? d.lluvia_do : '--') + ')' 
          : '☀️ Seco (ADC: ' + (d.lluvia_adc || '--') + ' | DO: ' + (d.lluvia_do !== undefined ? d.lluvia_do : '--') + ')';
        document.getElementById('lluvia').innerText = lluviaInfo;
        
        pOpen = Boolean(d.puerta_abierta);
        vOpen = Boolean(d.ventanas_abiertas);
        
        document.getElementById('btn-door').className = pOpen ? 'on' : '';
        document.getElementById('btn-door').innerText = 'Puerta (' + (pOpen ? 'ABIERTA / LED ON' : 'CERRADA / LED OFF') + ')';

        document.getElementById('btn-win-all').className = vOpen ? 'on' : '';
        document.getElementById('btn-win-all').innerText = 'Todas (' + (vOpen ? 'ABIERTAS' : 'CERRADAS') + ')';

        if (d.ventanas) {
          vent[0] = Boolean(d.ventanas.v1);
          vent[1] = Boolean(d.ventanas.v2);
          vent[2] = Boolean(d.ventanas.v3);
          document.getElementById('btn-w1').className = vent[0] ? 'on' : '';
          document.getElementById('btn-w1').innerText = 'V1 (' + (vent[0] ? 'ON' : 'OFF') + ')';
          document.getElementById('btn-w2').className = vent[1] ? 'on' : '';
          document.getElementById('btn-w2').innerText = 'V2 (' + (vent[1] ? 'ON' : 'OFF') + ')';
          document.getElementById('btn-w3').className = vent[2] ? 'on' : '';
          document.getElementById('btn-w3').innerText = 'V3 (' + (vent[2] ? 'ON' : 'OFF') + ')';
        }

        if (d.luces) {
          luces[0] = Boolean(d.luces.c1);
          luces[1] = Boolean(d.luces.c2);
          luces[2] = Boolean(d.luces.c3);
          luces[3] = Boolean(d.luces.c4);
          for (let i = 1; i <= 4; i++) {
            const btn = document.getElementById('btn-l' + i);
            btn.className = luces[i-1] ? 'on' : '';
            btn.innerText = 'Cuarto ' + i + ' (' + (luces[i-1] ? 'ON' : 'OFF') + ')';
          }
        }
      } catch(e) {}
    }

    async function toggleLuz(c) {
      const nuevo = !luces[c - 1];
      await fetch('/api/luz?cuarto=' + c + '&estado=' + (nuevo ? '1' : '0'));
      update();
    }

    async function togglePuerta() {
      pOpen = !pOpen;
      await fetch('/api/puerta?abrir=' + (pOpen ? '1' : '0'));
      update();
    }

    async function toggleTodasVentanas() {
      vOpen = !vOpen;
      await fetch('/api/ventanas?abrir=' + (vOpen ? '1' : '0'));
      update();
    }

    async function toggleVentana(num) {
      const nuevo = !vent[num - 1];
      await fetch('/api/ventanas?ventana=' + num + '&abrir=' + (nuevo ? '1' : '0'));
      update();
    }

    setInterval(update, 2000);
    update();
  </script>
</body>
</html>
)rawliteral";
  server.send(200, "text/html", html);
}

void setup_web_server() {
  // Manejo de preflight CORS (OPTIONS) prioritario
  server.on("/api/telemetria", HTTP_OPTIONS, handleOptions);
  server.on("/api/luz", HTTP_OPTIONS, handleOptions);
  server.on("/api/puerta", HTTP_OPTIONS, handleOptions);
  server.on("/api/ventanas", HTTP_OPTIONS, handleOptions);

  server.on("/", HTTP_GET, handleRoot);
  server.on("/api/telemetria", HTTP_GET, handleApiTelemetria);
  server.on("/api/luz", HTTP_ANY, handleApiLuz);
  server.on("/api/puerta", HTTP_ANY, handleApiPuerta);
  server.on("/api/ventanas", HTTP_ANY, handleApiVentanas);

  server.begin();
  Serial.println("[HTTP] Servidor Web local iniciado en puerto 80 (http://192.168.4.1).");
}

// ==========================================
// CONFIGURACIÓN DE RED Y RECONEXIÓN
// ==========================================
void setup_wifi() {
  Serial.println("\n==========================================");
  Serial.println("  DOMÓTIX UAEMex — MODO DUAL RED LOCAL");
  Serial.println("  (Punto de Acceso Autónomo 100% Sin Internet)");
  Serial.println("==========================================");

  // 1. Iniciar siempre el Punto de Acceso (AP) propio del ESP32 (Cero dependencia de internet)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(AP_IP, AP_GATEWAY, AP_SUBNET);
  WiFi.softAP(AP_SSID, AP_PASS);

  IPAddress apIP = WiFi.softAPIP();
  Serial.printf("[AP LOCAL ACTIVO] Conéctate a la Red Wi-Fi: %s | Pass: %s\n", AP_SSID, AP_PASS);
  Serial.printf("[ACCESO DIRECTO]: Abre en tu Celular o PC -> http://%s\n", apIP.toString().c_str());

  // 2. Intentar conectar a red externa (Router local o Wokwi)
  if (strlen(STA_SSID) > 0) {
    Serial.printf("[STA] Buscando red secundaria: %s ...\n", STA_SSID);
    WiFi.begin(STA_SSID, STA_PASS);
  }
}

void reconnectMQTT() {
  if (!HABILITAR_MQTT) return;
  if (WiFi.status() != WL_CONNECTED) return; // Solo si STA conectó exitosamente a un router

  if (millis() - ultimoIntentoMQTT > 5000) {
    ultimoIntentoMQTT = millis();
    Serial.printf("[MQTT] Conectando a broker %s:%d...\n", mqtt_server, mqtt_port);
    String clientId = "UAEMexIoTClient-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str())) {
      Serial.println(" [MQTT] ¡Conectado exitosamente!");
      client.subscribe(TOPIC_LUCES);
      client.subscribe(TOPIC_PUERTA);
      client.subscribe(TOPIC_VENTANAS);
      enviarTelemetria();
    } else {
      Serial.printf(" [MQTT] No disponible (rc=%d). Operando en Modo Local HTTP.\n", client.state());
    }
  }
}

// ==========================================
// SETUP
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(500);

  // Resolución analógica a 12 bits (0 a 4095)
  analogReadResolution(12);

  // 1. Configuración de pines de LEDs de cuartos (4 LEDs)
  for (int i = 0; i < 4; i++) {
    pinMode(PIN_LEDS[i], OUTPUT);
    digitalWrite(PIN_LEDS[i], LOW);
  }

  // 2. Configuración de Puerta y Ventanas como LEDs FÍSICOS (4 LEDs)
  pinMode(PIN_LED_PUERTA, OUTPUT);
  digitalWrite(PIN_LED_PUERTA, LOW);

  for (int i = 0; i < 3; i++) {
    pinMode(PIN_VENTANAS[i], OUTPUT);
    digitalWrite(PIN_VENTANAS[i], LOW);
  }

  // 3. Sensor de lluvia HW-80 + HW-103 v0.1 con pullup interno
  pinMode(PIN_LLUVIA, INPUT_PULLUP);

  // 4. Sensor de nivel de agua HW-038 (Tinaco)
  pinMode(PIN_TINACO, INPUT);

  // 5. Iniciar sensor DHT (Temperatura y Humedad)
  dht.begin();

  // 6. Iniciar red Wi-Fi y servidor local
  setup_wifi();
  setup_web_server();

  // 7. Configurar cliente MQTT
  if (HABILITAR_MQTT) {
    client.setServer(mqtt_server, mqtt_port);
    client.setCallback(mqttCallback);
  }

  // 8. Estado inicial: puerta cerrada (LED OFF), ventanas abiertas (LEDs ON)
  moverPuerta(false);
  moverVentanas(true);
  Serial.println("[DOMÓTIX] Sistema con 8 LEDs inicializado correctamente.");
}

// ==========================================
// LOOP PRINCIPAL
// ==========================================
void loop() {
  // 1. Atender peticiones del Servidor Web HTTP local (celular / PC en red local Domotix)
  server.handleClient();

  // 2. Gestionar MQTT de forma no bloqueante solo si STA está conectado a red Wi-Fi
  if (HABILITAR_MQTT && WiFi.status() == WL_CONNECTED) {
    if (!client.connected()) {
      reconnectMQTT();
    } else {
      client.loop();
    }
  }

  // 3. Monitoreo inteligente del sensor de lluvia HW-80 + HW-103 v0.1
  int lecturaLluviaADC = analogRead(PIN_LLUVIA);
  int lecturaLluviaDO = digitalRead(PIN_LLUVIA);

  // Detección automática en DO (LOW = Lluvia) o en AO (ADC < 2500 = Lluvia):
  bool lluviaInstantanea = (lecturaLluviaDO == LOW) || (lecturaLluviaADC < UMBRAL_LLUVIA_ADC);

  if (lluviaInstantanea) {
    if (contadorFiltroLluvia < 3) contadorFiltroLluvia++;
  } else {
    if (contadorFiltroLluvia > 0) contadorFiltroLluvia--;
  }

  // Se confirma lluvia tras 2 lecturas consecutivas para evitar falsos positivos
  bool lluviaConfirmada = (contadorFiltroLluvia >= 2);

  if (lluviaConfirmada && !lluviaDetectada) {
    lluviaDetectada = true;
    Serial.printf("\n>>> [HW-80 / HW-103] ¡LLUVIA DETECTADA! (ADC: %d, DO: %d). Apagando LEDs de Ventanas...\n",
                  lecturaLluviaADC, lecturaLluviaDO);
    moverVentanas(false); // Cierra ventanas (apaga LEDs) por seguridad
    enviarTelemetria();
  } else if (!lluviaConfirmada && lluviaDetectada) {
    lluviaDetectada = false;
    Serial.printf("\n>>> [HW-80 / HW-103] LLUVIA CESADA (ADC: %d, DO: %d). Operación normal restaurada.\n",
                  lecturaLluviaADC, lecturaLluviaDO);
    enviarTelemetria();
  }

  // 4. Envío y actualización periódica cada 2 segundos
  unsigned long tiempoActual = millis();
  if (tiempoActual - ultimoEnvio > 2000) {
    ultimoEnvio = tiempoActual;
    enviarTelemetria();
  }
}