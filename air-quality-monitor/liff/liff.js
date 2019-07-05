const USER_SERVICE_UUID = "a5c99838-899c-4483-ace7-3335055763c4";
const USER_CHARACTERISTIC_NOTIFY_UUID = "d5e86560-6c91-4947-bb7b-b17540622586";
const USER_CHARACTERISTIC_WRITE_UUID = "f9ec0b7d-70cf-4146-b971-9995bdd54ff4";
const USER_CHARACTERISTIC_READ_UUID = "afa3eda0-a8f8-449e-9814-7dfc35953af5";
const USER_CHARACTERISTIC_RELOAD_UUID = "3325ccfa-4e3a-42c1-a17b-f959061cb6fb";


const deviceUUIDSet = new Set();
const connectedUUIDSet = new Set();
const connectingUUIDSet = new Set();
const notificationUUIDSet = new Set();

let logNumber = 1;

function onScreenLog(text) {
    const logbox = document.getElementById('logbox');
    logbox.value += '#' + logNumber + '> ';
    logbox.value += text;
    logbox.value += '\n';
    logbox.scrollTop = logbox.scrollHeight;
    logNumber++;
}

window.onload = () => {
    liff.init(async () => {
        onScreenLog('LIFF initialized');
        renderVersionField();

        await liff.initPlugins(['bluetooth']);
        onScreenLog('BLE plugin initialized');

        checkAvailablityAndDo(() => {
            onScreenLog('Finding devices...');
            findDevice();
        });
    }, e => {
        flashSDKError(e);
        onScreenLog(`ERROR on getAvailability: ${e}`);
    });
}

async function checkAvailablityAndDo(callbackIfAvailable) {
    const isAvailable = await liff.bluetooth.getAvailability().catch(e => {
        flashSDKError(e);
        onScreenLog(`ERROR on getAvailability: ${e}`);
        return false;
    });
    // onScreenLog("Check availablity: " + isAvailable);

    if (isAvailable) {
        document.getElementById('alert-liffble-notavailable').style.display = 'none';
        callbackIfAvailable();
    } else {
        document.getElementById('alert-liffble-notavailable').style.display = 'block';
        setTimeout(() => checkAvailablityAndDo(callbackIfAvailable), 1000);
    }
}

// Find LINE Things device using requestDevice()
async function findDevice() {
    const device = await liff.bluetooth.requestDevice().catch(e => {
        flashSDKError(e);
        onScreenLog(`ERROR on requestDevice: ${e}`);
        throw e;
    });
    // onScreenLog('detect: ' + device.id);

    try {
        if (!deviceUUIDSet.has(device.id)) {
            deviceUUIDSet.add(device.id);
            addDeviceToList(device);
        } else {
            // TODO: Maybe this is unofficial hack > device.rssi
            document.querySelector(`#${device.id} .rssi`).innerText = device.rssi;
        }

        checkAvailablityAndDo(() => setTimeout(findDevice, 100));
    } catch (e) {
        onScreenLog(`ERROR on findDevice: ${e}\n${e.stack}`);
    }
}

// Add device to found device list
function addDeviceToList(device) {
    onScreenLog('Device found: ' + device.name);

    const deviceList = document.getElementById('device-list');
    const deviceItem = document.getElementById('device-list-item').cloneNode(true);
    deviceItem.setAttribute('id', device.id);
    deviceItem.querySelector(".device-id").innerText = device.id;
    deviceItem.querySelector(".device-name").innerText = device.name;
    deviceItem.querySelector(".rssi").innerText = device.rssi;
    deviceItem.classList.add("d-flex");
    deviceItem.addEventListener('click', () => {
        deviceItem.classList.add("active");
        try {
            connectDevice(device);
        } catch (e) {
            onScreenLog('Initializing device failed. ' + e);
        }
    });
    deviceList.appendChild(deviceItem);
}

// Select target device and connect it
function connectDevice(device) {
    onScreenLog('Device selected: ' + device.name);

    if (!device) {
        onScreenLog('No devices found. You must request a device first.');
    } else if (connectingUUIDSet.has(device.id) || connectedUUIDSet.has(device.id)) {
        onScreenLog('Already connected to this device.');
    } else {
        connectingUUIDSet.add(device.id);
        initializeCardForDevice(device);

        // Wait until the requestDevice call finishes before setting up the disconnect listner
        const disconnectCallback = () => {
            updateConnectionStatus(device, 'disconnected');
            device.removeEventListener('gattserverdisconnected', disconnectCallback);
        };
        device.addEventListener('gattserverdisconnected', disconnectCallback);

        onScreenLog('Connecting ' + device.name);
        device.gatt.connect().then(() => {
            updateConnectionStatus(device, 'connected');
            connectingUUIDSet.delete(device.id);

            toggleNotification(device).catch(e => onScreenLog(`ERROR on toggleNotification(): ${e}\n${e.stack}`));
            reloadSensorValueRequest(device).catch(e => onScreenLog(`ERROR on reloadSensorValueRequest(): ${e}\n${e.stack}`));
            updateSettings(device);

        }).catch(e => {
            flashSDKError(e);
            onScreenLog(`ERROR on gatt.connect(${device.id}): ${e}`);
            updateConnectionStatus(device, 'error');
            connectingUUIDSet.delete(device.id);
        });
    }
}

