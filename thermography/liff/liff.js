const SERVICE_UUID = '0147088e-4efd-40fa-95f3-e6c7a1285607';
const CMD_CHARACTERISTIC_UUID = '95243321-cb66-4137-802f-4cb51fd4818d';
const MATRIX_CHARACTERISTIC_UUID = '943f94a6-3a7e-45df-8614-1e5f61fe334f';

const DEVICE_CMD_ARM_X = 1;
const DEVICE_CMD_ARM_Y = 2;

const deviceUUIDSet = new Set();
const connectedUUIDSet = new Set();
const connectingUUIDSet = new Set();

let logNumber = 1;
let armState = 0;
let coinInserted = 0;

// Matrix data
let g_color_matrix8x8 = [];

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

    // Test
    for (var i = 0; i < 8; i = i + 1) {
      g_color_matrix8x8[i] = [25, 25, 25, 25, 25, 25, 25, 25];
    }

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
      nortificationStart(device).catch(e => {
        onScreenLog("Error nortification start");
      });

    }).catch(e => {
      flashSDKError(e);
      onScreenLog(`ERROR on gatt.connect(${device.id}): ${e}`);
      updateConnectionStatus(device, 'error');
      connectingUUIDSet.delete(device.id);
    });
  }
}

async function nortificationStart(device) {
  const statusCharacteristic = await getCharacteristic(device, SERVICE_UUID, MATRIX_CHARACTERISTIC_UUID);
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


function notificationCallback(e) {
  const value = (new Uint8Array(e.target.value.buffer));
  //onScreenLog(`Notify ${e.target.uuid}: ${buf2hex(e.target.value.buffer)}`);
  const device = e.target.service.device;

  valueUpdateToGui(device, value);
}


async function valueUpdateToGui(device, matrix) {
  //Detect Color
  let color_matrix = [];
  for (var i = 0; i < 16; i = i + 1) {
    color_matrix[i] = matrix[i] & 0x7f;
  }

  //Detect V-Address
  let v_address = ((matrix[0] & 0x80) >> 7) + ((matrix[1] & 0x80) >> 6);

  for (let i = 0; i < 8; i = i + 1) {
    g_color_matrix8x8[v_address * 2][i] = color_matrix[i];
    g_color_matrix8x8[v_address * 2 + 1][i] = color_matrix[i + 8];
  }
  if (v_address == 3) {
    drawMatrix(device).catch(e => {
      onScreenLog("Error drapw()");
    });
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

function renderVersionField() {
  const element = document.getElementById('sdkversionfield');
  const versionElement = document.createElement('p')
    .appendChild(document.createTextNode('SDK Ver: ' + liff._revision));
  element.appendChild(versionElement);
}

function flashSDKError(error) {
  window.alert('SDK Error: ' + error.code);
  window.alert('Message: ' + error.message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buf2hex(buffer) { // buffer is an ArrayBuffer
  return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join('');
}

function getPointMaxTemp(device) {
  return getDeviceCard(device).getElementsByClassName('temperature-max')[0];
}

function getPointMinTemp(device) {
  return getDeviceCard(device).getElementsByClassName('temperature-min')[0];
}

function getPointAvgTemp(device) {
  return getDeviceCard(device).getElementsByClassName('temperature-avg')[0];
}

function getPointMatrixOriginal(device) {
  return getDeviceCard(device).getElementsByClassName('matrix_original')[0];
}

function getPointMatrixBig(device) {
  return getDeviceCard(device).getElementsByClassName('matrix_big')[0];
}

function getPointColorRangeMin(device) {
  return getDeviceCard(device).getElementsByClassName('setting-min-range')[0];
}

function getPointColorRangeMax(device) {
  return getDeviceCard(device).getElementsByClassName('setting-max-range')[0];
}


function getPointMatrixMarkMin(device) {
  return getDeviceCard(device).getElementsByClassName('seting_mark_min')[0];
}


function getPointMatrixMarkMax(device) {
  return getDeviceCard(device).getElementsByClassName('seting_mark_max')[0];
}


function getPointMatrixDrawRawData(device) {
  return getDeviceCard(device).getElementsByClassName('seting_raw_plot')[0];
}

async function drawMatrix(device) {
  const canvas_original = getPointMatrixOriginal(device);
  const context_original = canvas_original.getContext('2d');
  const canvas_320x320 = getPointMatrixBig(device);
  const context_320x320 = canvas_320x320.getContext('2d');

  context_320x320.clearRect(0, 0, 272, 272);
  context_320x320.drawImage(canvas_original, 0, 0);

  let destination = context_320x320.createImageData(272, 272);
  let src_imagedata = new ImageData(8, 8);

  //最大、最低温度取得
  let array_min = [];
  let array_max = [];
  let array_sum = 0;

  for (i = 0; i < 8; i = i + 1) {
    array_max[i] = Math.max.apply(null, g_color_matrix8x8[i]);
    array_min[i] = Math.min.apply(null, g_color_matrix8x8[i]);
    const tmp = g_color_matrix8x8[i];
    for (j = 0; j < 8; j = j + 1) {
      array_sum += tmp[j];
    }
  }
  let max = Math.max.apply(null, array_max);
  let min = Math.min.apply(null, array_min);

  getPointMaxTemp(device).innerText = max + "℃";
  getPointMinTemp(device).innerText = min + "℃";
  getPointAvgTemp(device).innerText = Math.round((array_sum / 64) * 10) / 10 + "℃";

  const min_range = getPointColorRangeMin(device).value;
  const max_range = getPointColorRangeMax(device).value;

  //Find display min and max
  let display_max = 0;
  let display_min = 100;
  let display_max_addr_y = 0;
  let display_max_addr_x = 0;
  let display_min_addr_y = 0;
  let display_min_addr_x = 0;
  //Draw Matrix
  for (let i = 0; i < 8; i = i + 1) {
    for (let j = 0; j < 8; j = j + 1) {
      if (g_color_matrix8x8[j][i] < min_range) {

      } else if (g_color_matrix8x8[j][i] > max_range) {

      } else {
        if (display_max < g_color_matrix8x8[j][i]) {
          display_max = g_color_matrix8x8[j][i];
          display_max_addr_y = i;
          display_max_addr_x = j;
        }
        if (display_min > g_color_matrix8x8[j][i]) {
          display_min = g_color_matrix8x8[j][i];
          display_min_addr_y = i;
          display_min_addr_x = j;
        }
      }
    }
  }

  //Draw Matrix
  for (let i = 0; i < 8; i = i + 1) {
    for (let j = 0; j < 8; j = j + 1) {
      let red, green, blue;
      if (g_color_matrix8x8[j][i] < min_range) {
        red = 0;
        green = 0;
        blue = 0;
      } else if (g_color_matrix8x8[j][i] > max_range) {
        red = 255;
        green = 255;
        blue = 255;
      } else {
        let temp = g_color_matrix8x8[j][i];
        temp = temp * (100 / display_max);
        temp = temp - display_min;

        const pixel_color = convertTemo2ColorHsv(temp);
        red = pixel_color.get("rgb.r");
        green = pixel_color.get("rgb.g");
        blue = pixel_color.get("rgb.b");
      }

      src_imagedata.data[i * 32 + j * 4] = red;
      src_imagedata.data[i * 32 + j * 4 + 1] = green;
      src_imagedata.data[i * 32 + j * 4 + 2] = blue;
      src_imagedata.data[i * 32 + j * 4 + 3] = 255; //alpha;
    }
  }

  // Draw scaling up to 272 x 272 pixel
  if (!getPointMatrixDrawRawData(device).checked) {
    // バイキュービックで拡大
    EffectResampling(src_imagedata, destination, BiCubic_Filter, false);
    // Draw to canvas (canvasへ描画)
    context_320x320.putImageData(destination, 0, 0);
    // Draw Max temp point
    if (getPointMatrixMarkMax(device).checked) {
      context_320x320.strokeStyle = "rgb(255, 0, 0)";
      context_320x320.font = "10px sans-serif";
      context_320x320.fillText(display_max, (display_max_addr_x * 34) + 5, (display_max_addr_y * 34) + 13);
      context_320x320.strokeRect(display_max_addr_x * 34, display_max_addr_y * 34, 20, 20);
    }
    // Draw Min temp point
    if (getPointMatrixMarkMin(device).checked) {
      context_320x320.strokeStyle = "rgb(0, 0, 255)";
      context_320x320.font = "10px sans-serif";
      context_320x320.fillText(display_min, (display_min_addr_x * 34) + 5, (display_min_addr_y * 34) + 13);
      context_320x320.strokeRect(display_min_addr_x * 34, display_min_addr_y * 34, 20, 20);
    }
  } else {
    // Draw scaling up to 272 x 272 pixel
    for (let i = 0; i < 8; i = i + 1) {
      for (let j = 0; j < 8; j = j + 1) {
        const red = src_imagedata.data[i * 32 + j * 4];
        const green = src_imagedata.data[i * 32 + j * 4 + 1];
        const blue = src_imagedata.data[i * 32 + j * 4 + 2];

        context_320x320.fillStyle = "rgba(" + red + "," + green + "," + blue + "," + 255 + ")";
        context_320x320.fillRect(j * 34, i * 34, 34, 34);
      }
    }
    // Draw Max temp point
    if (getPointMatrixMarkMax(device).checked) {
      context_320x320.strokeStyle = "rgb(255, 0, 0)";
      context_320x320.font = "14px sans-serif";
      context_320x320.fillText(display_max, (display_max_addr_x * 34) + 15, (display_max_addr_y * 34) + 20);
      context_320x320.strokeRect(display_max_addr_x * 34, display_max_addr_y * 34, 34, 34);
    }
    // Draw Min temp point
    if (getPointMatrixMarkMin(device).checked) {
      context_320x320.strokeStyle = "rgb(0, 0, 255)";
      context_320x320.font = "14px sans-serif";
      context_320x320.fillText(display_min, (display_min_addr_x * 34) + 15, (display_min_addr_y * 34) + 20);
      context_320x320.strokeRect(display_min_addr_x * 34, display_min_addr_y * 34, 34, 34);
    }
  }
}

function convertTemo2ColorHsv(temp) {
  let color_value = 240 - ((240 / 100) * temp);
  let hsv_color = chroma.hsv(color_value, 1, 1);
  return hsv_color;
}