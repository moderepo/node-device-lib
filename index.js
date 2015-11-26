var ws = require('ws');
var https = require('https');

function debuglog(msg) {
  if (ModeDevice.debug) {
    console.log(msg);
  }
}

var defaultEventErrorCallback = function(error) {
  debuglog('Event Error: ' + error);
};

var defaultErrorCallback = function(error) {
  debuglog('Error: ' + error);
  this.scheduleReconnect(false);
};

var defaultCloseCallback = function(code, message) {
  debuglog('Connection is closed: ' + code + ' ' + message);
  if (this.pingTimer != null) {
    clearInterval(this.pingTimer);
  }
  // reconnect
  this.scheduleReconnect(false);
};

var defaultOpenCallback = function() {
  debuglog('WebSocket client is connected');
  this.retryWait = 1;
  // start pinging
  var pingHandler = function() {
    debuglog('Sending a ping');
    this.triggerPing();
  };

  this.pingTimer = setInterval(pingHandler.bind(this), 20 * 1000);
};

var defaultCommandCallback = function(message, flags) {
  debuglog('Received JSON message: "' + message + '"');
  debuglog('Received flag: "' + flags + '"');
};

var defaultPongCallback = function() {
  debuglog('Received a pong');
};

var commandHandler = function(message, flags) {
  debuglog('Command handler is called');
  debuglog('Received raw message: "' + message + '"');
  debuglog('Received flag: "' + flags + '"');
  var commandJson = JSON.parse(message);
  this.commandCallback(commandJson, flags);
};

var ModeDevice = function(deviceId, token) {
  this.debug = false;
  this.token = token;
  this.deviceId = deviceId;
  this.retryWait = 1;  // retry wait in msec
  this.retryWaitFib = 1;  // retry wait in msec
  this.websocket = null;

  this.host = 'api.tinkermode.com';
  this.port = 443;  // default to wss.

  this.eventErrorCallback = defaultEventErrorCallback;
  this.errorCallback = defaultErrorCallback;
  this.closeCallback = defaultCloseCallback;
  this.openCallback = defaultOpenCallback;
  this.commandCallback = defaultCommandCallback;
  this.pongCallback = defaultPongCallback;
  this.eventFinishedCallback = defaultEventFinishedCallback;
  this.pingTimer = null;
};

ModeDevice.prototype.reconnect = function() {
  debuglog('Reconnecting websocket');
  if (this.websocket != null) {
    debuglog('Closing websocket');
    this.websocket.close();
    this.websocket = null;
  }
  var target = 'wss://' + this.host + ':' + this.port + '/devices/' + this.deviceId + '/command';
  debuglog("Connecting to " + target);
  this.websocket = new ws(target, {
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

ModeDevice.prototype.scheduleReconnect = function(firstConnect) {
  var wait = firstConnect ? 0 : this.retryWait;
  debuglog('Reconnect websocket in ' + wait + ' seconds');
  var device = this;
  setTimeout(function() {
    device.reconnect();
  }, wait * 1000);

  // Only if less than 60 sec, we increment waiting time according to Fibonacci numbers.
  if (this.retryWait < 60) {
    var fib = this.retryWaitFib;
    this.retryWaitFib = this.retryWait;
    this.retryWait += fib;
  }
};

ModeDevice.prototype.listenCommands = function() {
  this.scheduleReconnect(true);
};

ModeDevice.prototype.triggerPing = function() {
  this.websocket.ping();
};

var defaultEventFinishedCallback = function() {
  debuglog('Event is triggered');
};

ModeDevice.prototype.triggerEvent = function(eventType, eventData) {
  if((typeof eventType) != "string" && !(eventType instanceof String)) {
    throw "eventType must be string";
  }

  if((typeof eventData) != "object" || (eventData instanceof Array)) {
    throw "eventData must be object";
  }

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
  req.on('error', this.eventErrorCallback.bind(this));
  req.write(jsonData);
  req.end();
};

module.exports = ModeDevice;
