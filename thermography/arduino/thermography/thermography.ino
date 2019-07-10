#include <Adafruit_AMG88xx.h>
#include <Wire.h>
#include <bluefruit.h>

/**********************************************************************************************
IO / parameter
**********************************************************************************************/
#define IO_SW_ADVERT 27
#define IO_LED 2
#define IO_BATTERY A4

// Available time of BLE connection after push advert switch
#define BLE_AVAILABLE_TIME 60       // Advertising time for after push button
#define SCAN_AVAILABLE_TIME 60 * 5  // Enable for transmit scan data (5min)

// BLE parapeter
#define BLE_DEV_NAME "LINE BLE Thermography"
#define BLE_DEV_MODEL "LINE-BLE_THERMOGRAPY"
//#define BLE_DEV_NAME "LINE"
//#define BLE_DEV_MODEL "LINE-BLE"
#define BLE_DEV_MANUFACTURER "LINE"

#define USER_DEBUG  // debug on/off

#define BLE_MAX_PRPH_CONNECTION 3

/**********************************************************************************************
Device Information Service
**********************************************************************************************/
BLEDis bledis;

/**********************************************************************************************
Battery Service
**********************************************************************************************/
BLEBas blebas;

/**********************************************************************************************
Software timer by FreeRTOS
**********************************************************************************************/
SoftwareTimer timer_led;

SoftwareTimer timer_baterry;

SoftwareTimer timer_advert;
volatile int timer_advert_time = BLE_AVAILABLE_TIME;

SoftwareTimer timer_scan;
volatile int timer_scan_time = SCAN_AVAILABLE_TIME;

/**********************************************************************************************
AMG8833 Sensor
**********************************************************************************************/
float pixels[AMG88xx_PIXEL_ARRAY_SIZE];
Adafruit_AMG88xx amg;

/*********************************************************************************
 * Debug print
 *********************************************************************************/
void debugPrint(String text) {
#ifdef USER_DEBUG
    text = "[DBG]" + text;
    Serial.println(text);
#endif
}

void debugText(String ch) {
#ifdef USER_DEBUG
    Serial.print(ch);
#endif
}

/**********************************************************************************************
LINE PSDI Service
**********************************************************************************************/
// UUID Version-4
uint8_t blesv_line_uuid[16] = {  // e625601e-9e55-4597-a598-76018a0d293d
    //{ 0xe6, 0x25, 0x60, 0x1e, 0x9e, 0x55, 0x45, 0x97, 0xa5, 0x98, 0x76, 0x01,
    // 0x8a, 0x0d, 0x29, 0x3d } ;
    0x3d, 0x29, 0x0d, 0x8a, 0x01, 0x76, 0x98, 0xa5,
    0x97, 0x45, 0x55, 0x9e, 0x1e, 0x60, 0x25, 0xe6};
uint8_t blesv_line_product_uuid[16] = {  // 26e2b12b-85f0-4f3f-9fdd-91d114270e6e
    //{ 0x26, 0xe2, 0xb1, 0x2b, 0x85, 0xf0, 0x4f, 0x3f, 0x9f, 0xdd, 0x91, 0xd1,
    // 0x14, 0x27, 0x0e, 0x6e } ;
    0x6e, 0x0e, 0x27, 0x14, 0xd1, 0x91, 0xdd, 0x9f,
    0x3f, 0x4f, 0xf0, 0x85, 0x2b, 0xb1, 0xe2, 0x26};

BLEService blesv_line = BLEService(blesv_line_uuid);
BLECharacteristic blesv_line_product = BLECharacteristic(
    blesv_line_product_uuid);  // Product Specific(Read, 16Byte)

/**********************************************************************************************
User Service
**********************************************************************************************/
// UUID Version-4
uint8_t blesv_cmd_uuid[16] = {  // 0147088e-4efd-40fa-95f3-e6c7a1285607
    0x07, 0x56, 0x28, 0xa1, 0xc7, 0xe6, 0xf3, 0x95,
    0xfa, 0x40, 0xfd, 0x4e, 0x8e, 0x08, 0x47, 0x01};
uint8_t blesv_cmd_cmd_uuid[16] = {  // 95243321-cb66-4137-802f-4cb51fd4818d
    //{ 0x95, 0x24, 0x33, 0x21, 0xcb, 0x66, 0x41, 0x37, 0x80, 0x2f, 0x4c, 0xb5,
    // 0x1f, 0xd4, 0x81, 0x8d } ;
    0x8d, 0x81, 0xd4, 0x1f, 0xb5, 0x4c, 0x2f, 0x80,
    0x37, 0x41, 0x66, 0xcb, 0x21, 0x33, 0x24, 0x95};