// Setup device information card
function initializeCardForDevice(device) {
    const template = document.getElementById('device-template').cloneNode(true);
    const cardId = 'device-' + device.id;

    template.style.display = 'block';
    template.setAttribute('id', cardId);
    template.querySelector('.card > .card-header > .device-name').innerText = device.name;

    // Device disconnect button
    template.querySelector('.device-disconnect').addEventListener('click', () => {
        onScreenLog('Clicked disconnect button');
        device.gatt.disconnect();
    });
    // Notification enable button
    /*
    template.querySelector('.notification-enable').addEventListener('click', () => {

    });
    */

    template.querySelector('.write-config').addEventListener('click', () => {
        writeConfig(device).catch(e => onScreenLog(`ERROR on writeConfit(): ${e}\n${e.stack}`));
    });


    // Tabs
    ['notify', 'settings', 'info'].map(key => {
        const tab = template.querySelector(`#nav-${key}-tab`);
        const nav = template.querySelector(`#nav-${key}`);

        tab.id = `nav-${key}-tab-${device.id}`;
        nav.id = `nav-${key}-${device.id}`;

        tab.href = '#' + nav.id;
        tab['aria-controls'] = nav.id;
        nav['aria-labelledby'] = tab.id;
    })

    // Remove existing same id card
    const oldCardElement = getDeviceCard(device);
    if (oldCardElement && oldCardElement.parentNode) {
        oldCardElement.parentNode.removeChild(oldCardElement);
    }

    document.getElementById('device-cards').appendChild(template);
    onScreenLog('Device card initialized: ' + device.name);
}

// Update Connection Status
function updateConnectionStatus(device, status) {
    if (status == 'connected') {
        onScreenLog('Connected to ' + device.name);
        connectedUUIDSet.add(device.id);

        const statusBtn = getDeviceStatusButton(device);
        statusBtn.setAttribute('class', 'device-status btn btn-outline-primary btn-sm disabled');
        statusBtn.innerText = "Connected";
        getDeviceDisconnectButton(device).style.display = 'inline-block';
        getDeviceCardBody(device).style.display = 'block';
    } else if (status == 'disconnected') {
        onScreenLog('Disconnected from ' + device.name);
        connectedUUIDSet.delete(device.id);

        const statusBtn = getDeviceStatusButton(device);
        statusBtn.setAttribute('class', 'device-status btn btn-outline-secondary btn-sm disabled');
        statusBtn.innerText = "Disconnected";
        getDeviceDisconnectButton(device).style.display = 'none';
        getDeviceCardBody(device).style.display = 'none';
        document.getElementById(device.id).classList.remove('active');
    } else {
        onScreenLog('Connection Status Unknown ' + status);
        connectedUUIDSet.delete(device.id);

        const statusBtn = getDeviceStatusButton(device);
        statusBtn.setAttribute('class', 'device-status btn btn-outline-danger btn-sm disabled');
        statusBtn.innerText = "Error";
        getDeviceDisconnectButton(device).style.display = 'none';
        getDeviceCardBody(device).style.display = 'none';
        document.getElementById(device.id).classList.remove('active');
    }
}

async function toggleNotification(device) {
    if (!connectedUUIDSet.has(device.id)) {
        window.alert('Please connect to a device first');
        onScreenLog('Please connect to a device first.');
        return;
    }

    const accelerometerCharacteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_NOTIFY_UUID);

    await enableNotification(accelerometerCharacteristic, notificationCallback).catch(e => onScreenLog(`ERROR on notification start(): ${e}\n${e.stack}`));
    notificationUUIDSet.add(device.id);
}

