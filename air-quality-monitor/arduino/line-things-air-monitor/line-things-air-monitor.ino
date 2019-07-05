#include <Adafruit_BME280.h>
#include <Adafruit_LittleFS.h>
#include <Adafruit_Sensor.h>
#include <InternalFileSystem.h>
#include <Wire.h>
#include <bluefruit.h>
#include "Adafruit_CCS811.h"
using namespace Adafruit_LittleFS_Namespace;

Adafruit_CCS811 ccs;

#define BLE_DEV_NAME "LINE Things air monitor"
#define FIRMWARE_VERSION 1

// Debug On / Off
#define USER_DEBUG

#define SEALEVELPRESSURE_HPA (1013.25)
#define BLE_MAX_PRPH_CONNECTION 3

/*********************************************************************************
 * Type define
 *********************************************************************************/

/* MODE_NORMAL
mode = 0:
  notify always. ignore triger level

mode = 1:
  notify using triger
 */

typedef struct action_conf {
    int mode;
    int power;
    int battery_thd;
    int notify_interval;
    float temp_thd;
    float humidity_thd;
    int pressure_thd;
    int co2_thd;
    int tvoc_thd;
} actionConf;

/*********************************************************************************
 * Internal config file
 *********************************************************************************/
#define FILENAME "/config.txt"
File file(InternalFS);

/*********************************************************************************
 * IO
 *********************************************************************************/
#define IO_BATTERY 28
#define IO_SW 27
#define IO_LED 2

/*********************************************************************************
 * Debug print
 *********************************************************************************/
void debugPrint(String text) {
#ifdef USER_DEBUG
    text = "[DBG]" + text;
    Serial.println(text);
#endif
}

/*********************************************************************************
 * Callback
 *********************************************************************************/
volatile int g_notify_flag = 0;
SoftwareTimer timerNotify;
void notifyTiming(TimerHandle_t xTimerID) {
    g_notify_flag = 1;
}

SoftwareTimer ledControl;
void ledControlEvent(TimerHandle_t xTimerID) {
    digitalWrite(IO_LED, !digitalRead(IO_LED));
}

volatile int g_reload_request_flag;
void swChangedEvent() {
    g_reload_request_flag = 1;
}

/*********************************************************************************
 * UUID Configure data
 *********************************************************************************/
void configFileWrite(actionConf conf) {
    int i = 0;
    if (file.open(FILENAME, FILE_O_WRITE)) {
        file.seek(0);
        int16_t configdata[9] = {conf.mode,         conf.power,
                                 conf.battery_thd,  conf.notify_interval,
                                 conf.temp_thd,     conf.humidity_thd,
                                 conf.pressure_thd, conf.co2_thd,
                                 conf.tvoc_thd};
        file.write((uint8_t *) configdata, sizeof(configdata));
        file.close();
        debugPrint("[Flash] Write config file : done");
    } else {
        debugPrint("[Flash][ERROR] Write config file : Failed!");
    }
}

void configFileRead(actionConf *conf) {
    int16_t configdata[9];
    file.open(FILENAME, FILE_O_READ);
    file.read(configdata, sizeof(configdata));
    file.close();

    conf->mode = configdata[0];
    conf->power = configdata[1];
    conf->battery_thd = configdata[2];
    conf->notify_interval = configdata[3];
    conf->temp_thd = configdata[4];
    conf->humidity_thd = configdata[5];
    conf->pressure_thd = configdata[6];
    conf->co2_thd = configdata[7];
    conf->tvoc_thd = configdata[8];
}

int configFileExist() {
    file.open(FILENAME, FILE_O_READ);
    if (!file) {
        file.close();
        return -1;
    }
    file.close();
    return 0;
}

/*********************************************************************************
BLE settings
*********************************************************************************/
#define USER_SERVICE_UUID "a5c99838-899c-4483-ace7-3335055763c4"
#define USER_CHARACTERISTIC_READ_UUID "afa3eda0-a8f8-449e-9814-7dfc35953af5"
#define USER_CHARACTERISTIC_WRITE_UUID "f9ec0b7d-70cf-4146-b971-9995bdd54ff4"
#define USER_CHARACTERISTIC_RELOAD_UUID "3325ccfa-4e3a-42c1-a17b-f959061cb6fb"
#define USER_CHARACTERISTIC_NOTIFY_UUID "d5e86560-6c91-4947-bb7b-b17540622586"
#define PSDI_SERVICE_UUID "e625601e-9e55-4597-a598-76018a0d293d"
#define PSDI_CHARACTERISTIC_UUID "26e2b12b-85f0-4f3f-9fdd-91d114270e6e"

