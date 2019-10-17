'use strict';

const vows = require('vows');
const assert = require('assert');
const Syslog = require('../lib/winston-syslog.js').Syslog;
const dgram = require('dgram');

const PORT = 11229;
let server;
let transport;
let maxUdpLength;
let message;

const { MESSAGE, LEVEL } = require('triple-beam');

vows
  .describe('syslog message')
  .addBatch({
    'Opening fake syslog UDP server': {
      'topic': function () {
        const self = this;
        server = dgram.createSocket('udp4');
        server.on('listening', function () {
          // Get the maximum buffer size for the current server.
          maxUdpLength = server.getSendBufferSize();
          self.callback();
        });

        server.bind(PORT);
      },
      'logging an oversize message': {
        'topic': function () {
          const chunks = [];
          // Generate message larger than max UDP message size.
          message = '#'.repeat(65000);
          transport = new Syslog({
            port: PORT
          });

          transport.emitter.on('chunk', function (chunk) {
            chunks.push(chunk);
          });

          transport.log({ [LEVEL]: 'debug', [MESSAGE]: message }, function (
            err
          ) {
            assert.ifError(err);
          });

          return chunks;
        },
        'correct number of chunks sent': function (chunks) {
          const sentMessage = chunks.reduce((acc, chunk) => {
            return (acc += chunk);
          }, '');
          assert.equal(
            Math.ceil(sentMessage.length / maxUdpLength),
            chunks.length
          );
        },
        'full message sent': function (chunks) {
          const sentMessageBody = chunks.reduce((acc, chunk) => {
            const regex = /#+/gm;
            const msg = chunk.match(regex);
            return (acc += msg);
          }, '');

          assert.equal(sentMessageBody, message);
          transport.close();
        }
      },
      'teardown': function () {
        server.close();
      }
    }
  })
  .export(module);
