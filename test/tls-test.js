const vows = require('vows');
const assert = require('assert');
const selfsigned = require('selfsigned');
const tls = require('tls');
const winston = require('winston');
require('../lib/winston-syslog').Syslog;

// ----- Constants
const HOST = 'localhost';
const PORT = 10514;
const PROMISE_TIMEOUT = 1000;

// ----- Helpers
function wrapToPromise(target, event) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject('Timeout for event promise');
    }, PROMISE_TIMEOUT);
    target.on(event, (...args) => {
      clearTimeout(timeout);
      resolve(...args);
    });
  });
}

function nodeMajorVersion() {
  return Number.parseInt(process.version.match(/^v(\d+\.\d+)/)[1], 10);
}

// ----- Certificate handling
function generateCertificate() {
  // Generate server and client certificates
  const attributes = [{ name: 'commonName', value: 'localhost' }];
  const x509 = selfsigned.generate(attributes, {
    days: 1,
    clientCertificate: true,
    extensions: [
      {
        name: 'keyUsage',
        keyCertSign: true,
        digitalSignature: true,
        nonRepudiation: true,
        keyEncipherment: true,
        dataEncipherment: true
      },
      {
        name: 'subjectAltName',
        altNames: [
          {
            type: 2, // DNS
            value: 'localhost'
          }
        ]
      }
    ]
  });
  return x509;
}

// ----- TLS configs
const x509 = generateCertificate();
const validServerTLS = {
  key: x509.private,
  cert: x509.cert,
  ca: [x509.cert],
  rejectUnauthorized: true,
  requestCert: true
};

const validClientTLS = {
  key: x509.clientprivate,
  cert: x509.clientcert,
  ca: [x509.cert],
  rejectUnauthorized: true
};

const untrustedClientTLS = {
  ...validClientTLS,
  ca: null
};

const missingClientTLS = {
  ca: null,
  key: null,
  cert: null,
  rejectUnauthorized: false
};

// ----- TLS Server
const serverEvents = {
  data: 'data',
  tlsClientError: 'tlsClientError',
  error: 'error',
  listening: 'listening',
  secureConnection: 'secureConnection'
};

async function startServer({ host = HOST, port = PORT, tlsOpts } = {}) {
  const server = tls.createServer({ ...tlsOpts });
  let clients = [];
  server.on('secureConnection', (client) => {
    clients.push(client);
    client.on('close', () => {
      clients = clients.filter((c) => c !== client);
    });
    client.on('data', (data) => {
      server.emit(serverEvents.data, data.toString());
    });
  });
  server.forceClose = () => {
    clients.forEach((client) => client.destroy());
    server.close();
  };
  server.listen({ host, port });
  await wrapToPromise(server, serverEvents.listening);
  return server;
}

// ----- Init Logger
function initLogger({ host = HOST, port = PORT, tlsOpts } = {}) {
  const syslogOptions = {
    host,
    port,
    protocol: 'tls4',
    protocolOptions: { ...tlsOpts }
  };
  const logger = winston.createLogger({
    transports: [new winston.transports.Syslog(syslogOptions)]
  });
  return logger;
}

// ----- Test Cases
const TEST_MESSAGE = 'Test Message';
const SYSLOG_FORMAT = `"message":"${TEST_MESSAGE}"`;

let serverInstance;

vows
  .describe('tls-connect')
  .addBatch({
    'Trying to connect to a TLS server with mutual TLS': {
      'topic': function () {
        startServer({ tlsOpts: validServerTLS }).then((server) => {
          serverInstance = server;
          const promise = wrapToPromise(server, serverEvents.data);
          initLogger({ tlsOpts: validClientTLS }).info(TEST_MESSAGE);
          promise.then(msg => this.callback(null, msg));
        });
      },
      'TLS server should receive log message': function (msg) {
        assert.include(msg, SYSLOG_FORMAT);
      },
      'teardown': function () {
        serverInstance.forceClose();
      }
    }
  })
  .addBatch({
    'Trying to connect to a TLS server with untrusted certificate': {
      'topic': function () {
        startServer({ tlsOpts: validServerTLS }).then((server) => {
          serverInstance = server;
          const logger = initLogger({ tlsOpts: untrustedClientTLS });
          logger.on('error', (loggerError) => {
            this.callback(null, loggerError);
          });
          logger.info(TEST_MESSAGE);
        });
      },
      'Client should refuse connection': function (e, loggerError) {
        assert.strictEqual(loggerError.code, 'DEPTH_ZERO_SELF_SIGNED_CERT');
        assert.include(loggerError.message, 'self signed certificate');
      },
      'teardown': function () {
        serverInstance.forceClose();
      }
    }
  })
  .addBatch({
    'Trying to connect to a TLS server without client certificate': {
      'topic': function () {
        startServer({ tlsOpts: validServerTLS }).then((server) => {
          serverInstance = server;
          const promise = wrapToPromise(server, serverEvents.tlsClientError);
          const logger = initLogger({ tlsOpts: missingClientTLS });
          logger.on('error', (loggerError) => {
            promise
              .then((serverError) => this.callback(null, loggerError, serverError))
              .catch((error) => this.callback(error, loggerError, null));
          });
          logger.info(TEST_MESSAGE);
        });
      },
      'Server should refuse connection': function (e, loggerError, serverError) {
        // Client and Server error type changes between Node versions
        if (nodeMajorVersion() >= 12) {
          assert.strictEqual(loggerError.code, 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED');
          assert.include(loggerError.message, 'alert number 116');
          assert.strictEqual(serverError.code, 'ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE');
          assert.include(serverError.message, 'peer did not return a certificate');
        } else {
          assert.strictEqual(loggerError.code, 'EPROTO');
          assert.include(loggerError.message, 'alert number 40');
          assert.include(serverError.message, 'peer did not return a certificate');
        }
      },
      'teardown': function () {
        serverInstance.forceClose();
      }
    }
  })
  .export(module);
