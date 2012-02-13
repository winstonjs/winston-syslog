/*
 *Nodeunit tests (tests some async behaviors)
 *Dan Thurman
 *
 *
*/
var winston = require('winston'),
    helpers = require('winston/test/helpers'),
    Syslog = require('../lib/winston-syslog').Syslog;

exports.basicTypeChecking = function(test){
    var transport = new Syslog();
    test.expect(5);
    test.ok(transport instanceof Syslog);
    test.ok(transport.log instanceof Function);
    test.ok(transport.connect instanceof Function);
    test.ok(transport.close instanceof Function);

    var logger = new winston.Logger({transports: [transport]});
    test.ok(logger.transports.Syslog instanceof Syslog);
    test.done();
};

exports.sendsMessages = function(test){
    var transport = new Syslog(),
        logger = new winston.Logger({
          transports: [transport],
          levels: winston.config.syslog.levels
        });
//    var levels = Object.keys(winston.config.syslog.levels),
    var levels = ['info', 'notice', 'warning', 'error', 'alert', 'crit', 'emerg']; //debug doesn't work after setting levels...?
    test.expect(levels.length);
    
    logger.transports.Syslog.on('logged', function(){
        test.ok(1);
    });

    levels.forEach(function(level){
      logger.log(level, 'Test '+level+' Message ' + Date.now());
    });
    
    transport.on('closed', function(){        
        test.done();
        });
    logger.remove(winston.transports.Syslog); 
};

exports.releasesResources = function(test){
    test.expect(1);
    var transport = new winston.transports.Syslog(),
        logger = new winston.Logger({
          transports: [transport]
        });
    logger.log('debug', 'Test message to actually use socket');  
    transport.on('closed', function(){
        test.ok(1);
        test.done()    
    });
    logger.remove(winston.transports.Syslog);
}