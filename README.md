# MODE Device library in NodeJS.

## Overview

MODE Device library in NodeJS provides a wrapper for the [MODE](http://www.tinkermode.com) cloud [API](http://dev.tinkermode.com/docs/api/) and handles the data objects connecting Device.

## Requirements
You need to install [Node.js](https://nodejs.org/) to use the library.  This library works with v0.10.38, v0.12 and newer version of NodeJS.

## Installation

We put the library at [npm package site](https://www.npmjs.com/package/mode-device), so you can just run the following command to install the library.

```
$ npm install mode-device
```

Or you can use `package.json` and add `mode-device` in the dependency section.

## Usage Example

~~~
  var ModeDevice = require('mode-device');
  
  //
  // Device information settings.
  // You have to change these params according to your device register information.
  //
  
  var DEVICE_ID = 1;
  var API_KEY = 'v1.cccc.bbbbbbbbbbbbbbbbbb.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  
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
~~~

If you want to see more detail how to use it on micro controllers like Raspberry Pi or Intel Edison, please read our tutorials:

- [Using Raspberry Pi with MODE](http://dev.tinkermode.com/docs/raspberry_pi.html)
- [Using Intel Edison with MODE](http://dev.tinkermode.com/docs/edison.html)


## Author

MODE, inc.

## License

MODE Device library in NodeJS is available under the MIT license. See the LICENSE file for more info.

