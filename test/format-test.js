'use strict';

const vows = require('vows');
const assert = require('assert');
const Syslog = require('../lib/winston-syslog.js').Syslog;
const dgram = require('dgram');
const parser = require('@myndzi/glossy').Parse;

const PORT = 11229;
let server;
let transport;

const { MESSAGE, LEVEL } = require('triple-beam');

vows
  .describe('syslog messages')
  .addBatch({
    'opening fake syslog server': {
      'topic': function () {
        const self = this;
        server = dgram.createSocket('udp4');
        server.on('listening', function () {
          self.callback();
        });

        server.bind(PORT);
      },
      'default format': {
        'topic': function () {
          const self = this;
          server.once('message', function (msg) {
            parser.parse(msg, function (d) {
              self.callback(null, d);
            });
          });

          transport = new Syslog({
            port: PORT
          });
          transport.log({ [LEVEL]: 'debug', [MESSAGE]: 'ping' }, function (err) {
            assert.ifError(err);
          });
        },
        'should have host field set to localhost': function (msg) {
          assert.equal(msg.host, 'localhost');
          transport.close();
        },
        'setting locahost option to a different falsy value (null)': {
          'topic': function () {
            const self = this;
            server.once('message', function (msg) {
              parser.parse(msg, function (d) {
                self.callback(null, d);
              });
            });

            transport = new Syslog({
              port: PORT,
              localhost: null
            });

            transport.log({ [LEVEL]: 'debug', [MESSAGE]: 'ping2' }, function (
              err
            ) {
              assert.ifError(err);
            });
          },
          'should have host different from localhost': function (msg) {
            assert.notEqual(msg.host, 'localhost');
            transport.close();
          },
          'setting appName option to hello and type to 5424': {
            'topic': function () {
              const self = this;
              server.once('message', function (msg) {
                parser.parse(msg, function (d) {
                  self.callback(null, d);
                });
              });

              transport = new Syslog({
                port: PORT,
                type: '5424',
                appName: 'hello'
              });

              transport.log(
                { [LEVEL]: 'debug', [MESSAGE]: 'app name test' },
                function (err) {
                  assert.ifError(err);
                }
              );
            },
            'should have appName field set to hello': function (msg) {
              assert.equal(msg.appName, 'hello');
            },
            'should have proper time zone': function (msg) {
              const now = new Date();
              assert.equal((Math.abs((now - msg.time) / 1000) < 300), true);
            },
            'should have proper milliseconds format': function (msg) {
              const milliseconds = msg.originalMessage.split(' ')[1].slice(20, 23);
              assert.equal(isNaN(milliseconds), false);
              transport.close();
            },
            'setting app_name option to hello': {
              'topic': function () {
                const self = this;
                server.once('message', function (msg) {
                  parser.parse(msg, function (d) {
                    self.callback(null, d);
                  });
                });

                transport = new Syslog({
                  port: PORT,
                  type: '5424',
                  app_name: 'hello'
                });

                transport.log(
                  { [LEVEL]: 'debug', [MESSAGE]: 'app name test' },
                  function (err) {
                    assert.ifError(err);
                  }
                );
              },
              'should have appName field set to hello': function (msg) {
                assert.equal(msg.appName, 'hello');
                transport.close();
              }
            }
          }
        }
      },
      'teardown': function () {
        server.close();
      }
    }
  })
  .addBatch({
    'opening fake syslog server': {
      'topic': function () {
        var self = this;
        server = dgram.createSocket('udp4');
        server.on('listening', function () {
          self.callback();
        });

        server.bind(PORT);
      },
      'Custom producer': {
        'topic': function () {
          var self = this;
          server.once('message', function (msg) {
            self.callback(null, msg.toString());
          });

          function CustomProducer() {}
          CustomProducer.prototype.produce = function (opts) {
            return 'test ' + opts.severity + ': ' + opts.message;
          };

          transport = new Syslog({
            port: PORT,
            customProducer: CustomProducer
          });

          transport.log({ [LEVEL]: 'debug', [MESSAGE]: 'ping' }, function (err) {
            assert.ifError(err);
          });
        },
        'should apply custom syslog format': function (msg) {
          assert.equal(msg, 'test debug: ping');
          transport.close();
        }
      },
      'teardown': function () {
        server.close();
      }
    }
  })
  .export(module);
