var Path = require('path');
var htmlparser2 = require('htmlparser2');
var fs = require('fs');
var through2 = require('through2');
var assign = require('object-assign');
var ecstatic = require('ecstatic');
var http2 = require('http2');
var Url = require('url');
var h1proxy = require('./h1proxy.js');
// var h2proxy = require('./h2proxy.js');

function createHtmlParser(onResource, onEnd, enableHtmlImports) {
  return new htmlparser2.Parser({
    onopentag: function(name, attribs) {
      if (name === 'script' && attribs.src) {
        onResource(attribs.src);
      } else if (name === 'link' && attribs.rel === 'stylesheet') {
        onResource(attribs.href);
      } else if (name === 'link' && attribs.rel === 'import') {
        enableHtmlImports && onResource(attribs.href); // firefox sends RST_STREAM (INTERNAL_ERROR)
      } else if (name === 'img') {
        onResource(attribs.src);
      }
    },
    onend: onEnd
  });
}

function createCssParser(onResource) {
  return through2(function(buf, enc, callback) {
    var str = buf.toString();
    (str.match(/url\(.*?g"\)/ig) || []).forEach(function(url) {
      var url = url.split('"')[1];
      onResource(url);
    });
    (str.match(/url\(.*?g'\)/ig) || []).forEach(function(url) {
      var url = url.split("'")[1];
      onResource(url);
    });
    callback();
  });
}


function pipeToParser(res, onResource, enableHtmlImports, url) {
  var parser = null;
  var originalWrite = res.write;
  var originalWriteHead = res.writeHead;
  var originalSetHeader = res.setHeader;
  var originalEnd = res.end;
  return assign(res, {
    writeHead: function() {
      if (this.stream.state === 'CLOSED') {
        // console.log('ignored');
        return;
      }
      originalWriteHead.apply(res, arguments);
    },
    setHeader: function(key, value) {
      var lowerKey = key.toLowerCase();
      if (lowerKey === 'connection' || lowerKey === 'transfer-encoding') {
        return;
      }
      originalSetHeader.apply(res, arguments);
    },
    write: function(data) {
      if (this.stream.state === 'CLOSED') {
        // console.log('ignored');
        return;
      }
      var contentType = this.getHeader('content-type') || '';
      if (contentType.indexOf('text/html') >= 0) {
        parser = parser || createHtmlParser(onResource, null, enableHtmlImports);
        parser.write(data);
      } else if (contentType.indexOf('text/css') >= 0) {
        parser = parser || createCssParser(onResource);
        // parser.write(data);// has a bug
      }
      originalWrite.apply(res, arguments);
    },
    end: function(data) {
      if (this.stream.state === 'CLOSED') {
        // console.log('ignored');
        return;
      }
      originalEnd.apply(res, arguments);
      // console.log('end: ' + url);
    }
  });
}


function handleRequest(middleware, req, res, next, url) {
  // console.log(res.push);
  if (res.push) {
    var onResource = function(href) {
      if (href.indexOf('http') === 0) {
        return;
      } else if (href.indexOf('//') === 0) {
        return;
      }
      var realURL = Url.resolve(url, href);
      var push = res.push(realURL);
      // console.log('pushed: ' + href + ' as ' + realURL);

      req = assign(req, {
        url: realURL,
        headers: assign(req.headers, {
          'if-modified-since': null
        })
      });
      handleRequest(middleware, req, push, next, realURL);
    };

    var userAgent = req.headers['user-agent'] ? req.headers['user-agent'].toLowerCase() : '';
    var enableHtmlImports = userAgent.indexOf('chrome') >= 0 || userAgent.indexOf('opr') >= 0;
    res = pipeToParser(res, onResource, enableHtmlImports, url);

  }

  middleware(req, res, next);
}

var autoPush = function(middleware) {
  return function(req, res, next) {
    var url = req.url;
    // console.log(req.method + ' ' + url);
    handleRequest(middleware, req, res, next, url);
  };
};
autoPush.static = function(root) {
  return autoPush(ecstatic(root));
};
autoPush.server = function(options, root) {
  return http2.createServer(options, autoPush(ecstatic(root)));
};
autoPush.h1LocalProxy = function(port) {
  return autoPush(h1proxy(port));
};
// autoPush.h2LocalProxy = function(fromOptions, toOptions) {
//   h2Proxy.start({
//     from: fromOptions,
//     to: toOptions,
//     pipe: function(from, to) {
//       //TODO push_promise to 'from', GET request to 'to'
//     }
//   });
// };

autoPush.private = {
  createHtmlParser: createHtmlParser,
  handleRequest: handleRequest
};

module.exports = autoPush