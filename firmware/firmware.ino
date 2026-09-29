// ═══════════════════════════════════════════════════════════════════════════
// FIRMWARE — Sistema Automático de Monitorização e Controlo NFT
// ───────────────────────────────────────────────────────────────────────────
// Autor      : [Nome do candidato]
// Curso      : Engenharia Electrónica e Telecomunicações — 5.º Ano
// Instituição: [Nome da Universidade]
// Local      : Nampula, Moçambique
// Ano        : 2025
// ───────────────────────────────────────────────────────────────────────────
// Hardware   : ESP32 DOIT DevKit V1 (30 pinos)
// Sensores   : pH-4502C (GPIO34) | Sensor EC (GPIO35) | DS18B20 (GPIO4)
// Actuadores : 5 Bombas peristálticas via módulos relé
// IHM Local  : LCD 16×2 I2C PCF8574 (GPIO21/22) + 2 Botões (GPIO36/39)
// Comunicação: Firebase Realtime Database (Wi-Fi) + GSM SIM800L/SIM900A
// ───────────────────────────────────────────────────────────────────────────
// Bibliotecas necessárias (instalar via Library Manager do Arduino IDE):
//   1. Firebase_ESP_Client  — by Mobizt
//   2. DallasTemperature    — by Miles Burton
//   3. OneWire              — by Paul Stoffregen
//   4. LiquidCrystal_I2C   — by Frank de Brabander
// ═══════════════════════════════════════════════════════════════════════════

// ── BIBLIOTECAS ─────────────────────────────────────────────────────────────
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"   // Auxiliar de autenticação Firebase
#include "addons/RTDBHelper.h"    // Auxiliar do Realtime Database
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
// NOTA: LiquidCrystal_I2C mostra aviso de arquitectura AVR no ESP32
// mas funciona correctamente. O aviso pode ser ignorado.
#include <LiquidCrystal_I2C.h>

// ── PROTÓTIPOS DE FUNÇÕES ────────────────────────────────────────────────────
// Necessário declarar antes do setup() para evitar erros de compilação
void IRAM_ATTR ISR_BtnA();
void IRAM_ATTR ISR_BtnB();
void tarefaControlo(void *param);
void tarefaComunicacao(void *param);
float lerPH();
float lerEC();
float lerTemperatura();
void controlarPH(float ph);
void controlarEC(float ec);
void verificarAlarmes(float ph, float ec, float temp);
void actualizarLCD(float ph, float ec, float temp);
void lcdMensagem(const char* linha1, const char* linha2);
void lcdMensagem(const char* linha1, String linha2);
void enviarFirebase(float ph, float ec, float temp, bool alarme);
void lerSetpointsFirebase();
bool gsmPronto();
void enviarSMS(float ph, float ec, float temp);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES — ALTERAR CONFORME O SEU AMBIENTE
// ═══════════════════════════════════════════════════════════════════════════

// ── Wi-Fi ───────────────────────────────────────────────────────────────────
#define WIFI_SSID       "Nome_da_Rede_WiFi"
#define WIFI_PASSWORD   "Senha_do_WiFi"

// ── Firebase ────────────────────────────────────────────────────────────────
// Obter em: console.firebase.google.com → Projecto → Definições → API Web
#define FIREBASE_API_KEY   "AIzaSy_SUBSTITUA_PELA_SUA_API_KEY"
#define FIREBASE_DB_URL    "https://SEU-PROJECTO-rtdb.firebaseio.com"
// Caminho raiz dos dados no Firebase
#define FB_PATH            "/nft_nampula"

// ── GSM ─────────────────────────────────────────────────────────────────────
// Número do operador com prefixo internacional de Moçambique
#define GSM_NUMERO_OPERADOR  "+258800000000"

// ── Identificação do sistema ─────────────────────────────────────────────────
#define SISTEMA_ID  "NFT_NAMPULA_001"

// ═══════════════════════════════════════════════════════════════════════════
// PINOS GPIO — NÃO ALTERAR SEM VERIFICAR COMPATIBILIDADE
// ═══════════════════════════════════════════════════════════════════════════
#define PIN_PH          34   // ADC1_CH6 — Módulo pH-4502C (saída Po)
                             // ATENÇÃO: requer divisor 2×10kΩ (5V→2.5V)
#define PIN_EC          35   // ADC1_CH7 — Sensor EC (saída analógica)
#define PIN_TEMP         4   // OneWire  — Sensor DS18B20

// Relés (activos em LOW — bomba liga quando GPIO = LOW)
#define PIN_RELE_BOMBA  25   // Bomba de circulação NFT
#define PIN_RELE_PH_DN  26   // Bomba pH Down (ácido fosfórico 10%)
#define PIN_RELE_PH_UP  27   // Bomba pH Up   (KOH 10%)
#define PIN_RELE_EC_A   14   // Bomba nutrientes EC — Parte A
#define PIN_RELE_EC_B   12   // Bomba nutrientes EC — Parte B

