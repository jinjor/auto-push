var http2 = require('node-simple-http2');
var Path = require('path');
var htmlparser2 = require('htmlparser2');
var request = require('request');
var zlib = require('zlib');
var fs = require('fs');

var parse = function(html, onResource) {
  var parser = new htmlparser2.Parser({
    onopentag: function(name, attribs) {
      if (name === "script" && attribs.src) {
        onResource(attribs.src);
      } else if (name === "link" && attribs.rel === "stylesheet") {
        onResource(attribs.href);
      } else if (name === "link" && attribs.rel === "import") {
        onResource(attribs.href);
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
    var url = req.url;

    // TODO: あやしい
    var fullURL = url.indexOf('http') === 0 ? url : 'http://localhost:' + toPort + url;

    var headers = {};
    Object.keys(req.headers).forEach(function(key) {
      if (key[0] !== ':') {
        headers[key] = req.headers[key];
      }
    });


    // console.log(headers);

    //TODO: Streaming
    request({
      url: fullURL,
      headers: headers
    }, function(error, response, body) {
      if (error) {
        console.log(url, fullURL, error);
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
          parse(body, function(href) {
            var realURL;
            if (href.indexOf('http') === 0) {
              realURL = href;
            } else {
              var array = url.split('/');
              array.length--;
              var current = array.join('/');
              realURL = Path.join(current, href).split('\\').join('/');
              // console.log(url);
              // console.log(href);
              // console.log(current);
              // console.log(realURL);
            }
            res.pushPromise(realURL);
          });
        }

        var headers = {};
        Object.keys(response.headers).forEach(function(key) {
          if (key.toLowerCase() !== 'connection') {
            headers[key.toLowerCase()] = response.headers[key];
          }
        });
        res.writeHead(response.statusCode, {
          'content-type': response.headers['content-type'].split(';')[0]
        });
        var buf = new Buffer(body)
        // console.log(url + ': ' + buf.length);
        res.end(buf);
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