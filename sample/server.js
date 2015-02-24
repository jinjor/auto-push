var fs = require('fs');
var autoPush = require('../index.js');
var bunyan = require('bunyan');

var createLogger = function(name) {
  return bunyan.createLogger({
    name: name,
    stream: process.stderr,
    level: process.env.HTTP2_LOG,
    serializers: require('../node_modules/http2/lib/http.js').serializers
  });
};

var options = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem'),
  // log: createLogger('server'),
    //   requestCert: true,
    // rejectUnauthorized: false,
    // NPNProtocols: ['h2-14', 'h2-16', 'http/1.1', 'http/1.0'], //unofficial
};

require('http2').createServer(options, autoPush.middleware({
  root: __dirname + '/public',
  
})).listen(8443);