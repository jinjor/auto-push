var fs = require('fs');
var autoPush = require('../index.js');
var express = require('express');
var http2 = require('http2');
var ecstatic = require('ecstatic');
var serveStatic = require('serve-static');
var http2 = require('http2');
var https = require('https');

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

var app = express();

app.use(autoPush(ecstatic(__dirname + '/public')));

http2.createServer(options, app).listen(8443);