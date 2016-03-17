var ModeDevice = require('../index.js');
//var ModeDevice = require('mode-device');

//
// Device information settings.
// You have to change these params according to your device register information.
//

var DEVICE_ID = 9;
var API_KEY = 'v1.ZHw5.1429577061.8ed264577b7d69ccb26418c7f64112ab4261a39d71319fd473224260';

ModeDevice.debug = true;
var device = new ModeDevice(DEVICE_ID, API_KEY);

//
// Send first event to Mode cloud.
//
var counter = 0;
device.eventFinishedCallback = function() {
};
for (var i = 0; i < 100; i++) {
  device.triggerEvent('first_event', {'eventItem': i});
}
