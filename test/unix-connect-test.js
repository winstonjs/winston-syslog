var fs = require('fs');
var vows = require('vows');
var assert = require('assert');
var winston = require('winston');
var unix = require('unix-dgram');
var parser = require('glossy').Parse;
var Syslog = require('../lib/winston-syslog').Syslog;

var SOCKNAME = '/tmp/unix_dgram.sock';

var transport = new Syslog({
  protocol: 'unix-connect',
  path: SOCKNAME
});

try {
  fs.unlinkSync(SOCKNAME);
}
catch (e) {
  /* swallow */
}

var times = 0;
var server;

vows.describe('unix-connect').addBatch({
  'Trying to log to a non-existant log server': {
    'should enqueue the log message': function () {
      transport.once('error', function (err) {
        assert(err);
        assert.equal(err.syscall, 'connect');
      });

      transport.log('debug', 'data' + (++times), null, function (err) {
        assert(err);
        assert.equal(err.syscall, 'connect');
        assert.equal(transport.queue.length, 1);
      });
    }
  }
}).addBatch({
  'Logging when log server is up': {
    'should log enqueued msg and then new msg': function () {
      var n = 0;
      server = unix.createSocket('unix_dgram', function (buf, rinfo) {
        parser.parse(buf, function (d) {
          assert.equal(d.message, 'data' + (++n));
        });
      });

      server.bind(SOCKNAME);
      transport.log('debug', 'data' + (++times), null, function (err) {
        assert.ifError(err);
      });
    }
  }
}).addBatch({
  'Logging if server goes down again': {
    'should enqueue the log message': function () {
      transport.once('error', function (err) {
        assert(err);
        assert.equal(err.syscall, 'send');
        process.nextTick(function () {
          assert.equal(transport.queue.length, 1);
        });
      });

      server.close();

      transport.log('debug', 'data' + (++times), null, function (err) {
        assert.ifError(err);
      });
    }
  }
}).export(module);

//
// TODO: Close all the syslog connections so vows exits.
//
setTimeout(function () {
  process.exit(0);
}, 5000);
