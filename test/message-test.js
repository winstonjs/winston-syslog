'use strict';

const vows = require('vows');
const assert = require('assert');
const sinon = require('sinon');
const Syslog = require('../lib/winston-syslog.js').Syslog;
const dgram = require('dgram');

const PORT = 11229;
let server;
let transport;
let maxUdpLength;
let message;
let sentMessage;
let numChunks;

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
          // Generate message larger than max UDP message size.
          message = '#'.repeat(65000);
          transport = new Syslog({
            port: PORT
          });

          sinon.spy(transport, 'chunkMessage');
          sinon.spy(transport, '_sendChunk');

          transport.log({ [LEVEL]: 'debug', [MESSAGE]: message }, function (
            err
          ) {
            assert.ifError(err);
          });

          return null;
        },
        'correct number of chunks sent': function () {
          assert(transport.chunkMessage.calledTwice);

          sentMessage = transport.chunkMessage.getCall(0).args[0];
          numChunks = Math.ceil(sentMessage.length / maxUdpLength);
          assert.equal(numChunks, transport._sendChunk.callCount);
        },
        'correct chunks sent': function () {
          let offset = 0;
          let i = 0;

          sentMessage = transport.chunkMessage.getCall(0).args[0];
          while (offset < sentMessage.length) {
            const length =
              offset + maxUdpLength > sentMessage.length
                ? sentMessage.length - offset
                : maxUdpLength;
            const buffer = Buffer.from(sentMessage);
            const options = {
              offset: offset,
              length: length,
              port: transport.port,
              host: transport.host
            };

            assert(transport._sendChunk.getCall(i).calledWith(buffer, options));

            offset += length;
            i++;
          }

          transport.close();
        }
      },
      'teardown': function () {
        transport.chunkMessage.restore();
        transport._sendChunk.restore();
        server.close();
      }
    }
  })
  .export(module);
