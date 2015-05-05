var Ws = require('ws');
var https = require('https');

var defaultErrorCallback = function(error) {
  console.log('Error: ' + error);
  this.scheduleReconnect();
};

var defaultCloseCallback = function(code, message) {
  console.log('Connection is closed: ' + code + ' ' + message);
  if (this.pingTimer != null) {
    clearInterval(this.pingTimer);
  }
  // reconnect
  this.scheduleReconnect();
};

var defaultOpenCallback = function() {
  console.log('WebSocket client is connected');
  this.retryWait = 0;
  // start pinging
  var pingHandler = function() {
    console.log('Sending a ping');
    this.triggerPing();
  };

  this.pingTimer = setInterval(pingHandler.bind(this), 20 * 1000);
};

var defaultCommandCallback = function(message, flags) {
  console.log('Received JSON message: "' + message + '"');
  console.log('Received flag: "' + flags + '"');
};

var defaultPongCallback = function() {
  console.log('Received a pong');
};

var commandHandler = function(message, flags) {
  console.log('Command handler is called');
  console.log('Received raw message: "' + message + '"');
  console.log('Received flag: "' + flags + '"');
  var commandJson = JSON.parse(message);
  this.commandCallback(commandJson, flags);
};

var ModeDevice = function(deviceId, token) {
  this.token = token;
  this.deviceId = deviceId;
  this.retryWait = 0;  // retry wait in msec
  this.websocket = null;

  this.host = 'api.tinkermode.com';
  this.port = 443;  // default to wss.

  this.errorCallback = defaultErrorCallback;
  this.closeCallback = defaultCloseCallback;
  this.openCallback = defaultOpenCallback;
  this.commandCallback = defaultCommandCallback;
  this.pongCallback = defaultPongCallback;
  this.eventFinishedCallback = defaultEventFinishedCallback;
  this.pingTimer = null;
};

ModeDevice.prototype.reconnect = function() {
  console.log('Reconnecting');
  if (this.websocket != null) {
    console.log('Closing WebSocket');
    this.websocket.close();
    this.websocket = null;
  }
  var target = 'wss://' + this.host + ':' + this.port + '/devices/' + this.deviceId + '/command';
  console.log("Connecting to " + target);
  this.websocket = new Ws(target, {
    headers: {
      "Authorization": 'ModeCloud ' + this.token
    }
  });
  this.websocket.on('error', this.errorCallback.bind(this));
  this.websocket.on('close', this.closeCallback.bind(this));
  this.websocket.on('open', this.openCallback.bind(this));
  this.websocket.on('message', commandHandler.bind(this));
  this.websocket.on('pong', this.pongCallback.bind(this));
};

ModeDevice.prototype.scheduleReconnect = function() {
  console.log('Reconnection is scheduled in ' + this.retryWait);
  var device = this;
  setTimeout(function() {
    device.reconnect();
  }, this.retryWait * 1000);
  this.retryWait += 1;
};

ModeDevice.prototype.listenCommands = function() {
  this.scheduleReconnect();
};

ModeDevice.prototype.triggerPing = function() {
  this.websocket.ping();
};

var defaultEventFinishedCallback = function() {
  console.log('Event is triggered');
};

ModeDevice.prototype.triggerEvent = function(eventType, eventData) {
  var event = {
    "eventType": eventType,
    "eventData": eventData
  };

  var jsonData = JSON.stringify(event);

  var options = {
    host: this.host,
    port: this.port,
    path: '/devices/' + this.deviceId + '/event',
    method: 'PUT',
    headers: {
      "Content-Type": 'application/json',
      "Content-Length": jsonData.length,
      "Authorization": 'ModeCloud ' + this.token
    }
  };

  var req = https.request(options, this.eventFinishedCallback.bind(this));
  req.write(jsonData);
  req.end();
};

module.exports = ModeDevice;