uint8_t blesv_cmd_temp_uuid[16] = {  // 943f94a6-3a7e-45df-8614-1e5f61fe334f
    //{ 0x94, 0x3f, 0x94, 0xa6, 0x3a, 0x7e, 0x45, 0xdf, 0x86, 0x14, 0x1e, 0x5f,
    // 0x61, 0xfe, 0x33, 0x4f } ;
    0x4f, 0x33, 0xfe, 0x61, 0x5f, 0x1e, 0x14, 0x86,
    0xdf, 0x45, 0x7e, 0x3a, 0xa6, 0x94, 0x3f, 0x94};

BLEService blesv_cmd = BLEService(blesv_cmd_uuid);

BLECharacteristic blesv_cmd_cmd =
    BLECharacteristic(blesv_cmd_cmd_uuid);  // format([31:24]CMD,
                                            // [23:8]reserved, [7:0]parameter0})
/*
Command : 0 (do not support)
    Sleep
    {[31:24]CMD, [23:0]reserved}
Command : 1 (do not support)
    Wakeup
    {[31:24]CMD, [23:0]reserved}
Command : 2 (do not support)
    Scan Start
    {[31:24]CMD, [23:8]reserved, [7:0]scantime}    //scantime ; how second
Command : 4
    Singleshot transmit(for debug)
    {[31:24]CMD, [23:0]reserved}
*/

BLECharacteristic blesv_cmd_temp =
    BLECharacteristic(blesv_cmd_temp_uuid);  // 16Byte

/* Format of blesv_cmd_temp

* Temp Matrix format (x, y)
(0,0), (0,1), ..., (0.7)
(1,0), (1,1), ..., (1.7)
........................
(7,0), (7,1), ..., (7.7)


* Transmit data format
Single transaction 16Byte = {[0,0], [0,1], ..., [1,7]}

* Single transaction format
Single transaction 1Byte ={
    [0,0] = {v-address-1[7], temp(0,0)[6:0]}
    [0,1] = {v-address-0[7], temp(0,1)[6:0]}
    [0,2] = {reaseved[7], temp(0,2)[6:0]}
    [0,3] = {reaseved[7], temp(0,3)[6:0]}
    [0,4] = {reaseved[7], temp(0,4)[6:0]}
    [0,5] = {reaseved[7], temp(0,5)[6:0]}
    [0,6] = {reaseved[7], temp(0,6)[6:0]}
    [0,7] = {reaseved[7], temp(0,7)[6:0]}
    [1,0] = {reaseved[7], temp(1,0)[6:0]}
    [1,1] = {reaseved[7], temp(1,1)[6:0]}
    ...
    [1,7] = {reaseved[7], temp(1,7)[6:0]}
}

* About the v-address
    v-address =	0 : Transaction0 = temp_matrix[0,0] to temp_matrix[1:7]
                            1 : Transaction1 = temp_matrix[2,0] to
temp_matrix[3:7] 2 : Transaction2 = temp_matrix[4,0] to temp_matrix[5:7] 3 :
Transaction3 = temp_matrix[6,0] to temp_matrix[7:7]
*/

/**********************************************************************************************
BLE Setup and start
**********************************************************************************************/
void bleAdvert_start(void) {
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addTxPower();
    Bluefruit.Advertising.setFastTimeout(30);
    Bluefruit.Advertising.setInterval(
        32, 2056);  // interval : fast=20ms, slow:1285ms(unit of 0.625ms)
    Bluefruit.Advertising.restartOnDisconnect(true);

    // Addition Service UUID
    // Bluefruit.Advertising.addService(blesv_line);
    Bluefruit.Advertising.addService(blesv_cmd);
    Bluefruit.ScanResponse.addName();
    // Start
    Bluefruit.Advertising.start();
}

void bleServiceLine_setup(void) {
    blesv_line.begin();
    blesv_line_product.setProperties(CHR_PROPS_READ);
    blesv_line_product.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_line_product.setFixedLen(sizeof(uint32_t) * 2);
    blesv_line_product.begin();
    uint32_t deviceAddr[] = {NRF_FICR->DEVICEADDR[0], NRF_FICR->DEVICEADDR[1]};
    blesv_line_product.write(deviceAddr, sizeof(deviceAddr));
}

void bleServiceCmd_setup() {
    blesv_cmd.begin();

    blesv_cmd_cmd.setProperties(CHR_PROPS_WRITE);
    blesv_cmd_cmd.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_cmd_cmd.setWriteCallback(event_ble_cmd);
    blesv_cmd_cmd.setFixedLen(4);
    blesv_cmd_cmd.begin();

    blesv_cmd_temp.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
    blesv_cmd_temp.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_cmd_temp.setFixedLen(16);
    blesv_cmd_temp.begin();
}

