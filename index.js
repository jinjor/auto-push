var Path = require('path');
var htmlparser2 = require('htmlparser2');
var request = require('request');
var fs = require('fs');
var through2 = require('through2');
var ecstatic = require('ecstatic');
var assign = require('object-assign');

function createParser(onResource) {
  return new htmlparser2.Parser({
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
}

var parse = function(filePath, onResource, res) {
  var parser = createParser(onResource);
  fs.createReadStream(filePath).pipe(through2(function(chunk, enc, callback) {
    this.push(chunk);
    res.write(chunk);
    callback();
  })).pipe(parser);
};

function makeRealUrl(baseUrl, resourceUrl) {
  var array = baseUrl.split('/');
  array.length--;
  var baseDir = array.join('/');
  var realURL = Path.join(baseDir, resourceUrl).split('\\').join('/');
  return realURL;
}


function handleRequest(middleware, req, res, next, root, url) {
  if (url === '/') {
    url = 'index.html';
  }

  if (res.push) {
    var onResource = function(href) {
      if (href.indexOf('http') === 0) {
        return;
      } else if (href.indexOf('//') === 0) {
        return;
      }
      var realURL = makeRealUrl(url, href);
      var push = res.push(realURL);
      console.log('pushed: ' + href);

      req = assign(req, {
        url: realURL,
        // headers: req.headers
      });
      // console.log(req.headers['if-modified-since']);

      handleRequest(middleware, req, push, next, root, realURL);
    };
    var originalWrite = res.write;
    var originalEnd = res.end;

    var parser = createParser(onResource);

    res = assign(res, {
      write: function(data) {
        if (res._headers['content-type'].indexOf('text/html') >= 0) {
          parser.write(data);
        }
        originalWrite.apply(res, arguments);
      },
      end: function(data) {
        console.log('end: ' + url);
        originalEnd.apply(res, arguments);
      }
    });

  }

  middleware(req, res, next);
}

function middleware(root, options) {
  var middleware = ecstatic.apply(ecstatic, arguments);
  if (typeof root !== 'string') {
    options = root;
    root = options.root;
  }
  return function(req, res, next) {
    var url = req.url;
    console.log(req.method + ' ' + url);
    handleRequest(middleware, req, res, next, root, url);
  };
}

// function proxy(fromPort, toPort, tlsOptions) {

//   tlsOptions = tlsOptions || {
//     key: fs.readFileSync(__dirname + '/ssl/key.pem'),
//     cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
//   };

//   http2.createServer(tlsOptions, function(req, res) {
//     var method = req.method;
//     var url = req.url;

//     // TODO: あやしい
//     var fullURL = url.indexOf('http') === 0 ? url : 'http://localhost:' + toPort + url;

//     var headers = {};
//     Object.keys(req.headers).forEach(function(key) {
//       if (key[0] !== ':') {
//         headers[key] = req.headers[key];
//       }
//     });


//     // console.log(headers);

//     //TODO: Streaming
//     request({
//       url: fullURL,
//       headers: headers
//     }, function(error, response, body) {
//       if (error) {
//         console.log(url, fullURL, error);
//         res.writeHead(500, {});
//         res.end();
//       } else {
//         // console.log(response.statusCode);
//         if (response.headers['content-type'].indexOf('html') >= 0) {
//           // var encoding = response.headers['content-encoding'];
//           // if (encoding === 'gzip') {
//           //   console.log(body);
//           //   body = zlib.gunzipSync(new Buffer(body)).toString();
//           // } else if (encoding === 'deflate') {
//           //   body = zlib.deflateSync(new Buffer(body)).toString();
//           // }

//           // console.log(body);
//           parse(body, function(href) {
//             var realURL;
//             if (href.indexOf('http') === 0) {
//               realURL = href;
//             } else {
//               var array = url.split('/');
//               array.length--;
//               var current = array.join('/');
//               realURL = Path.join(current, href).split('\\').join('/');
//               // console.log(url);
//               // console.log(href);
//               // console.log(current);
//               // console.log(realURL);
//             }
//             res.pushPromise(realURL);
//           });
//         }

//         var headers = {};
//         Object.keys(response.headers).forEach(function(key) {
//           if (key.toLowerCase() !== 'connection') {
//             headers[key.toLowerCase()] = response.headers[key];
//           }
//         });
//         res.writeHead(response.statusCode, {
//           'content-type': response.headers['content-type'].split(';')[0]
//         });
//         var buf = new Buffer(body)
//           // console.log(url + ': ' + buf.length);
//         res.end(buf);
//       }
//     });
//   }).listen(fromPort);
// };


module.exports = {
  // proxy: proxy,
  middleware: middleware
};