async function writeConfig(device) {
    const card = getDeviceCard(device);

    const mode = card.querySelector('.mode-setting').value;
    const power = card.querySelector('.power-setting').value;
    const interval = card.querySelector('.interval').value;
    const battery_thd = card.querySelector('.battery_thd').value;
    const temp_thd = card.querySelector('.temp_thd').value * 100;
    const humidity_thd = card.querySelector('.humidity_thd').value * 100;
    const pressure_thd = card.querySelector('.pressure_thd').value;
    const co2_thd = card.querySelector('.co2_thd').value;
    const tvoc_thd = card.querySelector('.tvoc_thd').value;

    const header = [
      mode & 0xff, mode >> 8,
      power & 0xff, power >> 8,
      interval & 0xff, interval >> 8,
      battery_thd & 0xff, battery_thd >> 8,
      temp_thd & 0xff, temp_thd >> 8,
      humidity_thd & 0xff, humidity_thd >> 8,
      pressure_thd & 0xff, pressure_thd >> 8,
      co2_thd & 0xff, co2_thd >> 8,
      tvoc_thd & 0xff, tvoc_thd >> 8];

    onScreenLog('Write to device : ' + new Uint8Array(header));

    const characteristic = await getCharacteristic(
          device, USER_SERVICE_UUID, USER_CHARACTERISTIC_WRITE_UUID);
    await characteristic.writeValue(new Uint8Array(header)).catch(e => {
        onScreenLog(`Error writing ${characteristic.uuid}: ${e}`);
        throw e;
    });
}

async function reloadSensorValueRequest(device){
  const header = [0];

  onScreenLog('Sensor value reload request : ' + new Uint8Array(header));

  const characteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_RELOAD_UUID);
  await characteristic.writeValue(new Uint8Array(header)).catch(e => {
      onScreenLog(`Error writing ${characteristic.uuid}: ${e}`);
      throw e;
  });
}



async function toggleSetuuid(device) {
    if (!connectedUUIDSet.has(device.id)) {
        window.alert('Please connect to a device first');
        onScreenLog('Please connect to a device first.');
        return;
    }
    getDeviceSetuuidButton(device).classList.remove('btn-success');
    getDeviceSetuuidButton(device).classList.add('btn-secondary');
    window.alert('Push OK button on this dialog. Then push reset button on the MPU board.');
    onScreenLog('BLE advertising uuid changed.');
}

async function enableNotification(characteristic, callback) {
    const device = characteristic.service.device;
    characteristic.addEventListener('characteristicvaluechanged', callback);
    await characteristic.startNotifications();
    onScreenLog('Notifications STARTED ' + characteristic.uuid + ' ' + device.id);
}

async function stopNotification(characteristic, callback) {
    const device = characteristic.service.device;
    characteristic.removeEventListener('characteristicvaluechanged', callback);
    await characteristic.stopNotifications();
    onScreenLog('Notifications STOPPED　' + characteristic.uuid + ' ' + device.id);
}

function notificationCallback(e) {
    const accelerometerBuffer = new DataView(e.target.value.buffer);
    onScreenLog(`Notify ${e.target.uuid}: ${buf2hex(e.target.value.buffer)}`);
    updateSensorValue(e.target.service.device, accelerometerBuffer);
}

async function updateSettings(device) {
    const settingsCharacteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_READ_UUID);

    const buffer = await readCharacteristic(settingsCharacteristic).catch(e => {
        return null;
    });
    onScreenLog(buf2hex(buffer));

    if (buffer != null) {
        //updateSensorValue(device, sensorBuffer);
        const mode = buffer.getInt16(0, true);
        const power = buffer.getInt16(2, true);
        const battery = buffer.getInt16(4, true);
        const interval = buffer.getInt16(6, true);
        const temperature = buffer.getInt16(8, true) / 100;
        const humidity = buffer.getInt16(10, true) / 100;
        const pressure = buffer.getInt16(12, true);
        const co2 = buffer.getInt16(14, true);
        const tvoc = buffer.getInt16(16, true);

        getDeviceSetMode(device).value = mode;
        getDeviceSetPower(device).value = power;
        getDeviceSetInterval(device).value = interval;
        getDeviceSetBatteryThd(device).value = battery;
        getDeviceSetTemperatureThd(device).value = temperature;
        getDeviceSetHumidityThd(device).value = humidity;
        getDeviceSetPressureThd(device).value = pressure;
        getDeviceSetCo2Thd(device).value = co2;
        getDeviceSetTvocThd(device).value = tvoc;
    }
}

function updateSensorValue(device, buffer) {
    const battery = buffer.getInt16(0, true);
    const temperature = buffer.getInt16(2, true);
    const humidity = buffer.getInt16(4, true);
    const pressure = buffer.getInt16(6, true);
    const co2 = buffer.getInt16(8, true);
    const tvoc = buffer.getInt16(10, true);
    const altitude = buffer.getInt16(12, true);
    const time = new Date();

    getDeviceViewBattery(device).innerText = battery + "%";
    getDeviceViewTemperature(device).innerText = temperature + "℃";
    getDeviceViewHumidity(device).innerText = humidity + "%";
    getDeviceViewPressure(device).innerText = pressure + "hPa";
    getDeviceViewCo2(device).innerText = co2 + "ppm";
    getDeviceViewTvoc(device).innerText = tvoc + "ppm";
    getDeviceViewAltitude(device).innerText = altitude + "m";
    getDeviceViewLastUpdate(device).innerText = time.getHours() + "時" + time.getMinutes() + "分" + time.getSeconds() + "秒";
}

