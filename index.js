var Path = require('path');
var htmlparser2 = require('htmlparser2');
var fs = require('fs');
var through2 = require('through2');
var assign = require('object-assign');
var ecstatic = require('ecstatic');
var http2 = require('http2');
var Url = require('url');
var assert = require('assert');
var h1proxy = require('./h1proxy.js');
var CssUrlFinder = require('./css-url-finder.js');

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
  var parser = new CssUrlFinder();
  parser.on('data', function(url) {
    onResource(url.toString());
  });
  return parser;
}


function pipeToParser(res, onResource, enableHtmlImports, url, onPushEnd, log) {
  var parser = null;
  var originalWrite = res.write;
  var originalWriteHead = res.writeHead;
  var originalSetHeader = res.setHeader;
  var originalEnd = res.end;
  var promises = [];
  var pushEnded = false;
  return assign(res, {
    writeHead: function() {
      if (this.stream.state === 'CLOSED') {
        log('ignored');
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
        log('ignored');
        return;
      }
      log('data: ' + url);
      var contentType = this.getHeader('content-type') || '';
      if (contentType.indexOf('text/html') >= 0) {
        parser = parser || createHtmlParser(function() {
          promises.push(onResource.apply(null, arguments));
        }, null, enableHtmlImports);
        parser.write(data);
      } else if (contentType.indexOf('text/css') >= 0) {
        parser = parser || createCssParser(function() {
          promises.push(onResource.apply(null, arguments));
        });
        parser.write(data);
      } else {
        onPushEnd();
        pushEnded = true;
      }
      originalWrite.apply(res, arguments);
    },
    end: function(data) {
      if (this.stream.state === 'CLOSED') {
        log('ignored');
        return;
      }
      var _arguments = arguments;
      !pushEnded && onPushEnd();
      Promise.all(promises).then(function() {
        originalEnd.apply(res, _arguments);
        log('end: ' + url);
      });
    }
  });
}

function createPushRequest(req, newURL) {
  return assign({}, req, {
    url: newURL,
    headers: assign({}, req.headers, {
      'if-modified-since': null,
      'if-none-match': null
    })
  });
}

function push(middleware, req, originalRes, next, options, url, href, log, pushed) {
  var realURL = Url.resolve(url, href);
  if(!pushed[realURL]) {
    log('pushed: ' + realURL);
    var push = originalRes.push(realURL);
    var pushRequest = createPushRequest(req, realURL);
    // assert(pushRequest.url === realURL);
    pushed[realURL] = true;
    return handleRequest(middleware, pushRequest, originalRes, push, next, realURL, options, log, pushed);
  } else {
    return Promise.resolve();
  }
}

function canHtmlImports(req) {
  var userAgent = req.headers['user-agent'] ? req.headers['user-agent'].toLowerCase() : '';
  return userAgent.indexOf('chrome') >= 0 || userAgent.indexOf('opr') >= 0;
}

function handleRequest(middleware, req, originalRes, res, next, url, options, log, pushed) {
  if (!originalRes.push) {
    middleware(req, res, next);
    return Promise.resolve();
  }
  return new Promise(function(resolve, reject) {
    if (options.relations[url]) {
      var promises = options.relations[url].map(function(href) {
        return push(middleware, req, originalRes, next, options, url, href, log, pushed);
      });
      Promise.all(promises).then(resolve);
      middleware(req, res, next);
    } else {
      var onResource = function(href) {
        if (href.indexOf('http') === 0) {
          return;
        } else if (href.indexOf('//') === 0) {
          return;
        }
        return push(middleware, req, originalRes, next, options, url, href, log, pushed);
      };
      var newRes = pipeToParser(res, onResource, canHtmlImports(req), url, resolve, log);
      middleware(req, newRes, next);
    }
  });
}

var autoPush = function(middleware, options) {
  options = assign({
    relations: {}
  }, options || {});

  var debug = false;
  var log = debug ? console.log.bind(console) : function() {};

  return function(req, res, next) {
    var url = req.url;
    log(req.method + ' ' + url);
    handleRequest(middleware, req, res, res, next, url, options, log, {});
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
