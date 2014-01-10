/*
 * syslog.js: Transport for logging to a remote syslog consumer
 *
 * (C) 2011 Squeeks and Charlie Robbins
 * MIT LICENCE
 *
 */

var dgram = require('dgram'),
    net = require('net'),
    util = require('util'),
    glossy = require('glossy'),
    winston = require('winston'),
    unix = require('unix-dgram');

var levels = Object.keys({
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  crit: 5,
  alert: 6,
  emerg: 7
});

//
// ### function Syslog (options)
// #### @options {Object} Options for this instance.
// Constructor function for the Syslog Transport capable of sending
// RFC 3164 and RFC 5424 compliant messages.
//
var Syslog = exports.Syslog = function (options) {
  winston.Transport.call(this, options);
  options = options || {};
  // Set transport name
  this.name = 'syslog';
  //
  // Setup connection state
  //
  this.connected = false;
  this.retries = 0;
  this.queue = [];
  this.inFlight = 0;

  //
  // Merge the options for the target Syslog server.
  //
  this.host     = options.host     || 'localhost';
  this.port     = options.port     || 514;
  this.path     = options.path     || null;
  this.app_id   = options.app_id   || null;
  this.protocol = options.protocol || 'udp4';
  this.isDgram  = /^udp|unix/.test(this.protocol);

  if (!/^udp|unix|tcp/.test(this.protocol)) {
    throw new Error('Invalid syslog protocol: ' + this.protocol);
  }

  if (/^unix/.test(this.protocol) && !this.path) {
    throw new Error('`options.path` is required on unix dgram sockets.');
  }

  //
  // Merge the default message options.
  //
  this.localhost = options.localhost || 'localhost';
  this.type      = options.type      || 'BSD';
  this.facility  = options.facility  || 'local0';
  this.pid       = options.pid       || process.pid;
  this.app_name  = options.app_name  || process.title;

  //
  // Setup our Syslog and network members for later use.
  //
  this.socket   = null;
  this.producer = new glossy.Produce({
    type:     this.type,
    appName:  this.app_name,
    pid:      this.pid,
    facility: this.facility
  });
};

//
// Inherit from `winston.Transport`.
//
util.inherits(Syslog, winston.Transport);

//
// Define a getter so that `winston.transports.Syslog`
// is available and thus backwards compatible.
//
winston.transports.Syslog = Syslog;

//
// Expose the name of this Transport on the prototype
//
Syslog.prototype.name = 'Syslog';
//
// ### function log (level, msg, [meta], callback)
// #### @level {string} Target level to log to
// #### @msg {string} Message to log
// #### @meta {Object} **Optional** Additional metadata to log.
// #### @callback {function} Continuation to respond to when complete.
// Core logging method exposed to Winston. Logs the `msg` and optional
// metadata, `meta`, to the specified `level`.
//
Syslog.prototype.log = function (level, msg, meta, callback) {
  var self = this,
      data = typeof(meta) == 'object' && meta && Object.keys(meta).length ? winston.clone(meta) : {},
      syslogMsg,
      buffer;

  if (!~levels.indexOf(level)) {
    return callback(new Error('Cannot log unknown syslog level: ' + level));
  }

  data.message = msg;
  syslogMsg = this.producer.produce({
    severity: level,
    host:     this.localhost,
    app_id:   this.app_id || process.title,
    date:     new Date(),
    message:  typeof(meta) == 'object' && meta && Object.keys(meta).length ? JSON.stringify(data) : msg
  });

  //
  // Attempt to connect to the socket
  //
  this.connect(function (err) {
    if (err) {
      //
      // If there was an error enqueue the message
      //
      return self.queue.push(syslogMsg);
    }

    //
    // On any error writing to the socket, enqueue the message
    //
    function onError (logErr) {
      if (logErr) { self.queue.push(syslogMsg) }
      self.emit('logged');
      self.inFlight--;
    }

    //
    // Write to the `tcp*`, `udp*`, or `unix` socket.
    //
    if (self.isDgram) {
      buffer = new Buffer(syslogMsg);
      if (self.protocol.match(/^udp/)) {
        self.inFlight++;
        self.socket.send(buffer, 0, buffer.length, self.port, self.host, onError);
      }
      else {
        self.socket.send(buffer, 0, buffer.length, self.path, onError);
      }
    }
    else {
      self.socket.write(syslogMsg, 'utf8', onError);
    }
  });

  callback(null, true);
};
//
// ### function close ()
// Closes the socket used by this transport freeing the resource.
//
Syslog.prototype.close = function () {
  var self = this,
      max = 6,
      attempt = 0;
  (function _close(){
    if(attempt>=max || (self.queue.length === 0 && self.inFlight <= 0)){
        self.socket.close();
        self.emit('closed', self.socket);
    }else{
      attempt++
      setTimeout(_close, 200 * attempt);
    }
  }());
}
//
// ### function connect (callback)
// #### @callback {function} Continuation to respond to when complete.
// Connects to the remote syslog server using `dgram` or `net` depending
// on the `protocol` for this instance.
//
Syslog.prototype.connect = function (callback) {
  var self = this, readyEvent;

  //
  // If the socket already exists then respond
  //
  if (this.socket) {
    return (!this.socket.readyState) || (this.socket.readyState === 'open')
      ? callback(null)
      : callback(true);
  }

  //
  // Create the appropriate socket type.
  //
  if (this.isDgram) {
    if (self.protocol.match(/^udp/)) {
      this.socket = new dgram.Socket(this.protocol);
    }
    else {
      this.socket = new unix.createSocket('unix_dgram');
    }

    return callback(null);
  }
  else {
    this.socket = new net.Socket({ type: this.protocol });
    this.socket.setKeepAlive(true);
    this.socket.setNoDelay();
    readyEvent = 'connect';
  }

  //
  // On any error writing to the socket, emit the `logged` event
  // and the `error` event.
  //
  function onError (logErr) {
    if (logErr) { self.emit('error', logErr) }
    self.emit('logged');
    self.inFlight--;
  }

  //
  // Indicate to the callee that the socket is not ready. This
  // will enqueue the current message for later.
  //
  callback();


  //
  // Listen to the appropriate events on the socket that
  // was just created.
  //
  this.socket.on(readyEvent, function () {
    //
    // When the socket is ready, write the current queue
    // to it.
    //
    self.socket.write(self.queue.join(''), 'utf8', onError);

    self.emit('logged');
    self.queue = [];
    self.retries = 0;
    self.connected = true;
  }).on('error', function (ex) {
    //
    // TODO: Pass this error back up
    //
  }).on('end', function (ex) {
    //
    // Nothing needs to be done here.
    //
  }).on('close', function (ex) {
    //
    // Attempt to reconnect on lost connection(s), progressively
    // increasing the amount of time between each try.
    //
    var interval = Math.pow(2, self.retries);
    self.connected = false;

    setTimeout(function () {
      self.retries++;
      self.socket.connect(self.port, self.host);
    }, interval * 1000);
  }).on('timeout', function () {
    if (self.socket.readyState !== 'open') {
      self.socket.destroy();
    }
  });

  this.socket.connect(this.port, this.host);
};