// LINE PSDI
uint8_t blesv_line_uuid[16];
uint8_t blesv_line_product_uuid[16];
BLEService blesv_line = BLEService(blesv_line_uuid);
BLECharacteristic blesv_line_product = BLECharacteristic(
    blesv_line_product_uuid);  // Product Specific(Read, 16Byte)

// User Service
uint8_t blesv_user_uuid[16];
uint8_t blesv_user_read_uuid[16];
uint8_t blesv_user_write_uuid[16];
uint8_t blesv_user_reload_uuid[16];
uint8_t blesv_user_notify_uuid[16];
BLEService blesv_user = BLEService(blesv_user_uuid);
BLECharacteristic blesv_user_read = BLECharacteristic(blesv_user_read_uuid);
BLECharacteristic blesv_user_write = BLECharacteristic(blesv_user_write_uuid);
BLECharacteristic blesv_user_reload = BLECharacteristic(blesv_user_reload_uuid);
BLECharacteristic blesv_user_notify = BLECharacteristic(blesv_user_notify_uuid);

// UUID Converter
void strUUID2Bytes(String strUUID, uint8_t binUUID[]) {
    String hexString = String(strUUID);
    hexString.replace("-", "");

    for (int i = 16; i != 0; i--) {
        binUUID[i - 1] =
            hex2c(hexString[(16 - i) * 2], hexString[((16 - i) * 2) + 1]);
    }
}

char hex2c(char c1, char c2) {
    return (nibble2c(c1) << 4) + nibble2c(c2);
}

char nibble2c(char c) {
    if ((c >= '0') && (c <= '9')) return c - '0';
    if ((c >= 'A') && (c <= 'F')) return c + 10 - 'A';
    if ((c >= 'a') && (c <= 'f')) return c + 10 - 'a';
    return 0;
}

void bleConfigure() {
    // UUID setup
    strUUID2Bytes(PSDI_SERVICE_UUID, blesv_line_uuid);
    strUUID2Bytes(PSDI_CHARACTERISTIC_UUID, blesv_line_product_uuid);
    strUUID2Bytes(USER_SERVICE_UUID, blesv_user_uuid);
    strUUID2Bytes(USER_CHARACTERISTIC_READ_UUID, blesv_user_read_uuid);
    strUUID2Bytes(USER_CHARACTERISTIC_WRITE_UUID, blesv_user_write_uuid);
    strUUID2Bytes(USER_CHARACTERISTIC_RELOAD_UUID, blesv_user_reload_uuid);
    strUUID2Bytes(USER_CHARACTERISTIC_NOTIFY_UUID, blesv_user_notify_uuid);

    // BLE start
    Bluefruit.begin(BLE_MAX_PRPH_CONNECTION, 0);
    // BEL set power
    Bluefruit.setTxPower(-16);  // Set max power. Accepted values are: -40, -30,
                                // -20, -16, -12, -8, -4, 0, 4

    // BLE devicename
    Bluefruit.setName(BLE_DEV_NAME);
    Bluefruit.Periph.setConnInterval(
        12, 1600);  // connection interval min=20ms, max=2s

    // Set the connect/disconnect callback handlers
    Bluefruit.Periph.setConnectCallback(event_ble_connect);
    Bluefruit.Periph.setDisconnectCallback(event_ble_disconnect);
}

void bleAdvert_start(void) {
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addTxPower();
    Bluefruit.Advertising.setFastTimeout(30);
    Bluefruit.Advertising.setInterval(
        32, 32);  // interval : fast=20ms, slow:32ms(unit of 0.625ms)
    Bluefruit.Advertising.restartOnDisconnect(true);

    // Addition Service UUID
    Bluefruit.Advertising.addService(
        blesv_user);  // LINE app側で発見するためにUser service
                      // UUIDを必ずアドバタイズパケットに含める
    Bluefruit.ScanResponse.addName();
    // Start
    Bluefruit.Advertising.start();
}

void bleServicePsdi_setup(void) {
    blesv_line.begin();
    blesv_line_product.setProperties(CHR_PROPS_READ);
    blesv_line_product.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_line_product.setFixedLen(sizeof(uint32_t) * 2);
    blesv_line_product.begin();
    uint32_t deviceAddr[] = {NRF_FICR->DEVICEADDR[0], NRF_FICR->DEVICEADDR[1]};
    blesv_line_product.write(deviceAddr, sizeof(deviceAddr));
}