/**********************************************************************************************
Event
**********************************************************************************************/
// Event for LED and count up(RTOS timer event)
void event_led(TimerHandle_t xTimerID) {
    digitalWrite(IO_LED, !digitalRead(IO_LED));
}

void event_baterry(TimerHandle_t xTimerID) {
    blebas.write(getBatteryLevel());  // Baterry = 0~100%
}

volatile int g_connection_count = 0;
// Event for connect BLE central
void event_ble_connect(uint16_t conn_handle) {
    char central_name[32] = {0};

    g_connection_count = (uint8_t) Bluefruit.Periph.connected();

    BLEConnection *connection = Bluefruit.Connection(conn_handle);
    connection->getPeerName(central_name, sizeof(central_name));

    String msg = "Connected from " + String(central_name);
    Serial.println(msg);

    if (g_connection_count < BLE_MAX_PRPH_CONNECTION) {
        // new_connection_flag = 1;
        Bluefruit.Advertising.start(0);
    }
}

// Event for disconnect BLE central
void event_ble_disconnect(uint16_t conn_handle, uint8_t reason) {
    (void) reason;
    (void) conn_handle;
    debugPrint("BLE central disconnect");
}

// Event for scan sensor timing
void event_scan(TimerHandle_t xTimerID) {
    if (timer_scan_time < 0) {
        timer_scan.stop();
    } else {
        timer_scan_time--;
    }
}

// Event for scan sensor timing
void event_advert(TimerHandle_t xTimerID) {
    if (timer_advert_time < 0) {
        timer_advert.stop();
        timer_led.stop();
        digitalWrite(IO_LED, 0);
    } else {
        timer_advert_time--;
    }
}

void swChangedEvent() {
    timer_advert_time = BLE_AVAILABLE_TIME;
}

// void event_ble_bitmap_seq_16byte(BLECharacteristic& chr, uint8_t* data,
// uint16_t len, uint16_t offset){
volatile int singleshot = 0;
void event_ble_cmd(uint16_t conn_handle, BLECharacteristic *chr, uint8_t *data,
                   uint16_t len) {
    uint8_t cmd = data[0];
    uint8_t value = data[3];

    if (cmd == 0) {
        // Sleep
        debugPrint("BLE Event : Set sleep mode(do not suppot yet)");
    } else if (cmd == 1) {
        // Wakeup
        debugPrint("BLE Event : Set wakeup mode(do not suppot yet)");
    } else if (cmd == 3) {
        debugPrint("BLE Event : Set Interval(do not suppot yet)");
    } else if (cmd == 4) {
        // Read sensor
        singleshot = 1;
        debugPrint("BLE Event : DBG:Singleshot");
    } else {
        debugPrint("BLE Event : Error - undefined command");
    }
}

/**********************************************************************************************
IO function and Setup
**********************************************************************************************/
void setup_io() {
    // Switch
    pinMode(IO_SW_ADVERT, INPUT_PULLUP);

    // LED
    pinMode(IO_LED, OUTPUT);
    digitalWrite(IO_LED, 0);

    // ADC setup for battery
    analogReference(AR_INTERNAL_1_2);  // ADC reference = 1.2V
    analogReadResolution(10);          // ADC 10bit

    // interrupt
    attachInterrupt(IO_SW_ADVERT, swChangedEvent, RISING);
}

uint8_t getBatteryLevel() {
    int baterry_data = 0;
    uint8_t result;
    int battery_data;

    // Load Battery value
    battery_data = analogRead(IO_BATTERY);   // 10bit @1.2Vref
    battery_data += analogRead(IO_BATTERY);  // 10bit @1.2Vref
    battery_data += analogRead(IO_BATTERY);  // 10bit @1.2Vref
    battery_data += analogRead(IO_BATTERY);  // 10bit @1.2Vref
    battery_data = battery_data / 4;

    if (battery_data < 682) {  // when baterry < 2.4V
        result = 0;
    } else if (battery_data > 853) {
        result = 100;
    } else {
        result = map(battery_data, 682, 853, 0, 100);
    }

    return result;
}

void setLowPowerMode() {
    NRF_SPI0->ENABLE = 0;          // disable SPI0
    NRF_SPI1->ENABLE = 0;          // disable SPI1
    NRF_SPI2->ENABLE = 0;          // disable SPI2
    NRF_RADIO->TASKS_DISABLE = 1;  // disable BLE
}

