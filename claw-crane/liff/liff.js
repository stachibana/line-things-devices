const SERVICE_UUID = "26643bd9-6c7b-4304-874a-e43f1eccafb5";
const CHARACTERISTIC_WRITE_UUID = "e7024f7b-c61b-46bb-8690-e24c743e9b52";
const CHARACTERISTIC_NOTIFY_UUID = "82d23d9a-91b9-4933-96b0-966a148e9a43";

const DEVICE_CMD_ARM_X = 1;
const DEVICE_CMD_ARM_Y = 2;

const deviceUUIDSet = new Set();
const connectedUUIDSet = new Set();
const connectingUUIDSet = new Set();

let logNumber = 1;
let armState = 0;
let coinInserted = 0;

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
    armState = 0;
    coinInserted = 0;

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

            // Notification start
            nortificationStart(device);
            //Read status
            readStatusValue(device);
        }).catch(e => {
            flashSDKError(e);
            onScreenLog(`ERROR on gatt.connect(${device.id}): ${e}`);
            updateConnectionStatus(device, 'error');
            connectingUUIDSet.delete(device.id);
        });
    }
}

async function nortificationStart(device){
  const statusCharacteristic = await getCharacteristic(device, SERVICE_UUID, CHARACTERISTIC_NOTIFY_UUID);
  await enableNotification(statusCharacteristic, notificationCallback);
}

async function enableNotification(characteristic, callback) {
    const device = characteristic.service.device;
    characteristic.addEventListener('characteristicvaluechanged', callback);
    await characteristic.startNotifications();
    onScreenLog('Notifications STARTED ' + characteristic.uuid + ' ' + device.id);
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

    template.querySelector('.button1').addEventListener('mouseup', () => {
        if(coinInserted == 1){
          if(armState == 0){
            updateArm(device, DEVICE_CMD_ARM_X, 1).catch(e => onScreenLog(`ERROR on updateArm(): ${e}\n${e.stack}`));
          }else if(armState == 1){
            updateArm(device, DEVICE_CMD_ARM_X, 0).catch(e => onScreenLog(`ERROR on updateArm(): ${e}\n${e.stack}`));
            getDeviceButton1(device).classList.remove('btn-primary');
            getDeviceButton1(device).classList.add('btn-secondary');
            getDeviceButton2(device).classList.remove('btn-secondary');
            getDeviceButton2(device).classList.add('btn-primary');
            getDeviceMachineStatus(device).innerText = "2ボタンを押して右にスライドします。もう一度押すと停止します。";
          }
          armState++;
        }
    });
    template.querySelector('.button2').addEventListener('mouseup', () => {
        if(coinInserted == 1){
          if(armState == 2){
            updateArm(device, DEVICE_CMD_ARM_Y, 1).catch(e => onScreenLog(`ERROR on updateArm(): ${e}\n${e.stack}`));
            armState++;
          }else{
            updateArm(device, DEVICE_CMD_ARM_Y, 0).catch(e => onScreenLog(`ERROR on updateArm(): ${e}\n${e.stack}`));
            getDeviceButton2(device).classList.remove('btn-primary');
            getDeviceButton2(device).classList.add('btn-secondary');
            getDeviceMachineStatus(device).innerText = "ありがとうございました! 自動的に接続が切れて次のプレーヤーに権限が移ります。";
            armState = 0;
          }
        }
    });

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

async function updateArm(device, direction, value){
  onScreenLog("Write" + direction + value);

  const characteristic = await getCharacteristic(
      device, SERVICE_UUID, CHARACTERISTIC_WRITE_UUID);
  await writeCharacteristic(characteristic, [direction, value]);
}

function notificationCallback(e) {
    const value = (new DataView(e.target.value.buffer)).getInt8(0, true);
    onScreenLog(`Notify ${e.target.uuid}: ${buf2hex(e.target.value.buffer)}`);
    //updateSensorValue(e.target.service.device, accelerometerBuffer);
    const device = e.target.service.device;

    valueUpdateToGui(device, value);
}

async function readStatusValue(device) {
    const statusCharacteristic = await getCharacteristic(
        device, SERVICE_UUID, CHARACTERISTIC_NOTIFY_UUID);

    const valueBuffer = await readCharacteristic(statusCharacteristic).catch(e => {
        return null;
    });

    onScreenLog('read status value-1');

    if (valueBuffer !== null) {
        valueUpdateToGui(device, valueBuffer);
        onScreenLog('read status value-2');
    }
}

async function valueUpdateToGui(device, value){
  if(value == 0){//対象者の順番が来て、コインを入れたときにこれが来る。
    getDeviceButton1(device).classList.remove('btn-secondary');
    getDeviceButton1(device).classList.add('btn-primary');
    getDeviceMachineStatus(device).innerText = "コインが挿入されました。1ボタンを押して右にスライドします。もう一度押すと止まります。";
    getDeviceButton2(device).classList.remove('btn-primary');
    getDeviceButton2(device).classList.add('btn-secondary');
    coinInserted = 1;
  }else if(value > 0 && value < 4){ // 待ち行列に並んでいるとき。
    getDeviceMachineStatus(device).innerText = "あと" + String(value) + "人が待っています。しばらくお待ち下さい。";
  }else if(value == 4){ // 対象者の順番が来て、コインを入れる準備ができたときにこれが来る。
    getDeviceMachineStatus(device).innerText = "順番が来ました。マシーンにコインを入れてください。";
  }
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

async function writeCharacteristic(characteristic, command) {
    await characteristic.writeValue(new Uint8Array(command)).catch(e => {
        onScreenLog(`Error writing ${characteristic.uuid}: ${e}`);
        throw e;
    });
    //onScreenLog(`Wrote ${characteristic.uuid}: ${command}`);
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

function getDeviceMachineStatus(device) {
    return getDeviceCard(device).getElementsByClassName('machine-status')[0];
}

function getDeviceButton1(device) {
    return getDeviceCard(device).getElementsByClassName('button1')[0];
}

function getDeviceButton2(device) {
    return getDeviceCard(device).getElementsByClassName('button2')[0];
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
