/*
 * syslog-test.js: Tests for instances of the Syslog transport
 *
 * (C) 2010 Charlie Robbins
 * MIT LICENSE
 *
 */

var path = require('path'),
    vows = require('vows'),
    assert = require('assert'),
    winston = require('winston'),
    helpers = require('winston/test/helpers'),
    Syslog = require('../lib/winston-syslog').Syslog;

function assertSyslog(transport) {
  assert.instanceOf(transport, Syslog);
  assert.isFunction(transport.log);
  assert.isFunction(transport.connect);
}

function closeTopic() {
  var transport = new winston.transports.Syslog(),
      logger = new winston.Logger({ transports: [transport] });

  logger.log('debug', 'Test message to actually use socket');
  logger.remove({ name: 'syslog' });

  return transport;
}

var transport = new Syslog();

vows.describe('winston-syslog').addBatch({
  'An instance of the Syslog Transport': {
    'should have the proper methods defined': function () {
      assertSyslog(transport);
    },
    'the log() method': helpers.testSyslogLevels(transport, 'should log messages to syslogd', function (ign, err, ok) {
      assert.isNull(ign);
      assert.isTrue(!err);
      assert.isTrue(ok);
      assert.equal(transport.queue.length, 0); // This is > 0 because winston-syslog.js line 124
    })
    //
    // TODO: Figure out why this hangs.
    //
    // 'on close': {
    //   topic: closeTopic,
    //   on: {
    //     closed: {
    //       'closes the socket': function (socket) {
    //         assert.isNull(socket._handle);
    //       }
    //     }
    //   }
    // }
  }
}).export(module);

//
// TODO: Close all the syslog connections so vows exits.
//
setTimeout(function () {
  process.exit(0);
}, 5000);
