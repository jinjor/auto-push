var fs = require('fs');
var tls = require('tls');
var assign = require('object-assign');
var stream = require('stream');

var supportedProtocols = ['h2', 'h2-16', 'h2-14', 'http/1.1', 'http/1.0'];

function start(options) {
  console.log("Tunnel started.");

  var serverOptions = assign({
    NPNProtocols: supportedProtocols
  }, options.from.tlsOptions);
  var server = tls.createServer(serverOptions);

  server.on('secureConnection', function(socket) {
    console.log("Connection from " + socket.remoteAddress);
    var clientOptions = assign({
      NPNProtocols: [socket.npnProtocol]
    }, options.to.tlsOptions);

    var client = {};
    // try to connect to the server
    client.socket = tls.connect(options.to.port, clientOptions, function() {
      if (client.socket.authorized) {
        console.log("Auth success, connected to TLS server");
      } else {
        //Something may be wrong with your certificates
        console.log("Failed to auth TLS connection: ");
        console.log(client.socket.authorizationError);
      }
    });
    //sync the file descriptors, so that the socket data structures are the same
    client.socket.fd = socket.fd;

    var pipe = options.pipe || function(from, to) {
      from.pipe(to);// upstream
      to.pipe(from);// downstream
    };
    pipe(socket, client.socket);
    
    // socket.on("close", function() {
    //   server.close();
    //   client.socket.end();
    // });
  });

  server.listen(options.from.port);
}

module.exports = {
  start: start
};