void clearLowPowerMode() {
    NRF_SPI0->ENABLE = 1;          // enable SPI0
    NRF_SPI1->ENABLE = 1;          // enable SPI1
    NRF_SPI2->ENABLE = 1;          // enable SPI2
    NRF_RADIO->TASKS_DISABLE = 0;  // enable BLE
}

void systemStart() {
    // Going to normal mode
    clearLowPowerMode();

    // BLE start
    Bluefruit.begin(BLE_MAX_PRPH_CONNECTION, 0);
    // BEL set power
    Bluefruit.setTxPower(-12);  // Set max power. Accepted values are: -40, -30,
                                // -20, -16, -12, -8, -4, 0, 4

    // BLE devicename
    Bluefruit.setName(BLE_DEV_NAME);
    Bluefruit.Periph.setConnInterval(
        12, 1600);  // connection interval min=20ms, max=2s
    // Set the connect/disconnect callback handlers
    Bluefruit.Periph.setConnectCallback(event_ble_connect);
    Bluefruit.Periph.setDisconnectCallback(event_ble_disconnect);

    // Configure Device Information Service
    bledis.setManufacturer(BLE_DEV_MANUFACTURER);
    bledis.setModel(BLE_DEV_MODEL);
    bledis.begin();

    // Configure Battery searcive
    blebas.begin();
    blebas.write(getBatteryLevel());  // Baterry = 0~100%

    // Start Services
    bleServiceLine_setup();
    bleServiceCmd_setup();

    // Setup and start advertising
    bleAdvert_start();

    // Set timer for LED
    timer_led.begin(500, event_led);

    timer_baterry.begin(5000, event_baterry);
    timer_baterry.start();

    timer_scan.begin(1000, event_scan);
    timer_advert.begin(1000, event_advert);
}

/*************************************************************
LED Status
    0 	: Waiting for advert switch or connected BLE central
    1 	: Low power or EPD init failed
    0/1	: Adverting
*************************************************************/
void setup() {
    Serial.begin(9600);
    setup_io();
    // Enable internal DC-DC for reduce power
    NRF_POWER->DCDCEN = 1;
    // NRF off
    NRF_NFCT->TASKS_DISABLE = 1;  // disable NFC
    delay(100);

    /*
    // Go to low power mode
    setLowPowerMode();
    // Wait for Advert Switch
    do {
        __WFI();  // Wait for interrupt
    } while (digitalRead(IO_SW_ADVERT) == 1);

    // Start BLE & peripheral service
    systemStart();
    */
    debugPrint("system start");
}

void transmitTempData() {
    // pixels
    int i, j;
    uint8_t tx_data[16];
    for (i = 0; i < 4; i++) {
        for (j = 0; j < 16; j++) {
            tx_data[j] = (uint8_t) pixels[i * 16 + j];
        }
        // Add V-Addr
        tx_data[0] = (tx_data[0] & 0x7f) + ((i & 0x1) << 7);
        tx_data[1] = (tx_data[1] & 0x7f) + ((i & 0x2) << 6);

        // Transmit to BLE
        for (uint8_t k = 0; k < BLE_MAX_PRPH_CONNECTION; k++) {
            blesv_cmd_temp.notify(k, tx_data, sizeof(tx_data));
        }

        for (int k = 0; k < 16; k++) {
            debugText(String(tx_data[k] & 0x7f));
            debugText(", ");
            if (k == 7) {
                debugPrint("");
            }
        }
        debugPrint("");
    }
    debugPrint("-----------------------");
}

void loop() {
SLEEP:
    // waiting for push advert button
    setLowPowerMode();  // Go to low power mode
    do {
        __WFI();  // Wait for interrupt
    } while (digitalRead(IO_SW_ADVERT) == 1);
    systemStart();  // Start BLE & peripheral service
    delay(500);
    timer_advert.start();
    timer_led.start();
    debugPrint("Advert start");

    // Waiting for connect central
    while (g_connection_count == 0) {
        if (timer_advert_time == 0) {
            goto SLEEP;
        }
    }

    // Sensor init
    if (!amg.begin(0x68)) {
        debugPrint("AMG Sensor - init error");
        for (;;)
            ;
    }
    debugPrint("AMG Sensor - init done");
    // Read Sensor and Transmit to data
    debugPrint("Scan start");
    timer_scan.start();
    timer_scan_time = SCAN_AVAILABLE_TIME;
    while (timer_scan_time >= 0) {
        amg.readPixels(pixels);

        if (Bluefruit.connected()) {
            // Transmit temp data by BLE
            transmitTempData();
        }

        if (singleshot == 1) {
            for (;;)
                ;
        }
        delay(200);
    }
    timer_scan.stop();
    timer_scan_time = 0;
}
