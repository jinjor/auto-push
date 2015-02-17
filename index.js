var http2 = require('node-simple-http2');
var Path = require('path');
var htmlparser2 = require('htmlparser2');
var request = require('request');
var zlib = require('zlib');
var fs = require('fs');

var parse = function(html, onScript, onStyle) {
  var parser = new htmlparser2.Parser({
    onopentag: function(name, attribs) {
      if (name === "script") {
        onScript(attribs.src);
      } else if (name === "link" && attribs.rel === "stylesheet") {
        onStyle(attribs.href);
      }
    }
  });
  parser.write(html);
  parser.end();
};

function proxy(fromPort, toPort, tlsOptions) {

  tlsOptions = tlsOptions || {
    key: fs.readFileSync(__dirname + '/ssl/key.pem'),
    cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
  };

  http2.createServer(tlsOptions, function(req, res) {
    var method = req.method;
    var path = req.url;

    var headers = {};
    Object.keys(req.headers).forEach(function(key) {
      if(key[0] !== ':') {
        headers[key] = req.headers[key];
      }
    });

    //TODO: Streaming
    request({
      url: 'http://localhost:' + toPort + path,
      headers: headers
    }, function(error, response, body) {
      if (error) {
        console.log(path, error)
        res.writeHead(500, {});
        res.end();
      } else {
        // console.log(response.statusCode);
        if (response.headers['content-type'].indexOf('html') >= 0) {
          // var encoding = response.headers['content-encoding'];
          // if (encoding === 'gzip') {
          //   console.log(body);
          //   body = zlib.gunzipSync(new Buffer(body)).toString();
          // } else if (encoding === 'deflate') {
          //   body = zlib.deflateSync(new Buffer(body)).toString();
          // }

          // console.log(body);
          parse(body, function(src) {
            res.pushPromise(src);
          }, function(href) {
            res.pushPromise(href);
          });
        }

        var headers = {};
        Object.keys(response.headers).forEach(function(key) {
          if(key.toLowerCase() !== 'connection') {
            headers[key.toLowerCase()] = response.headers[key];
          }
        });
        res.writeHead(response.statusCode, {
          'content-type': response.headers['content-type'].split(';')[0]
        });
        res.end(new Buffer(body));
      }
    });
  }).listen(fromPort);
};

function standAlone(port) {



}



module.exports = {
  proxy: proxy,
  standAlone: standAlone
};