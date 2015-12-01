var ModeDevice = require('../index.js');

//
// Device information settings.
// You have to change these params according to your device register information.
//

var DEVICE_ID = 1;
var API_KEY = 'v1.cccc.bbbbbbbbbbbbbbbbbb.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

ModeDevice.debug = true;
var device = new ModeDevice(DEVICE_ID, API_KEY);

//
// Send first event to Mode cloud.
//
device.triggerEvent('first_event', {'eventItem': 1});


//
// Set up the callback function called whenever a command is delivered.
//

device.commandCallback = function(msg, flags) {
  if (msg['action'] == 'action_name') {
    var v = msg['parameters']['param0'] ? 1 : 0;
    // Do something
  }
}

device.listenCommands();