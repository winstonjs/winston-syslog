/*
 * syslog.js: Transport for logging to a remote syslog consumer
 *
 * (C) 2011 Squeeks and Charlie Robbins
 * MIT LICENCE
 *
 */

const dgram = require('dgram');
const net = require('net');
const utils = require('./utils');
const glossy = require('glossy');
const winston = require('winston');
const Transport = require('winston-transport');
const { MESSAGE, LEVEL } = require('triple-beam');

// Ensure we have the correct winston here.
if (Number(winston.version.split('.')[0]) < 3) {
  throw new Error('Winston-syslog requires winston >= 3.0.0');
}

const levels = Object.keys({
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
class Syslog extends Transport {
  //
  // Expose the name of this Transport on the prototype
  //
  get name() {
    return 'syslog';
  }

  constructor(options = {}) {
    //
    // Inherit from `winston-transport`.
    //
    super(options);

    //
    // Setup connection state
    //
    this.connected = false;
    this.congested = false;
    this.retries = 0;
    this.queue = [];
    this.inFlight = 0;

    //
    // Merge the options for the target Syslog server.
    //
    this.setOptions(options);

    //
    // Setup our Syslog and network members for later use.
    //
    this.socket   = null;
    this.producer = new glossy.Produce({
      type: this.type,
      appName: this.appName,
      pid: this.pid,
      facility: this.facility
    });
  }

  setOptions(options) {
    this.host = options.host || 'localhost';
    this.port = options.port || 514;
    this.path = options.path || null;
    this.protocol = options.protocol || 'udp4';
    this.endOfLine = options.eol;

    this.parseProtocol(this.protocol);

    //
    // Merge the default message options.
    //
    this.localhost = typeof options.localhost !== 'undefined' ? options.localhost : 'localhost';
    this.type = options.type || 'BSD';
    this.facility = options.facility || 'local0';
    this.pid = options.pid || process.pid;
    this.appName = options.appName || options.app_name || process.title;
  }

  parseProtocol(protocol = this.protocol) {
    const parsedProtocol = utils.parseProtocol(protocol);

    this.protocolType   = parsedProtocol.type;
    this.protocolFamily = parsedProtocol.family;
    this.isDgram        = parsedProtocol.isDgram;

    if (this.protocolType === 'unix' && !this.path) {
      throw new Error('`options.path` is required on unix dgram sockets.');
    }
  }

  //
  // ### function log (info, callback)
  // #### @info {object} All relevant log information
  // #### @callback {function} Continuation to respond to when complete.
  // Core logging method exposed to Winston. Logs the `msg` and optional
  // metadata, `meta`, to the specified `level`.
  //
  log(info, callback) {
    if (!~levels.indexOf(info[LEVEL])) {
      return callback(new Error('Cannot log unknown syslog level: ' + info[LEVEL]));
    }

    const output = info[MESSAGE];

    const syslogMsg = this.producer.produce({
      severity: info[LEVEL],
      host: this.localhost,
      date: new Date(),
      message: this.endOfLine ? output + this.endOfLine : output
    });

    //
    // Attempt to connect to the socket
    //
    this.connect((err) => {
      if (err) {
        //
        // If there was an error enqueue the message
        //
        this.queue.push(syslogMsg);

        return callback(err);
      }

      //
      // On any error writing to the socket, enqueue the message
      //
      const onError = (logErr) => {
        if (logErr) {
          this.queue.push(syslogMsg);
          this.emit('error', logErr);
        }
        this.emit('logged', info);
        this.inFlight--;
      };

      const onCongestion = () => {
        onError(new Error('Congestion Error'));
      };

      const sendDgram = () => {
        const buffer = new Buffer(syslogMsg);

        if (this.protocolType === 'udp') {
          this.inFlight++;
          this.socket.send(buffer, 0, buffer.length, this.port, this.host, onError);
        } else if (this.protocol === 'unix') {
          this.inFlight++;
          this.socket.send(buffer, 0, buffer.length, this.path, onError);
        } else if (this.congested) {
          this.queue.push(syslogMsg);
        } else {
          this.socket.once('congestion', onCongestion);
          this.inFlight++;
          this.socket.send(buffer, (e) => {
            this.socket.removeListener('congestion', onCongestion);
            onError(e);
          });
        }
      };

      //
      // Write to the `tcp*`, `udp*`, or `unix` socket.
      //
      if (this.isDgram) {
        sendDgram();
      } else {
        this.socket.write(syslogMsg, 'utf8', onError);
      }

      callback(null, true);
    });
  }

  //
  // ### function close ()
  // Closes the socket used by this transport freeing the resource.
  //
  close() {
    const max = 6;
    let attempt = 0;

    const _close = () => {
      if (attempt >= max || (this.queue.length === 0 && this.inFlight <= 0)) {
        if (this.socket) {
          this.socket.close();
        }

        this.emit('closed', this.socket);
      } else {
        attempt++;
        setTimeout(_close, 200 * attempt);
      }
    };
    _close();
  }

  connectDgram(callback) {
    if (this.protocol === 'unix-connect') {
      return this._unixDgramConnect(callback);
    } else if (this.protocol === 'unix') {
      this.socket = require('unix-dgram').createSocket('unix_dgram');
    } else {
      // UDP protocol
      this.socket = new dgram.Socket(this.protocol);
    }

    return callback(null);
  }
  //
  // ### function connect (callback)
  // #### @callback {function} Continuation to respond to when complete.
  // Connects to the remote syslog server using `dgram` or `net` depending
  // on the `protocol` for this instance.
  //
  connect(callback) {
    //
    // If the socket already exists then respond
    //
    if (this.socket) {
      return ((!this.socket.readyState) || (this.socket.readyState === 'open')) || this.socket.connected
        ? callback(null)
        : callback(true);
    }

    //
    // Create the appropriate socket type.
    //
    if (this.isDgram) {
      return this.connectDgram(callback);
    }

    this.socket = new net.Socket();
    this.socket.setKeepAlive(true);
    this.socket.setNoDelay();

    this.setupEvents();

    const connectConfig = {
      host: this.host,
      port: this.port
    };

    if (this.protocolFamily) {
      connectConfig.family = this.protocolFamily;
    }

    this.socket.connect(connectConfig);

    //
    // Indicate to the callee that the socket is not ready. This
    // will enqueue the current message for later.
    //
    callback(true);
  }

  setupEvents() {
    const readyEvent = 'connect';
    //
    // On any error writing to the socket, emit the `logged` event
    // and the `error` event.
    //
    const onError = (logErr) => {
      if (logErr) { this.emit('error', logErr); }
      this.emit('logged');
      this.inFlight--;
    };

    //
    // Listen to the appropriate events on the socket that
    // was just created.
    //
    this.socket.on(readyEvent, () => {
      //
      // When the socket is ready, write the current queue
      // to it.
      //
      this.socket.write(this.queue.join(''), 'utf8', onError);

      this.emit('logged');
      this.queue = [];
      this.retries = 0;
      this.connected = true;
    }).on('error', function () {
      //
      // TODO: Pass this error back up
      //
    }).on('close', () => {
      //
      // Attempt to reconnect on lost connection(s), progressively
      // increasing the amount of time between each try.
      //
      const interval = Math.pow(2, this.retries);
      this.connected = false;

      setTimeout(() => {
        this.retries++;
        this.socket.connect(this.port, this.host);
      }, interval * 1000);
    }).on('timeout', () => {
      if (this.socket.readyState !== 'open') {
        this.socket.destroy();
      }
    });
  }

  _unixDgramConnect(callback) {
    const self = this;

    const flushQueue = () => {
      let sentMsgs = 0;
      this.queue.forEach((msg) => {
        const buffer = new Buffer(msg);

        if (!this.congested) {
          this.socket.send(buffer, function () {
            ++sentMsgs;
          });
        }
      });

      this.queue.splice(0, sentMsgs);
    };

    this.socket = require('unix-dgram').createSocket('unix_dgram');
    this.socket.on('error', (err) => {
      this.emit('error', err);

      if (err.syscall === 'connect') {
        this.socket.close();
        this.socket = null;
        return callback(err);
      }
      if (err.syscall === 'send') {
        this.socket.close();
        this.socket = null;
      }
    });

    this.socket.on('connect', function () {
      this.on('congestion', () => {
        self.congested = true;
      });

      this.on('writable', () => {
        self.congested = false;
        flushQueue();
      });

      flushQueue();
      callback();
    });

    this.socket.connect(this.path);
  }
}

//
// Define a getter so that `winston.transports.Syslog`
// is available and thus backwards compatible.
//
winston.transports.Syslog = Syslog;

module.exports = {
  Syslog
};
