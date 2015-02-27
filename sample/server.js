var fs = require('fs');
var autoPush = require('../index.js');
var http = require('http');
var http2 = require('http2');
var ecstatic = require('ecstatic');
var h1proxy = require('../h1proxy.js');

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

function sample0() {
  http2.createServer(options, autoPush(ecstatic(__dirname + '/public'))).listen(8443);
}

function sample1() {
  http2.createServer(options, autoPush.static(__dirname + '/public')).listen(8443);
}

function sample2() {
  autoPush.server(options, __dirname + '/public').listen(8443);
}

function sample3() {
  http.createServer(ecstatic(__dirname + '/public')).listen(8080);
  http2.createServer(options, autoPush(h1proxy(8080))).listen(8443);
}

function sample4() {
  http.createServer(ecstatic(__dirname + '/public')).listen(8080);
  http2.createServer(options, autoPush.h1LocalProxy(8080)).listen(8443);
}

[sample0, sample1, sample2, sample3, sample4][process.argv[2] || 1]();