var ws = require('ws');
var http = require('http');
var https = require('https');
var url = require('url');

function debuglog(/* ...  */) {
  if (!ModeDevice.debug) {
    return;
  }

  if (arguments.length == 0) {
    return;
  }

  if (typeof arguments[0] == 'string') {
    arguments[0] = '[MODE-DEVICE] ' + arguments[0];
  } else {
    arguments.unshift('[MODE-DEVICE]');
  }

  console.log.apply(null, arguments);
}

var defaultEventErrorCallback = function(error) {
  console.error('Event Error: %s', error);
};

var defaultEventFinishedCallback = function() {
  // noop
};

var defaultCommandCallback = function(cmd) {
  console.log('Received command: action=%s parameters=%s', cmd.action, JSON.stringify(cmd.parameters));
};

var ModeDevice = function(deviceId, token) {
  this.token = token;
  this.deviceId = deviceId;
  this.timeout = 10 * 1000; // request timeout in msec
  this.maxRequests = 10;  // number of simultaneous requests it will process
  this.eventCounter = 0;  // sequence id for events
  this.eventErrorCallback = defaultEventErrorCallback;
  this.eventFinishedCallback = defaultEventFinishedCallback;

  this.apiHost = 'api.tinkermode.com';
  this.apiPort = 443;
  this.apiUseTls = true;
  this.setUpApiHttp();

  this._listeningCommands = false;
  this.commandCallback = defaultCommandCallback;

  this._websocket = null;
  this._wsPingTimer = null;
  this._wsPendingPingMsg = null;
  this._wsReconnectAttempts = 0;
  this._wsReconnectDelay = 0; // seconds
  this._wsReconnectTimer = null;
};

ModeDevice.debug = false;
ModeDevice.WS_PING_INTERVAL = 33; // seconds

// Deprecated. Use setApiHostPort() instead.
ModeDevice.prototype.setApiHost = function(host) {
  this.apiHost = host;
};

ModeDevice.prototype.setApiHostPort = function(host, port, useTls) {
  this.apiHost = host;
  this.apiPort = port;
  this.apiUseTls = useTls;
  this.setUpApiHttp();
};

ModeDevice.prototype.setUpApiHttp = function() {
  var agentOpts = {
    keepAlive: true,
    maxSockets: 20,
  };

  if (this.apiUseTls) {
    this.apiHttpTransport = https;
    this.apiHttpAgent = new https.Agent(agentOpts);
  }
  else {
    this.apiHttpTransport = http;
    this.apiHttpAgent = new http.Agent(agentOpts);
  }
};

ModeDevice.prototype._wsDisconnect = function() {
  if (this._websocket !== null) {
    debuglog('Closing websocket');
    this._websocket.close();
  }
};

ModeDevice.prototype._wsCleanUp = function() {
  this._websocket = null;

  if (this._wsPingTimer) {
    debuglog('Stopping websocket pings');
    clearInterval(this._wsPingTimer);
    this._wsPingTimer = null;
  }

  this._wsPendingPingMsg = null;
};

ModeDevice.prototype._wsHandleError = function(error) {
  debuglog('Websocket error: %s', error);
  this._wsCleanUp();
  this._wsScheduleReconnect();
};

ModeDevice.prototype._wsHandleClose = function(code, reason) {
  debuglog('Websocket connection has closed: code=%d reason="%s"', code, reason);
  this._wsCleanUp();
  this._wsScheduleReconnect();
};

ModeDevice.prototype._wsHandleOpen = function() {
  debuglog('Websocket connection is open');

  this._wsReconnectAttempts = 0;
  this._wsReconnectDelay = 0;

  debuglog('Scheduling periodic websocket pings');
  this._wsPingTimer = setInterval(this._wsPing.bind(this), ModeDevice.WS_PING_INTERVAL * 1000);
};

ModeDevice.prototype._wsHandleMessage = function(message) {
  debuglog('Received websocket message: "%s"', message);
  var data;
  try {
    data = JSON.parse(message);
  } catch (e) {
    debuglog('Message is invalid JSON');
    return;
  }

  try {
    this.commandCallback(data);
  } catch (e) {
    debuglog('Error in command callback: %s', e);
  }
};