void bleServiceUser_setup() {
    blesv_user.begin();

    blesv_user_notify.setProperties(CHR_PROPS_NOTIFY);
    blesv_user_notify.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_user_notify.setFixedLen(16);
    blesv_user_notify.begin();

    blesv_user_read.setProperties(CHR_PROPS_READ);
    blesv_user_read.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_user_read.setFixedLen(18);
    blesv_user_read.begin();

    blesv_user_write.setProperties(CHR_PROPS_WRITE);
    blesv_user_write.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_user_write.setWriteCallback(event_ble_write);
    blesv_user_write.setFixedLen(18);
    blesv_user_write.begin();

    blesv_user_reload.setProperties(CHR_PROPS_WRITE);
    blesv_user_reload.setPermission(SECMODE_ENC_NO_MITM, SECMODE_ENC_NO_MITM);
    blesv_user_reload.setWriteCallback(event_ble_reload);
    blesv_user_reload.setFixedLen(1);
    blesv_user_reload.begin();
}

// Event for connect BLE central
volatile int connection_count = 0;
volatile uint16_t last_connect_hdl = 0;
volatile int new_connection_flag = 0;
void event_ble_connect(uint16_t conn_handle) {
    char central_name[32] = {0};

    // connection_count++;
    connection_count = (uint8_t) Bluefruit.Periph.connected();

    BLEConnection *connection = Bluefruit.Connection(conn_handle);
    connection->getPeerName(central_name, sizeof(central_name));

    String msg = "[BLE]Connected from " + String(central_name) +
                 ". Available connection count " + String(connection_count);
    ;
    debugPrint(msg);

    ledControl.start();
    // g_reload_request_flag = 1;
    last_connect_hdl = conn_handle;
    new_connection_flag = 1;

    if (connection_count < BLE_MAX_PRPH_CONNECTION) {
        Bluefruit.Advertising.start(0);
    }
}

// Event for disconnect BLE central
void event_ble_disconnect(uint16_t conn_handle, uint8_t reason) {
    char central_name[32] = {0};

    // connection_count--;
    connection_count = (uint8_t) Bluefruit.Periph.connected();

    BLEConnection *connection = Bluefruit.Connection(conn_handle);
    connection->getPeerName(central_name, sizeof(central_name));

    String msg = "[BLE]Disconnect from " + String(central_name) +
                 ". Available connection count " + String(connection_count);
    debugPrint(msg);

    g_reload_request_flag = 0;
    Bluefruit.Advertising.start(0);
}

volatile int g_write_config_flag = 0;
volatile actionConf g_write_config;
void event_ble_write(uint16_t conn_handle, BLECharacteristic *chr,
                     uint8_t *data, uint16_t len) {
    g_write_config.mode = data[1] * 256 + data[0];
    g_write_config.power = data[3] * 256 + data[2];
    g_write_config.notify_interval = data[5] * 256 + data[4];
    g_write_config.battery_thd = data[7] * 256 + data[6];
    g_write_config.temp_thd = (data[9] * 256 + data[8]) / 100;
    g_write_config.humidity_thd = (data[11] * 256 + data[10]) / 100;
    g_write_config.pressure_thd = data[13] * 256 + data[12];
    g_write_config.co2_thd = data[15] * 256 + data[14];
    g_write_config.tvoc_thd = data[17] * 256 + data[16];
    g_write_config_flag = 1;
}

void event_ble_reload(uint16_t conn_handle, BLECharacteristic *chr,
                      uint8_t *data, uint16_t len) {
    // g_reload_request_flag = 1;
    last_connect_hdl = conn_handle;
    new_connection_flag = 1;
}

