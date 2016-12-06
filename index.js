var ws = require('ws');
var https = require('https');

function debuglog(msg) {
  if (ModeDevice.debug) {
    console.log('[MODE-DEVICE] ' + msg);
  }
}

var defaultEventErrorCallback = function(error) {
  debuglog('Event Error: ' + error);
};

var defaultErrorCallback = function(error) {
  debuglog('Error: ' + error);
  this.close();  // When an error happens, websocket object still exists.  Force close to make reconnection to work.
  this.scheduleReconnect(false);
};

var defaultCloseCallback = function(code, message) {
  debuglog('Connection is closed: ' + code + ' ' + message);
  if (this.pingTimer !== null) {
    clearInterval(this.pingTimer);
  }
  // reconnect
  this.close();
  this.scheduleReconnect(false);
};

var defaultOpenCallback = function() {
  debuglog('Websocket client is connected');
  this.retryWait = 1;
  this.pingCounter = 0;
  // start pinging
  var pingHandler = function() {
    // If there's no pong seen for more than three requests,
    // re-establish the websocket connection.
    if (this.pingCounter > 3) {
      debuglog('Not seeing websocket pong - closing the connection and schedulng reconnection');
      if (this.websocket !== null) {
        this.close();
      }
      this.scheduleReconnect(false);
      return;
    }
    this.pingCounter++;
    debuglog('Sending a websocket ping');
    this.triggerPing();
  };

  this.pingTimer = setInterval(pingHandler.bind(this), 25 * 1000);
};

var defaultCommandCallback = function(message, flags) {
  debuglog('Received JSON message: "' + message + '"');
  debuglog('Received flag: "' + JSON.stringify(flags) + '"');
};

var defaultPongCallback = function() {
  debuglog('Received a websocket pong');
  this.pingCounter--;
};

var commandHandler = function(message, flags) {
  debuglog('Received a command');
  debuglog('Raw message: "' + message + '"');
  var commandJson = JSON.parse(message);
  this.commandCallback(commandJson, flags);
};

var ModeDevice = function(deviceId, token) {
  this.debug = false;
  this.token = token;
  this.deviceId = deviceId;
  this.retryWait = 1;  // retry wait in msec
  this.retryWaitFib = 1;  // retry wait in msec
  this.timeout = 10 * 1000; // request timeout in msec
  this.maxRequests = 10;  // number of simultaneous requests it will process
  this.websocket = null;
  this.eventCounter = 0;  // sequence id for events

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
  // Increase the number of sockets for slow networks.
  https.globalAgent.maxSockets = 20;  // originally 5.
};

ModeDevice.prototype.setApiHost = function(host) {
  this.host = host;
};

ModeDevice.prototype.close = function() {
  debuglog('Closing websocket');
  if (this.websocket !== null) {
    this.websocket.close();
  }
  this.websocket = null;
};

ModeDevice.prototype.reconnect = function() {
  debuglog('Reconnecting websocket');
  if (this.websocket != null) {
    debuglog('there is an websocket');
    this.close();
    return;  // reconnecting will be triggered by close event handler.
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
  if (device.isReconnectScheduled !== true) {
    debuglog('scheduling a reconnection');
    device.isReconnectScheduled = true;
    setTimeout(function() {
      debuglog('scheduled reconnection triggered');
      device.reconnect();
      device.isReconnectScheduled = false;
    }, wait * 1000);
  }

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
  if (this.websocket !== null) {
    this.websocket.ping();
  }
};

var defaultEventFinishedCallback = function() {
};

ModeDevice.prototype.triggerEvent = function(eventType, eventData) {
  this.eventCounter += 1;
  var eventId = this.eventCounter;
  debuglog('Triggering event #' + eventId);

  if((typeof eventType) != "string" && !(eventType instanceof String)) {
    throw "eventType must be string";
  }

  if((typeof eventData) != "object" || (eventData instanceof Array)) {
    throw "eventData must be object";
  }

  // Try not to pile up requests when the network is unstable.
  var outstandingRequests = https.globalAgent.requests;
  var hostPort = this.host + ':' + this.port;
  if (outstandingRequests[hostPort] !== undefined) {
    if (outstandingRequests[hostPort].length >= this.maxRequests) {
      // If there are enough requests queued up, it doesn't attempt to issue a request.
      var msg = 'Too many outstanding requests:' + outstandingRequests[hostPort].length;
      debuglog(msg);
      this.eventErrorCallback(msg);
      return;
    }
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

  var req = https.request(options, function(res) {
    var that = this;
    var body = '';
    var wasSuccess = false;
    if (res.statusCode == 204) {
      wasSuccess = true;
    }

    // need to read response data to trigger 'end' event.
    res.on('data', function(chunk) {
      body += chunk;
    });
    res.on('end', function() {
      if (wasSuccess) {
        debuglog('Event #' + eventId + ' triggered');
        that.eventFinishedCallback();
      } else {
        debuglog('Event #' + eventId + ' failed with an error');
        that.eventErrorCallback(body);
      }
    });
  }.bind(this));
  req.on('socket', function() {
    debuglog('Socket is allocated to event #' + eventId);
  });
  req.setTimeout(this.timeout, function() {
    debuglog('Event #' + eventId + ' timed out');
    req.abort();
  });
  req.write(jsonData);
  req.end();

  req.on('error', this.eventErrorCallback.bind(this));
};

module.exports = ModeDevice;