// LCD 16×2 I2C
#define PIN_LCD_SDA     21
#define PIN_LCD_SCL     22
#define LCD_ENDERECO  0x27   // Endereço I2C do módulo PCF8574 (0x27 ou 0x3F)

// Botões de navegação do LCD (GPIO input-only — sem pull-up interno)
#define PIN_BTN_A       36   // Avançar página
#define PIN_BTN_B       39   // Recuar página

// LED indicador de alarme
#define PIN_LED_ALARM    2   // LED onboard do DevKit V1

// GSM UART2
#define PIN_GSM_RX      16   // UART2 RX ← TX do SIM800L/SIM900A
#define PIN_GSM_TX      17   // UART2 TX → RX do SIM800L/SIM900A

// ═══════════════════════════════════════════════════════════════════════════
// SETPOINTS E LIMIARES DE CONTROLO
// (podem ser actualizados remotamente via Firebase)
// ═══════════════════════════════════════════════════════════════════════════
float PH_MIN    = 5.6;   // pH mínimo — pH Up activa abaixo deste valor
float PH_MAX    = 6.0;   // pH máximo — pH Down activa acima deste valor
float PH_CRIT_L = 5.0;   // pH crítico inferior — alarme + SMS
float PH_CRIT_H = 7.5;   // pH crítico superior — alarme + SMS

float EC_MIN    = 1.2;   // EC mínima (mS/cm) — nutrientes activam abaixo
float EC_MAX    = 1.8;   // EC máxima (mS/cm) — alerta acima
float EC_CRIT_L = 0.5;   // EC crítica inferior — alarme + SMS
float EC_CRIT_H = 3.0;   // EC crítica superior — alarme + SMS

float T_MAX     = 24.0;  // Temperatura máxima normal (°C)
float T_CRIT    = 30.0;  // Temperatura crítica — alarme + SMS

int   T_DOSE_PH = 3;     // Duração da dosagem de pH (segundos)
int   T_DOSE_EC = 5;     // Duração da dosagem de EC (segundos)

// Ciclo de controlo
#define CICLO_MS  10000  // Intervalo entre leituras (10 000 ms = 10 s)

// ═══════════════════════════════════════════════════════════════════════════
// COEFICIENTES DE CALIBRAÇÃO
// (ajustar após calibração com soluções de referência)
// ═══════════════════════════════════════════════════════════════════════════
// pH = m_ph * leituraADC + b_ph
// Calcular com: tampão pH 4,0 e tampão pH 7,0
// Fórmula: m_ph = (7.0 - 4.0) / (ADC_pH7 - ADC_pH4)
//          b_ph = 7.0 - m_ph * ADC_pH7
float m_ph = -0.0034;    // Declive (exemplo — recalcular na calibração)
float b_ph =  17.0;      // Intercepção (exemplo — recalcular na calibração)

// EC = m_ec * leituraADC  (com compensação de temperatura posterior)
// Calcular com: solução de referência KCl 1,413 mS/cm a 25 °C
// Fórmula: m_ec = 1.413 / ADC_ref
float m_ec = 0.00488;    // Declive (exemplo — recalcular na calibração)

// ═══════════════════════════════════════════════════════════════════════════
// VARIÁVEIS GLOBAIS
// ═══════════════════════════════════════════════════════════════════════════
float valorPH    = 0.0;
float valorEC    = 0.0;
float valorTemp  = 0.0;

bool  alarmeActivo = false;
bool  wifiOK       = false;
bool  firebaseOK   = false;

volatile int paginaLCD = 0;  // Página activa no LCD (volatile: alterada por ISR)

// Anti-debounce para botões
volatile unsigned long ultimoPressA = 0;
volatile unsigned long ultimoPressB = 0;
#define DEBOUNCE_MS  250

// Mutex FreeRTOS para acesso seguro às variáveis globais entre núcleos
SemaphoreHandle_t mutexDados;

// ── OBJECTOS DAS BIBLIOTECAS ─────────────────────────────────────────────────
OneWire           oneWireBus(PIN_TEMP);
DallasTemperature ds18b20(&oneWireBus);
LiquidCrystal_I2C lcd(LCD_ENDERECO, 16, 2);

FirebaseData      fbData;
FirebaseAuth      fbAuth;
FirebaseConfig    fbConfig;

HardwareSerial    gsmSerial(2);  // UART2 para SIM800L/SIM900A


