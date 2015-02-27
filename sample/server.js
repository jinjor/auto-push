var fs = require('fs');
var autoPush = require('../index.js');
var http2 = require('http2');
var ecstatic = require('ecstatic');
var http = require('http');

var createLogger = function(name) {
  return bunyan.createLogger({
    name: name,
    stream: process.stderr,
    level: process.env.HTTP2_LOG,
    serializers: require('./node_modules/http2/lib/http.js').serializers
  });
};

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

http2.createServer(options, autoPush(ecstatic(__dirname + '/public'))).listen(8443);



// var h1proxy = require('../h1proxy.js');
// http.createServer(ecstatic(__dirname + '/public')).listen(8080);
// http2.createServer(options, autoPush(h1proxy(8080))).listen(8443);

