/* eslint no-sync: "off" */

var fs = require('fs');
var vows = require('vows');
var assert = require('assert');
var unix = require('unix-dgram');
var parser = require('glossy').Parse;
var Syslog = require('../lib/winston-syslog').Syslog;

const { MESSAGE, LEVEL } = require('triple-beam');

var SOCKNAME = '/tmp/unix_dgram.sock';

var transport = new Syslog({
  protocol: 'unix-connect',
  path: SOCKNAME
});

try {
  fs.unlinkSync(SOCKNAME);
} catch (e) {
  /* swallow */
}

var times = 0;
var server;

vows.describe('unix-connect').addBatch({
  'Trying to log to a non-existant log server': {
    'topic': function () {
      var self = this;
      transport.once('error', function (err) {
        self.callback(null, err);
      });

      transport.log({ [LEVEL]: 'debug', [MESSAGE]: `data${++times}` }, function (err) {
        assert(err);
        assert.equal(err.syscall, 'connect');
        assert.equal(transport.queue.length, 1);
      });
    },
    'should enqueue the log message': function (err) {
      assert(err);
      assert.equal(err.syscall, 'connect');
    }
  }
}).addBatch({
  'Logging when log server is up': {
    'topic': function () {
      var self = this;
      var n = 0;
      server = unix.createSocket('unix_dgram', function (buf) {
        parser.parse(buf, function (d) {
          ++n;
          assert(n <= 2);
          assert.equal(d.message, 'node[' + process.pid + ']: data' + n);
          assert.equal(d.severity, 'debug');
          if (n === 2) {
            self.callback();
          }
        });
      });

      server.bind(SOCKNAME);
      transport.log({ [LEVEL]: 'debug', [MESSAGE]: `data${++times}` }, function (err) {
        assert.ifError(err);
      });
    },
    'should print both the enqueed and the new msg': function (err) {
      assert.ifError(err);
    }
  }
}).addBatch({
  'Logging if server goes down again': {
    'topic': function () {
      var self = this;
      transport.once('error', function (err) {
        self.callback(null, err);
      });

      server.close();

      transport.log({ [LEVEL]: 'debug', [MESSAGE]: `data${++times}` }, function (err) {
        assert.ifError(err);
        assert.equal(transport.queue.length, 1);
      });
    },
    'should enqueue the log message': function (err) {
      assert(err);
      assert.equal(err.syscall, 'send');
      transport.close();
    }
  }
}).addBatch({
  'Logging works if server comes up again': {
    'topic': function () {
      var self = this;
      var n = 2;
      try {
        fs.unlinkSync(SOCKNAME);
      } catch (e) {
        /* swallow */
      }
      server = unix.createSocket('unix_dgram', function (buf) {
        parser.parse(buf, function (d) {
          ++n;
          assert(n <= 4);
          assert.equal(d.message, 'node[' + process.pid + ']: data' + n);
          assert.equal(d.severity, 'debug');
          if (n === 4) {
            self.callback();
          }
        });
      });

      server.bind(SOCKNAME);
      transport.log({ [LEVEL]: 'debug', [MESSAGE]: `data${++times}` }, function (err) {
        assert.ifError(err);
      });
    },
    'should print both the enqueed and the new msg': function (err) {
      assert.ifError(err);
      server.close();
    }
  }

}).export(module);