// ═══════════════════════════════════════════════════════════════════════════
// SETUP — INICIALIZAÇÃO DO SISTEMA
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("\n╔══════════════════════════════════════════╗");
  Serial.println("║   Sistema NFT — Nampula — A iniciar...   ║");
  Serial.println("╚══════════════════════════════════════════╝");

  // ── 1. Configurar GPIO ──────────────────────────────────────────────────
  // Relés: OUTPUT, iniciar em HIGH (relé aberto = bomba desligada)
  int relesPinos[] = {PIN_RELE_BOMBA, PIN_RELE_PH_DN,
                      PIN_RELE_PH_UP, PIN_RELE_EC_A, PIN_RELE_EC_B};
  for (int p : relesPinos) {
    pinMode(p, OUTPUT);
    digitalWrite(p, HIGH);  // HIGH = relé aberto = bomba desligada (segurança)
  }
  // LED de alarme
  pinMode(PIN_LED_ALARM, OUTPUT);
  digitalWrite(PIN_LED_ALARM, LOW);
  // Botões: INPUT (pull-up externo de 10kΩ necessário — sem pull-up interno)
  pinMode(PIN_BTN_A, INPUT);
  pinMode(PIN_BTN_B, INPUT);
  Serial.println("[INIT] GPIO configurado.");

  // ── 2. Inicializar I2C e LCD ────────────────────────────────────────────
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcdMensagem("Sistema NFT", "A iniciar...");
  Serial.println("[INIT] LCD 16x2 iniciado.");

  // ── 3. Inicializar sensor DS18B20 ───────────────────────────────────────
  ds18b20.begin();
  ds18b20.setResolution(12);  // 12 bits = precisão de 0.0625°C
  Serial.println("[INIT] DS18B20 iniciado (resolução 12 bits).");

  // ── 4. Inicializar UART2 para GSM ───────────────────────────────────────
  gsmSerial.begin(9600, SERIAL_8N1, PIN_GSM_RX, PIN_GSM_TX);
  Serial.println("[INIT] UART2 GSM iniciado (9600 bps).");
  delay(1000);
  // Verificar se o módulo GSM responde
  gsmSerial.println("AT");
  delay(500);
  if (gsmSerial.available()) {
    Serial.println("[GSM] Módulo GSM respondeu ao AT.");
  } else {
    Serial.println("[GSM] AVISO: Módulo GSM não respondeu. Verificar ligação.");
  }

  // ── 5. Ligar ao Wi-Fi ───────────────────────────────────────────────────
  lcdMensagem("A ligar WiFi...", WIFI_SSID);
  Serial.print("[WiFi] A ligar a: "); Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 30) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }
  wifiOK = (WiFi.status() == WL_CONNECTED);
  if (wifiOK) {
    Serial.println("\n[WiFi] Ligado! IP: " + WiFi.localIP().toString());
    lcdMensagem("WiFi OK!", WiFi.localIP().toString());
  } else {
    Serial.println("\n[WiFi] FALHA. Modo sem internet activo.");
    lcdMensagem("WiFi FALHOU", "Modo local");
  }
  delay(1500);

  // ── 6. Inicializar Firebase ─────────────────────────────────────────────
  if (wifiOK) {
    fbConfig.api_key        = FIREBASE_API_KEY;
    fbConfig.database_url   = FIREBASE_DB_URL;
    fbConfig.token_status_callback = tokenStatusCallback;
    // Autenticação anónima (para protótipo)
    // Para produção: usar fbAuth.user.email e fbAuth.user.password
    Firebase.signUp(&fbConfig, &fbAuth, "", "");
    Firebase.begin(&fbConfig, &fbAuth);
    Firebase.reconnectWiFi(true);
    // Aguardar token de autenticação
    int espera = 0;
    while (!Firebase.ready() && espera < 20) {
      delay(500); espera++;
      Serial.print(".");
    }
    firebaseOK = Firebase.ready();
    if (firebaseOK) {
      Serial.println("\n[Firebase] Ligado com sucesso!");
      lcdMensagem("Firebase OK!", "Sistema pronto");
      // Registar arranque no Firebase
      Firebase.RTDB.setString(&fbData, FB_PATH"/sistema/estado", "online");
      Firebase.RTDB.setString(&fbData, FB_PATH"/sistema/id", SISTEMA_ID);
      lerSetpointsFirebase();  // Carregar setpoints guardados
    } else {
      Serial.println("\n[Firebase] FALHA na ligação.");
      lcdMensagem("Firebase FALHOU", "Modo local");
    }
    delay(1500);
  }

  // ── 7. Criar mutex FreeRTOS ─────────────────────────────────────────────
  mutexDados = xSemaphoreCreateMutex();

  // ── 8. Configurar interrupções dos botões ────────────────────────────────
  attachInterrupt(digitalPinToInterrupt(PIN_BTN_A), ISR_BtnA, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_BTN_B), ISR_BtnB, FALLING);

  // ── 9. Ligar bomba de circulação NFT ────────────────────────────────────
  digitalWrite(PIN_RELE_BOMBA, LOW);  // LOW = relé fecha = bomba ON
  Serial.println("[BOMBA] Bomba de circulação NFT ligada.");

  // ── 10. Criar tarefas FreeRTOS nos dois núcleos ─────────────────────────
  // Core 0: sensores, controlo, LCD (tempo real)
  xTaskCreatePinnedToCore(tarefaControlo, "Controlo",
                          8192, NULL, 2, NULL, 0);
  // Core 1: Firebase, GSM (comunicação)
  xTaskCreatePinnedToCore(tarefaComunicacao, "Comunicacao",
                          8192, NULL, 1, NULL, 1);

  Serial.println("[INIT] Sistema iniciado. Tarefas FreeRTOS activas.");
  lcdMensagem("Sistema activo", "pH EC Temp ON");
  delay(1000);
}