/*********************************************************************************
Sensor
*********************************************************************************/
uint8_t getBatteryLevel() {
    int baterry_data = 0;
    uint8_t result;
    int battery_data;

    // Load Battery value | 10bit @1.2Vref
    battery_data = analogRead(IO_BATTERY);
    battery_data += analogRead(IO_BATTERY);
    battery_data += analogRead(IO_BATTERY);
    battery_data += analogRead(IO_BATTERY);
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

Adafruit_BME280 bme;

/*********************************************************************************
Setup
*********************************************************************************/
void setup() {
    actionConf config;

    // Pin config
    pinMode(IO_LED, OUTPUT);
    digitalWrite(IO_LED, 0);
    pinMode(IO_SW, INPUT_PULLUP);

    // Interrupt
    attachInterrupt(IO_SW, swChangedEvent, RISING);

    // Serial通信初期化
    Serial.begin(115200);

    // Enable low power feature
    sd_power_mode_set(NRF_POWER_MODE_LOWPWR);
    sd_power_dcdc_mode_set(NRF_POWER_DCDC_ENABLE);
    delay(500);

    // Sensor init
    if (!ccs.begin()) {
        debugPrint("Sensor ERROR");
        while (1)
            ;
    }

    if (!bme.begin(BME280_ADDRESS_ALTERNATE, &Wire)) {
        debugPrint("Could not find a valid BME280 sensor, check wiring!");
        while (1)
            ;
    }
    bme.setSampling(Adafruit_BME280::MODE_NORMAL,
                    Adafruit_BME280::SAMPLING_X2,   // temperature
                    Adafruit_BME280::SAMPLING_X16,  // pressure
                    Adafruit_BME280::SAMPLING_X1,   // humidity
                    Adafruit_BME280::FILTER_X16,
                    Adafruit_BME280::STANDBY_MS_0_5);

    // ADC setup for battery
    analogReference(AR_INTERNAL_1_2);  // ADC reference = 1.2V
    analogReadResolution(10);          // ADC 10bit

    // BLEの設定
    bleConfigure();
    bleServicePsdi_setup();
    bleServiceUser_setup();
    bleAdvert_start();

    // Config file
    if (configFileExist() == -1) {
        config.mode = 0;
        config.power = 0;
        config.battery_thd = 20;
        config.notify_interval = 10;
        config.temp_thd = 35;
        config.humidity_thd = 30;
        config.pressure_thd = 1000;
        config.co2_thd = 1000;
        config.tvoc_thd = 400;
        configFileWrite(config);
    } else {
        configFileRead(&config);
    }

    int16_t config_frame[9] = {
        config.mode,           config.power,
        config.battery_thd,    config.notify_interval,
        config.temp_thd * 100, config.humidity_thd * 100,
        config.pressure_thd,   config.co2_thd,
        config.tvoc_thd,
    };
    blesv_user_read.write((uint8_t *) config_frame, sizeof(config_frame));

    debugPrint("-----------------------------");
    debugPrint("Initial settings");
    debugPrint("Mode : " + String(config.mode));
    debugPrint("BLE Transmit power : " + String(config.power));
    debugPrint("Battery : " + String(config.battery_thd) + "%");
    debugPrint("Interval : " + String(config.notify_interval) + "Sec");
    debugPrint("Temp : " + String(config.temp_thd) + "");
    debugPrint("Humidity : " + String(config.humidity_thd) + "%");
    debugPrint("Pressure : " + String(config.pressure_thd) + "hPa");
    debugPrint("CO2 : " + String(config.co2_thd) + "ppm");
    debugPrint("TVOC : " + String(config.tvoc_thd) + "ppm");
    debugPrint("-----------------------------");

    // Configure Timer
    timerNotify.begin(config.notify_interval * 1000, notifyTiming);
    timerNotify.start();
    ledControl.begin(500, ledControlEvent);

    debugPrint("[Initial]Init done");
    user_loop(config);
}

typedef struct action_value {
    int battery;
    float temp;
    float humidity;
    float pressure;
    int co2;
    int tvoc;
    float altitude;
} actionValue;

void user_loop(actionConf config) {
    actionValue sens_value;

    while (1) {
        if (Bluefruit.connected()) {
            if (g_reload_request_flag || g_notify_flag || new_connection_flag) {
                sens_value.battery = getBatteryLevel();
                sens_value.temp = bme.readTemperature();
                sens_value.pressure = bme.readPressure() / 100.0F;
                sens_value.humidity = bme.readHumidity();
                sens_value.altitude = bme.readAltitude(SEALEVELPRESSURE_HPA);

                // Set offset value for CO2 sensor
                while (!ccs.available())
                    ;
                float temp = ccs.calculateTemperature();
                ccs.setTempOffset(sens_value.temp);
                // Load CO2 / TVOC value
                if (ccs.available()) {
                    ccs.readData();
                    sens_value.co2 = ccs.geteCO2();
                    sens_value.tvoc = ccs.getTVOC();
                } else {
                    debugPrint("[CO2][Error] Load CO2 sensor failed");
                }
                /*
                debugPrint("-----------------------------");
                debugPrint("Battery : " + String(sens_value.battery) + "%");
                debugPrint("Temperature : " + String(sens_value.temp) + "");
                debugPrint("Humidity : " + String(sens_value.humidity) + "%");
                debugPrint("Pressure : " + String(sens_value.pressure) + "hPa");
                debugPrint("Altitude : " + String(sens_value.altitude) + "m");
                debugPrint("CO2 : " + String(sens_value.co2) + "ppm");
                debugPrint("TVOC : " + String(sens_value.tvoc) + "ppm");
                */
                if (g_reload_request_flag || new_connection_flag ||
                    (g_notify_flag && config.mode == 0) ||
                    (g_notify_flag && config.mode == 1 &&
                     (config.battery_thd > sens_value.battery ||
                      config.temp_thd < sens_value.temp ||
                      config.humidity_thd > sens_value.humidity ||
                      config.pressure_thd > sens_value.pressure ||
                      config.co2_thd < sens_value.co2 ||
                      config.tvoc_thd < sens_value.tvoc))) {
                    int16_t tx_frame[8] = {
                        sens_value.battery,  sens_value.temp,
                        sens_value.humidity, sens_value.pressure,
                        sens_value.co2,      sens_value.tvoc,
                        sens_value.altitude, 0};

                    if (new_connection_flag) {
                        // This is one shot notify for after connect
                        delay(2000);
                        blesv_user_notify.notify(last_connect_hdl,
                                                 (uint8_t *) tx_frame,
                                                 sizeof(tx_frame));
                        new_connection_flag = 0;
                        debugPrint("[BLE]Notify data to conn_hdl : " +
                                   String(last_connect_hdl));
                    } else {
                        for (uint8_t conn_hdl = 0;
                             conn_hdl < BLE_MAX_PRPH_CONNECTION; conn_hdl++) {
                            blesv_user_notify.notify(conn_hdl,
                                                     (uint8_t *) tx_frame,
                                                     sizeof(tx_frame));
                        }
                        debugPrint("[BLE]Notify data to all");
                    }
                }
                g_reload_request_flag = 0;
            }

            // Write setting data to buffer
            if (g_write_config_flag) {
                // config = g_write_config;
                config.mode = g_write_config.mode;
                config.power = g_write_config.power;
                config.battery_thd = g_write_config.battery_thd;
                config.notify_interval = g_write_config.notify_interval;
                config.temp_thd = g_write_config.temp_thd;
                config.humidity_thd = g_write_config.humidity_thd;
                config.pressure_thd = g_write_config.pressure_thd;
                config.co2_thd = g_write_config.co2_thd;
                config.tvoc_thd = g_write_config.tvoc_thd;
                configFileWrite(config);
                int16_t config_frame[9] = {
                    config.mode,           config.power,
                    config.battery_thd,    config.notify_interval,
                    config.temp_thd * 100, config.humidity_thd * 100,
                    config.pressure_thd,   config.co2_thd,
                    config.tvoc_thd,
                };
                blesv_user_read.write((uint8_t *) config_frame,
                                      sizeof(config_frame));

                // Set BLE power
                Bluefruit.setTxPower(config.power);

                // Write CO2 sensor drive mode
                if (config.notify_interval < 2) {
                    ccs.setDriveMode(CCS811_DRIVE_MODE_250MS);
                } else if (config.notify_interval < 20) {
                    ccs.setDriveMode(CCS811_DRIVE_MODE_1SEC);
                } else if (config.notify_interval < 120) {
                    ccs.setDriveMode(CCS811_DRIVE_MODE_10SEC);
                } else {
                    ccs.setDriveMode(CCS811_DRIVE_MODE_60SEC);
                }

                // Set Notify timing
                timerNotify.setPeriod(config.notify_interval * 1000);

                debugPrint(
                    "[Conf] Write new config data to flash and ble "
                    "buffer");
                debugPrint("-----------------------------");
                debugPrint("New config data");
                debugPrint("Mode : " + String(config.mode));
                debugPrint("BLE Transmit power : " +
                           String((char) config.power));
                debugPrint("Battery : " + String(config.battery_thd) + "%");
                debugPrint("Interval : " + String(config.notify_interval) +
                           "Sec");
                debugPrint("Temp : " + String(config.temp_thd) + "");
                debugPrint("Humidity : " + String(config.humidity_thd) + "%");
                debugPrint("Pressure : " + String(config.pressure_thd) + "hPa");
                debugPrint("CO2 : " + String(config.co2_thd) + "ppm");
                debugPrint("TVOC : " + String(config.tvoc_thd) + "ppm");
            }

            if (connection_count == 0) {
                ledControl.stop();
                digitalWrite(IO_LED, LOW);
            } else if (connection_count < BLE_MAX_PRPH_CONNECTION) {
                // Available for connect
                ledControl.setPeriod(150);
            } else {
                // Can not connect to device
                ledControl.setPeriod(500);
            }

            // Flag reset
            g_notify_flag = 0;
            g_write_config_flag = 0;
        } else {
            while (!Bluefruit.connected()) {
                g_reload_request_flag = 1;
                delay(500);
            }
            delay(5000);
            ledControl.start();
        }
        delay(1000);
    }
}

void loop() {
}