ModeDevice.prototype._wsPing = function() {
  if (this._wsPendingPingMsg != null) {
    // Did not receive pong for the previous ping.
    debuglog('Did not receive websocket pong for ping (%s)', this._wsPendingPingMsg);
    this._wsDisconnect(); // this will trigger auto reconnection.
    return;
  }

  if (this._websocket) {
    const msg = 'ts=' + Date.now();

    try {
      this._websocket.ping(msg);
    } catch (e) {
      debuglog('Failed to ping websocket: %s', e);
      this._wsDisconnect(); // this will trigger auto reconnection.
      return;
    }

    this._wsPendingPingMsg = msg;
    debuglog('Sent websocket ping: %s', msg);
  }
};

ModeDevice.prototype._wsHandlePong = function(msg) {
  debuglog('Received websocket pong: %s', msg);
  if (msg == this._wsPendingPingMsg) {
    this._wsPendingPingMsg = null;
  }
};

ModeDevice.prototype._wsConnect = function() {
  const proto = this.apiUseTls ? 'wss' : 'ws';
  const target = proto + '://' + this.apiHost + ':' + this.apiPort + '/devices/' + this.deviceId + '/command';

  debuglog('Making websocket connection to %s', target);
  this._websocket = new ws(target, {
    agent: this.apiHttpAgent,
    headers: {
      "Authorization": 'ModeCloud ' + this.token
    }
  });

  this._websocket.on('error', this._wsHandleError.bind(this));
  this._websocket.on('close', this._wsHandleClose.bind(this));
  this._websocket.on('open', this._wsHandleOpen.bind(this));
  this._websocket.on('message', this._wsHandleMessage.bind(this));
  this._websocket.on('pong', this._wsHandlePong.bind(this));

  this._wsReconnectTimer = null;
};

ModeDevice.prototype._wsScheduleReconnect = function() {
  if (!this._listeningCommands) {
    // This is triggered by a graceful shutdown, so no need to reconnect.
    return;
  }

  if (this._wsReconnectDelay < 60) {
    // exponential backoff
    this._wsReconnectDelay = Math.pow(2, this._wsReconnectAttempts);
  }

  this._wsReconnectAttempts++;
  debuglog('Retrying websocket connection in %d seconds (attempt #%d)', this._wsReconnectDelay, this._wsReconnectAttempts);

  // Make sure we never double-schedule reconnection.
  if (this._wsReconnectTimer) {
    clearTimeout(this._wsReconnectTimer);
  }

  this._wsReconnectTimer = setTimeout(this._wsConnect.bind(this), this._wsReconnectDelay * 1000);
};

ModeDevice.prototype.listenCommands = function() {
  if (this._listeningCommands) {
    return;
  }

  debuglog('Start listening to commands');
  this._listeningCommands = true;
  this._wsReconnectAttempts = 0;
  this._wsRconnectDelay = 0;
  this._wsConnect();
};

ModeDevice.prototype.stopCommands = function() {
  if (!this._listeningCommands) {
    return;
  }

  debuglog('Stop listening to commands');
  this._listeningCommands = false;
  this._wsDisconnect();

  // Make sure any scheduled reconnection is cancelled.
  if (this._wsReconnectTimer) {
    clearTimeout(this._wsReconnectTimer);
    this._wsReconnectTimer = null;
  }
};

ModeDevice.prototype.triggerEvent = function(eventType, eventData) {
  this.eventCounter += 1;
  var eventId = this.eventCounter;
  debuglog('Triggering event #%d', eventId);

  if((typeof eventType) != "string" && !(eventType instanceof String)) {
    throw "eventType must be string";
  }

  if((typeof eventData) != "object" || (eventData instanceof Array)) {
    throw "eventData must be object";
  }

  // Try not to pile up requests when the network is unstable.
  var outstandingRequests = this.apiHttpAgent.requests;

  var hostPort = this.apiHost + ':' + this.apiPort;
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
    host: this.apiHost,
    port: this.apiPort,
    agent: this.apiHttpAgent,
    path: '/devices/' + this.deviceId + '/event',
    method: 'PUT',
    headers: {
      "Content-Type": 'application/json',
      "Content-Length": jsonData.length,
      "Authorization": 'ModeCloud ' + this.token
    }
  };

  var req = this.apiHttpTransport.request(options, function(res) {
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
        debuglog('Event #%d triggered', eventId);
        that.eventFinishedCallback();
      } else {
        debuglog('Event #%d failed with an error', eventId);
        that.eventErrorCallback(body);
      }
    });
  }.bind(this));

  req.setTimeout(this.timeout, function() {
    debuglog('Event #%d has timed out', eventId);
    req.abort();
  });
  req.write(jsonData);
  req.end();

  req.on('error', this.eventErrorCallback.bind(this));
};

module.exports = ModeDevice;