// Loop principal não utilizado — lógica nas tarefas FreeRTOS
void loop() {
  vTaskDelay(portMAX_DELAY);
}


// ═══════════════════════════════════════════════════════════════════════════
// ROTINAS DE SERVIÇO DE INTERRUPÇÃO DOS BOTÕES (ISR)
// ═══════════════════════════════════════════════════════════════════════════
void IRAM_ATTR ISR_BtnA() {
  unsigned long agora = millis();
  if (agora - ultimoPressA > DEBOUNCE_MS) {
    paginaLCD = (paginaLCD + 1) % 3;  // Avançar página: 0→1→2→0
    ultimoPressA = agora;
  }
}

void IRAM_ATTR ISR_BtnB() {
  unsigned long agora = millis();
  if (agora - ultimoPressB > DEBOUNCE_MS) {
    paginaLCD = (paginaLCD + 2) % 3;  // Recuar página: 0→2→1→0
    ultimoPressB = agora;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// TAREFA DO CORE 0 — Sensores + Controlo + LCD
// ═══════════════════════════════════════════════════════════════════════════
void tarefaControlo(void *param) {
  TickType_t ultimoTick = xTaskGetTickCount();
  Serial.println("[Core0] Tarefa de controlo iniciada.");

  while (true) {

    // ── PASSO 1: Ler sensores ──────────────────────────────────────────────
    float ph   = lerPH();
    float ec   = lerEC();
    float temp = lerTemperatura();

    Serial.printf("[Sensores] pH=%.2f | EC=%.2f mS/cm | T=%.1f°C\n",
                  ph, ec, temp);

    // ── PASSO 2: Guardar valores com mutex (partilha com Core 1) ──────────
    if (xSemaphoreTake(mutexDados, pdMS_TO_TICKS(200)) == pdTRUE) {
      valorPH   = ph;
      valorEC   = ec;
      valorTemp = temp;
      xSemaphoreGive(mutexDados);
    }

    // ── PASSO 3: Lógica de controlo ────────────────────────────────────────
    controlarPH(ph);
    controlarEC(ec);
    verificarAlarmes(ph, ec, temp);

    // ── PASSO 4: Actualizar LCD ─────────────────────────────────────────────
    actualizarLCD(ph, ec, temp);

    // ── PASSO 5: Aguardar até ao próximo ciclo (10 segundos) ───────────────
    vTaskDelayUntil(&ultimoTick, pdMS_TO_TICKS(CICLO_MS));
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE LEITURA DOS SENSORES
// ═══════════════════════════════════════════════════════════════════════════

// ── LEITURA DO pH ────────────────────────────────────────────────────────────
// Média de 10 leituras ADC para reduzir ruído
// Calibração: pH = m_ph * ADC + b_ph (regressão linear de 2 pontos)
float lerPH() {
  long soma = 0;
  for (int i = 0; i < 10; i++) {
    soma += analogRead(PIN_PH);
    delay(10);
  }
  float mediaADC = soma / 10.0;
  float ph = m_ph * mediaADC + b_ph;
  ph = constrain(ph, 0.0, 14.0);  // Garantir gama válida de pH

  // Debug: mostrar leitura ADC bruta
  Serial.printf("[pH] ADC bruto: %.0f | pH calculado: %.2f\n", mediaADC, ph);
  return ph;
}

// ── LEITURA DA EC ─────────────────────────────────────────────────────────────
// Com compensação automática de temperatura via DS18B20
// Compensação: EC_comp = EC_bruto / (1 + 0.02 * (T - 25))
float lerEC() {
  long soma = 0;
  for (int i = 0; i < 10; i++) {
    soma += analogRead(PIN_EC);
    delay(10);
  }
  float mediaADC = soma / 10.0;
  float ec_bruto = m_ec * mediaADC;

  // Compensação de temperatura (coeficiente: 2% por °C)
  float temp_actual = valorTemp > 0 ? valorTemp : 25.0;
  float ec_comp = ec_bruto / (1.0 + 0.02 * (temp_actual - 25.0));
  ec_comp = constrain(ec_comp, 0.0, 20.0);

  Serial.printf("[EC] ADC bruto: %.0f | EC bruto: %.2f | EC comp: %.2f mS/cm\n",
                mediaADC, ec_bruto, ec_comp);
  return ec_comp;
}

// ── LEITURA DA TEMPERATURA DS18B20 ────────────────────────────────────────────
float lerTemperatura() {
  ds18b20.requestTemperatures();
  float temp = ds18b20.getTempCByIndex(0);
  if (temp == DEVICE_DISCONNECTED_C) {
    Serial.println("[TEMP] ERRO: DS18B20 desligado ou com falha!");
    return -999.0;  // Valor de erro reconhecível
  }
  Serial.printf("[Temp] %.1f°C\n", temp);
  return temp;
}


// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE CONTROLO AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════════════════

// ── CONTROLO DO pH (ON/OFF com histerese) ────────────────────────────────────
// Nunca activa pH Down e pH Up simultaneamente
void controlarPH(float ph) {
  if (ph > PH_MAX) {
    // pH alto → activar bomba pH Down
    Serial.printf("[Controlo] pH=%.2f > %.1f → pH Down %ds\n",
                  ph, PH_MAX, T_DOSE_PH);
    digitalWrite(PIN_RELE_PH_DN, LOW);    // Ligar bomba
    vTaskDelay(pdMS_TO_TICKS(T_DOSE_PH * 1000));
    digitalWrite(PIN_RELE_PH_DN, HIGH);   // Desligar bomba
    Serial.println("[Controlo] pH Down concluído. Aguardar estabilização.");
    // Aguardar 60s para a solução homogeneizar antes de nova leitura
    // (este delay não bloqueia o Core 1 — apenas esta tarefa)
    vTaskDelay(pdMS_TO_TICKS(5000));  // 5s de estabilização parcial

  } else if (ph < PH_MIN) {
    // pH baixo → activar bomba pH Up
    Serial.printf("[Controlo] pH=%.2f < %.1f → pH Up %ds\n",
                  ph, PH_MIN, T_DOSE_PH);
    digitalWrite(PIN_RELE_PH_UP, LOW);
    vTaskDelay(pdMS_TO_TICKS(T_DOSE_PH * 1000));
    digitalWrite(PIN_RELE_PH_UP, HIGH);
    Serial.println("[Controlo] pH Up concluído. Aguardar estabilização.");
    vTaskDelay(pdMS_TO_TICKS(5000));

  } else {
    Serial.printf("[Controlo] pH=%.2f dentro do setpoint [%.1f–%.1f] ✓\n",
                  ph, PH_MIN, PH_MAX);
  }
}

// ── CONTROLO DA EC (ON/OFF) ───────────────────────────────────────────────────
// Activa Parte A e Parte B simultaneamente (nunca separadas)
void controlarEC(float ec) {
  if (ec < EC_MIN) {
    Serial.printf("[Controlo] EC=%.2f < %.1f → Nutrientes A+B %ds\n",
                  ec, EC_MIN, T_DOSE_EC);
    digitalWrite(PIN_RELE_EC_A, LOW);   // Parte A ON
    digitalWrite(PIN_RELE_EC_B, LOW);   // Parte B ON
    vTaskDelay(pdMS_TO_TICKS(T_DOSE_EC * 1000));
    digitalWrite(PIN_RELE_EC_A, HIGH);  // Parte A OFF
    digitalWrite(PIN_RELE_EC_B, HIGH);  // Parte B OFF
    Serial.println("[Controlo] Dosagem EC concluída.");
    vTaskDelay(pdMS_TO_TICKS(5000));

  } else if (ec > EC_MAX) {
    Serial.printf("[Controlo] EC=%.2f > %.1f → ALERTA (diluição manual)\n",
                  ec, EC_MAX);
  } else {
    Serial.printf("[Controlo] EC=%.2f dentro do setpoint [%.1f–%.1f] ✓\n",
                  ec, EC_MIN, EC_MAX);
  }
}

// ── VERIFICAÇÃO DE ALARMES CRÍTICOS ──────────────────────────────────────────
void verificarAlarmes(float ph, float ec, float temp) {
  bool critico = (ph   < PH_CRIT_L || ph   > PH_CRIT_H ||
                  ec   < EC_CRIT_L || ec   > EC_CRIT_H ||
                  temp > T_CRIT);
  alarmeActivo = critico;
  digitalWrite(PIN_LED_ALARM, critico ? HIGH : LOW);

  if (critico) {
    Serial.println("[ALARME] ⚠ ALARME CRÍTICO ACTIVO!");
    if (ph < PH_CRIT_L || ph > PH_CRIT_H)
      Serial.printf("         pH=%.2f fora do limite crítico [%.1f–%.1f]\n",
                    ph, PH_CRIT_L, PH_CRIT_H);
    if (ec < EC_CRIT_L || ec > EC_CRIT_H)
      Serial.printf("         EC=%.2f fora do limite crítico [%.1f–%.1f]\n",
                    ec, EC_CRIT_L, EC_CRIT_H);
    if (temp > T_CRIT)
      Serial.printf("         Temp=%.1f°C acima do crítico (%.1f°C)\n",
                    temp, T_CRIT);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// LCD 16×2 — ACTUALIZAÇÃO DA INTERFACE LOCAL
// ═══════════════════════════════════════════════════════════════════════════

// Mensagem simples (usada na inicialização)
void lcdMensagem(const char* linha1, const char* linha2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(linha1);
  lcd.setCursor(0, 1); lcd.print(linha2);
}

void lcdMensagem(const char* linha1, String linha2) {
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print(linha1);
  lcd.setCursor(0, 1); lcd.print(linha2);
}

// Actualização das 3 páginas navegáveis
void actualizarLCD(float ph, float ec, float temp) {
  lcd.clear();

  switch (paginaLCD) {

    case 0:
      // ── Página 1: pH e EC ──────────────────────────────────────────────
      // Linha 1: "pH: 5.82 [OK]  "
      // Linha 2: "EC: 1.43 [OK]  "
      lcd.setCursor(0, 0);
      lcd.print("pH:");
      lcd.print(ph, 2);
      lcd.print(" ");
      if      (ph < PH_CRIT_L || ph > PH_CRIT_H) lcd.print("[CRIT]");
      else if (ph < PH_MIN    || ph > PH_MAX)     lcd.print("[ATN!]");
      else                                          lcd.print("[OK]  ");

      lcd.setCursor(0, 1);
      lcd.print("EC:");
      lcd.print(ec, 2);
      lcd.print("ms ");
      if      (ec < EC_CRIT_L || ec > EC_CRIT_H) lcd.print("[CRIT]");
      else if (ec < EC_MIN    || ec > EC_MAX)     lcd.print("[ATN!]");
      else                                          lcd.print("[OK]  ");
      break;

    case 1:
      // ── Página 2: Temperatura e estado de comunicação ─────────────────
      // Linha 1: "Temp: 22.3C [OK]"
      // Linha 2: "WiFi:OK  FB:OK  "
      lcd.setCursor(0, 0);
      if (temp == -999.0) {
        lcd.print("Temp: SENSOR ERR");
      } else {
        lcd.print("T:");
        lcd.print(temp, 1);
        lcd.print("C ");
        if      (temp > T_CRIT) lcd.print("[CRIT]");
        else if (temp > T_MAX)  lcd.print("[ATN!]");
        else                     lcd.print("[OK]  ");
      }

      lcd.setCursor(0, 1);
      lcd.print("WiFi:");
      lcd.print(wifiOK ? "OK" : "NO");
      lcd.print(" FB:");
      lcd.print(firebaseOK ? "OK" : "NO");
      lcd.print(alarmeActivo ? " !ALRM" : "      ");
      break;

    case 2:
      // ── Página 3: Alarmes e actuadores ────────────────────────────────
      // Linha 1: "!! ALARME !!"  ou "Sistema Normal"
      // Linha 2: Detalhe do alarme ou estado das bombas
      if (alarmeActivo) {
        lcd.setCursor(0, 0);
        lcd.print("!! ALARME !!    ");
        lcd.setCursor(0, 1);
        if      (ph < PH_CRIT_L) { lcd.print("pH BAIXO:"); lcd.print(ph,2); }
        else if (ph > PH_CRIT_H) { lcd.print("pH ALTO: "); lcd.print(ph,2); }
        else if (ec < EC_CRIT_L) { lcd.print("EC BAIXA:"); lcd.print(ec,2); }
        else if (ec > EC_CRIT_H) { lcd.print("EC ALTA: "); lcd.print(ec,2); }
        else if (temp > T_CRIT)  { lcd.print("T CRIT:  "); lcd.print(temp,1); lcd.print("C"); }
      } else {
        lcd.setCursor(0, 0);
        lcd.print("Sistema OK      ");
        lcd.setCursor(0, 1);
        // Mostrar actuação actual
        bool phDown = (ph > PH_MAX);
        bool phUp   = (ph < PH_MIN);
        bool ecDos  = (ec < EC_MIN);
        if (phDown)     lcd.print("pH Down a dosar ");
        else if (phUp)  lcd.print("pH Up a dosar   ");
        else if (ecDos) lcd.print("EC A+B a dosar  ");
        else            lcd.print("Sem actuacao    ");
      }
      break;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// TAREFA DO CORE 1 — Firebase + GSM
// ═══════════════════════════════════════════════════════════════════════════
void tarefaComunicacao(void *param) {
  TickType_t ultimoTick = xTaskGetTickCount();
  Serial.println("[Core1] Tarefa de comunicação iniciada.");

  while (true) {

    // ── Ler valores actuais com mutex ──────────────────────────────────────
    float ph, ec, temp;
    bool  alrm;
    if (xSemaphoreTake(mutexDados, pdMS_TO_TICKS(200)) == pdTRUE) {
      ph   = valorPH;
      ec   = valorEC;
      temp = valorTemp;
      alrm = alarmeActivo;
      xSemaphoreGive(mutexDados);
    } else {
      // Sem dados disponíveis — aguardar próximo ciclo
      vTaskDelayUntil(&ultimoTick, pdMS_TO_TICKS(CICLO_MS));
      continue;
    }

    // ── Verificar e reconectar Wi-Fi ───────────────────────────────────────
    wifiOK = (WiFi.status() == WL_CONNECTED);
    if (!wifiOK) {
      Serial.println("[WiFi] Desligado — a tentar reconectar...");
      WiFi.reconnect();
      vTaskDelay(pdMS_TO_TICKS(3000));
      wifiOK = (WiFi.status() == WL_CONNECTED);
    }

    // ── Comunicação Firebase ───────────────────────────────────────────────
    if (wifiOK) {
      firebaseOK = Firebase.ready();
      if (firebaseOK) {
        enviarFirebase(ph, ec, temp, alrm);
        lerSetpointsFirebase();
      } else {
        Serial.println("[Firebase] Não está pronto. A tentar reconectar...");
      }
    } else {
      Serial.println("[WiFi] Sem internet — modo local activo.");
    }

    // ── SMS de alarme crítico (apenas se sem Wi-Fi ou parâmetro crítico) ──
    // Envia SMS quando: alarme crítico activo E Wi-Fi indisponível
    if (alrm && !wifiOK) {
      enviarSMS(ph, ec, temp);
    }
    // Envia SMS mesmo com Wi-Fi em caso de temperatura crítica
    // (situação de risco que merece alerta redundante)
    if (temp > T_CRIT) {
      enviarSMS(ph, ec, temp);
      vTaskDelay(pdMS_TO_TICKS(60000));  // Não enviar SMS repetidos (aguardar 60s)
    }

    // ── Aguardar próximo ciclo ─────────────────────────────────────────────
    vTaskDelayUntil(&ultimoTick, pdMS_TO_TICKS(CICLO_MS));
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES DE COMUNICAÇÃO FIREBASE
// ═══════════════════════════════════════════════════════════════════════════

// ── ENVIAR LEITURAS AO FIREBASE ───────────────────────────────────────────────
void enviarFirebase(float ph, float ec, float temp, bool alarme) {
  // 1. Actualizar nó /actual (valores mais recentes — lidos pelo dashboard)
  FirebaseJson jsonActual;
  jsonActual.set("ph",           ph);
  jsonActual.set("ec",           ec);
  jsonActual.set("temperatura",  temp);
  jsonActual.set("alarme",       alarme);
  jsonActual.set("timestamp",    (int)(millis()/1000));

  if (Firebase.RTDB.setJSON(&fbData, FB_PATH"/actual", &jsonActual)) {
    Serial.println("[Firebase] /actual actualizado.");
  } else {
    Serial.println("[Firebase] Erro /actual: " + fbData.errorReason());
  }

  // 2. Adicionar ao histórico /leituras (push ID único gerado pelo Firebase)
  FirebaseJson jsonLeitura;
  jsonLeitura.set("ph",          ph);
  jsonLeitura.set("ec",          ec);
  jsonLeitura.set("temperatura", temp);
  jsonLeitura.set("alarme",      alarme);
  jsonLeitura.set("sistema",     SISTEMA_ID);
  // Timestamp do servidor Firebase (mais fiável que millis())
  jsonLeitura.set(".sv",         "timestamp");  // ServerValue.TIMESTAMP

  if (Firebase.RTDB.pushJSON(&fbData, FB_PATH"/leituras", &jsonLeitura)) {
    Serial.println("[Firebase] Leitura guardada no histórico.");
  } else {
    Serial.println("[Firebase] Erro histórico: " + fbData.errorReason());
  }

  // 3. Se alarme activo, registar em /alertas
  if (alarme) {
    FirebaseJson jsonAlerta;
    jsonAlerta.set("ph",         ph);
    jsonAlerta.set("ec",         ec);
    jsonAlerta.set("temperatura",temp);
    jsonAlerta.set("resolvido",  false);
    Firebase.RTDB.pushJSON(&fbData, FB_PATH"/alertas", &jsonAlerta);
    Serial.println("[Firebase] Alerta registado em /alertas.");
  }
}

// ── LER SETPOINTS DO FIREBASE (actualizados pelo operador no dashboard) ───────
void lerSetpointsFirebase() {
  if (!Firebase.ready()) return;

  // pH
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ph_min"))
    PH_MIN = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ph_max"))
    PH_MAX = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ph_crit_l"))
    PH_CRIT_L = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ph_crit_h"))
    PH_CRIT_H = fbData.floatData();
  // EC
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ec_min"))
    EC_MIN = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ec_max"))
    EC_MAX = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ec_crit_l"))
    EC_CRIT_L = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/ec_crit_h"))
    EC_CRIT_H = fbData.floatData();
  // Temperatura
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/t_max"))
    T_MAX = fbData.floatData();
  if (Firebase.RTDB.getFloat(&fbData, FB_PATH"/setpoints/t_crit"))
    T_CRIT = fbData.floatData();
  // Tempos de dosagem
  if (Firebase.RTDB.getInt(&fbData, FB_PATH"/setpoints/t_dose_ph"))
    T_DOSE_PH = fbData.intData();
  if (Firebase.RTDB.getInt(&fbData, FB_PATH"/setpoints/t_dose_ec"))
    T_DOSE_EC = fbData.intData();

  Serial.printf("[Firebase] Setpoints lidos: pH[%.1f-%.1f] EC[%.1f-%.1f] T_max=%.1f\n",
                PH_MIN, PH_MAX, EC_MIN, EC_MAX, T_MAX);
}


// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÕES GSM — ENVIO DE SMS
// ═══════════════════════════════════════════════════════════════════════════

// ── VERIFICAR SE O MÓDULO GSM ESTÁ PRONTO ────────────────────────────────────
bool gsmPronto() {
  gsmSerial.println("AT");
  delay(500);
  return gsmSerial.available() > 0;
}

// ── ENVIAR SMS AO OPERADOR ────────────────────────────────────────────────────
void enviarSMS(float ph, float ec, float temp) {
  Serial.println("[GSM] A preparar envio de SMS...");

  // Verificar se o módulo responde
  if (!gsmPronto()) {
    Serial.println("[GSM] ERRO: Módulo não responde. SMS não enviado.");
    return;
  }

  // Construir mensagem de alerta
  String msg = "ALERTA NFT NAMPULA\n";
  msg += "Sistema: " + String(SISTEMA_ID) + "\n";
  if (ph < PH_CRIT_L || ph > PH_CRIT_H)
    msg += "pH=" + String(ph, 2) + " CRITICO!\n";
  if (ec < EC_CRIT_L || ec > EC_CRIT_H)
    msg += "EC=" + String(ec, 2) + " CRITICO!\n";
  if (temp > T_CRIT)
    msg += "T=" + String(temp, 1) + "C CRITICO!\n";
  msg += "Verificar sistema urgente.";

  // Sequência de comandos AT para envio de SMS
  gsmSerial.println("AT+CMGF=1");          // Modo texto SMS
  delay(500);
  gsmSerial.println("AT+CSCS=\"GSM\"");    // Codificação de caracteres GSM
  delay(500);
  gsmSerial.println("AT+CMGS=\"" + String(GSM_NUMERO_OPERADOR) + "\"");
  delay(500);
  gsmSerial.print(msg);
  gsmSerial.write(0x1A);                   // Ctrl+Z — enviar SMS
  delay(5000);                             // Aguardar confirmação de envio

  // Ler resposta do módulo GSM
  String resposta = "";
  while (gsmSerial.available()) {
    resposta += (char)gsmSerial.read();
  }
  if (resposta.indexOf("+CMGS") >= 0) {
    Serial.println("[GSM] SMS enviado com sucesso!");
    Serial.println("[GSM] Mensagem: " + msg);
  } else {
    Serial.println("[GSM] AVISO: Confirmação de SMS não recebida.");
    Serial.println("[GSM] Resposta GSM: " + resposta);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// FUNÇÃO AUXILIAR: CALIBRAÇÃO NO MONITOR SÉRIE
// Para usar: descomentar o bloco abaixo e fazer upload, abrir Monitor Série
// ═══════════════════════════════════════════════════════════════════════════
/*
void modoCalibracaoPH() {
  Serial.println("═══════════════════════════════════════");
  Serial.println("  MODO DE CALIBRAÇÃO pH");
  Serial.println("═══════════════════════════════════════");
  Serial.println("Passo 1: Imergir eléctrodo em tampão pH 7.0");
  Serial.println("Aguardar 60 segundos...");
  delay(60000);
  long soma7 = 0;
  for (int i=0; i<20; i++) { soma7 += analogRead(PIN_PH); delay(100); }
  float ADC_7 = soma7 / 20.0;
  Serial.printf("ADC para pH 7.0: %.0f\n", ADC_7);

  Serial.println("\nPasso 2: Lavar e imergir em tampão pH 4.0");
  Serial.println("Aguardar 60 segundos...");
  delay(60000);
  long soma4 = 0;
  for (int i=0; i<20; i++) { soma4 += analogRead(PIN_PH); delay(100); }
  float ADC_4 = soma4 / 20.0;
  Serial.printf("ADC para pH 4.0: %.0f\n", ADC_4);

  float m = (7.0 - 4.0) / (ADC_7 - ADC_4);
  float b = 7.0 - m * ADC_7;
  Serial.println("\n═══ RESULTADO DA CALIBRAÇÃO ═══");
  Serial.printf("m_ph = %.6f\n", m);
  Serial.printf("b_ph = %.4f\n", b);
  Serial.println("Actualizar estes valores no código e recompilar.");
}
*/

// ═══════════════════════════════════════════════════════════════════════════
// FIM DO FIRMWARE
// ═══════════════════════════════════════════════════════════════════════════