async function readCharacteristic(characteristic) {
    const response = await characteristic.readValue().catch(e => {
        onScreenLog(`Error reading ${characteristic.uuid}: ${e}`);
        throw e;
    });
    if (response) {
        onScreenLog(`Read ${characteristic.uuid}: ${buf2hex(response.buffer)}`);
        const values = new DataView(response.buffer);
        return values;
    } else {
        throw 'Read value is empty?';
    }
}

async function writeAdvertuuid(device, uuid) {
  const tx_uuid = uuid.replace(/-/g, '');
  let uuid_byte = [];
  let hash = 0;
  for(let i = 0; i < 16; i = i + 1) {
    uuid_byte[i] = parseInt(tx_uuid.substring(i * 2, i * 2 + 2), 16);
    hash = hash + uuid_byte[i];
  }

  const header = [1, 0, 0, hash];
  const command = header.concat(uuid_byte);

  onScreenLog('Write new advert UUID to device  : ' + new Uint8Array(command));

  const characteristic = await getCharacteristic(
        device, USER_SERVICE_UUID, USER_CHARACTERISTIC_WRITE_UUID);
  await characteristic.writeValue(new Uint8Array(command)).catch(e => {
      onScreenLog(`Error writing ${characteristic.uuid}: ${e}`);
      throw e;
  });
}

async function getCharacteristic(device, serviceId, characteristicId) {
    const service = await device.gatt.getPrimaryService(serviceId).catch(e => {
        flashSDKError(e);
        throw e;
    });
    const characteristic = await service.getCharacteristic(characteristicId).catch(e => {
        flashSDKError(e);
        throw e;
    });
    onScreenLog(`Got characteristic ${serviceId} ${characteristicId} ${device.id}`);
    return characteristic;
}

function getDeviceCard(device) {
    return document.getElementById('device-' + device.id);
}

function getDeviceCardBody(device) {
    return getDeviceCard(device).getElementsByClassName('card-body')[0];
}

function getDeviceStatusButton(device) {
    return getDeviceCard(device).getElementsByClassName('device-status')[0];
}

function getDeviceDisconnectButton(device) {
    return getDeviceCard(device).getElementsByClassName('device-disconnect')[0];
}



function getDeviceViewTemperature(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-temperature')[0];
}

function getDeviceViewBattery(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-battery')[0];
}

function getDeviceViewHumidity(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-humidity')[0];
}

function getDeviceViewPressure(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-pressure')[0];
}

function getDeviceViewCo2(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-co2')[0];
}

function getDeviceViewTvoc(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-tvoc')[0];
}

function getDeviceViewAltitude(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-altitude')[0];
}

function getDeviceViewLastUpdate(device) {
    return getDeviceCard(device).getElementsByClassName('progress-bar-lastupdate')[0];
}


function getDeviceSetTemperatureThd(device) {
    return getDeviceCard(device).getElementsByClassName('temp_thd')[0];
}

function getDeviceSetBatteryThd(device) {
    return getDeviceCard(device).getElementsByClassName('battery_thd')[0];
}

function getDeviceSetHumidityThd(device) {
    return getDeviceCard(device).getElementsByClassName('humidity_thd')[0];
}

function getDeviceSetPressureThd(device) {
    return getDeviceCard(device).getElementsByClassName('pressure_thd')[0];
}

function getDeviceSetCo2Thd(device) {
    return getDeviceCard(device).getElementsByClassName('co2_thd')[0];
}

function getDeviceSetTvocThd(device) {
    return getDeviceCard(device).getElementsByClassName('tvoc_thd')[0];
}

function getDeviceSetInterval(device) {
    return getDeviceCard(device).getElementsByClassName('interval')[0];
}

function getDeviceSetMode(device) {
    return getDeviceCard(device).getElementsByClassName('mode-setting')[0];
}

function getDeviceSetPower(device) {
    return getDeviceCard(device).getElementsByClassName('power-setting')[0];
}


function getDeviceNotificationButton(device) {
    return getDeviceCard(device).getElementsByClassName('notification-enable')[0];
}

function getDeviceSetuuidButton(device) {
    return getDeviceCard(device).getElementsByClassName('setuuid')[0];
}

function renderVersionField() {
    const element = document.getElementById('sdkversionfield');
    const versionElement = document.createElement('p')
        .appendChild(document.createTextNode('SDK Ver: ' + liff._revision));
    element.appendChild(versionElement);
}

function flashSDKError(error){
    window.alert('SDK Error: ' + error.code);
    window.alert('Message: ' + error.message);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}
