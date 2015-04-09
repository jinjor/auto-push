var fs = require('fs');
var autoPush = require('../index.js');
var http = require('http');
var http2 = require('http2');
var ecstatic = require('ecstatic');
var st = require('st');
var h1proxy = require('./h1proxy.js');
var h2proxy = require('./h2proxy.js');

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

function sample0() {
  http2.createServer(options, autoPush(_static())).listen(8443);
  // http2.createServer(options, _static()).listen(8443);
}

function sample1() {
  server(options, __dirname + '/public').listen(8443);
}

function sample2() {
  http.createServer(_static()).listen(8090);
  http2.createServer(options, autoPush(h1proxy(8090))).listen(8443);
}

function sample3() {
  http.createServer(_static()).listen(8090);
  http2.createServer(options, autoPush.h1LocalProxy(8090)).listen(8443);
}

[sample0, sample1, sample2, sample3][process.argv[2] || 0]();

function _static() {
  return ecstatic({
    root: __dirname + '/public',
    cache: 3600,
  });
  // return st({
  //   // cache: false,
  //   path: 'public/',
  //   index: 'index.html',
  //   gzip: false
  // });
};

function server(options, root) {
  return http2.createServer(options, autoPush(_static()));
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
