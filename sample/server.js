var fs = require('fs');
var autoPush = require('../index.js');
var http = require('http');
var http2 = require('http2');
var ecstatic = require('ecstatic');
var h1proxy = require('./h1proxy.js');
var h2proxy = require('./h2proxy.js');

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

function sample0() {
  http2.createServer(options, autoPush(ecstatic(__dirname + '/public'))).listen(8443);
}

function sample1() {
  http2.createServer(options, _static(__dirname + '/public')).listen(8443);
}

function sample2() {
  autoPush.server(options, __dirname + '/public').listen(8443);
}

function sample3() {
  http.createServer(ecstatic(__dirname + '/public')).listen(8090);
  http2.createServer(options, autoPush(h1proxy(8090))).listen(8443);
}

function sample4() {
  http.createServer(ecstatic(__dirname + '/public')).listen(8090);
  http2.createServer(options, autoPush.h1LocalProxy(8090)).listen(8443);
}

[sample0, sample1, sample2, sample3, sample4][process.argv[2] || 0]();

function _static(root) {
  return autoPush(ecstatic(root));
};
function server(options, root) {
  return http2.createServer(options, autoPush(ecstatic(root)));
};
function h1LocalProxy(port) {
  return autoPush(h1proxy(port));
};
// function h2LocalProxy(fromOptions, toOptions) {
//   h2Proxy.start({
//     from: fromOptions,
//     to: toOptions,
//     pipe: function(from, to) {
//       //TODO push_promise to 'from', GET request to 'to'
//     }
//   });
// };