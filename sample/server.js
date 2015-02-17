var fs = require('fs');
var express = require('express');
var compress = require('compression');
var autoPush = require('../index.js');

// application server
var app = express();
app.use(express.static(__dirname + '/public'));
app.listen(3000);

// proxy server
autoPush.proxy(8443, 3000);