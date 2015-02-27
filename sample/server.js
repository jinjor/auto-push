var fs = require('fs');
var autoPush = require('../index.js');
var http2 = require('http2');
var ecstatic = require('ecstatic');

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

http2.createServer(options, autoPush(ecstatic(__dirname + '/public'))).listen(8443);

// var h1proxy = require('../h1proxy.js');
// http.createServer(ecstatic(__dirname + '/public')).listen(8080);
// http2.createServer(options, autoPush(h1proxy(8080))).listen(8443);

