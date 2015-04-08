var Path = require('path');
var htmlparser2 = require('htmlparser2');
var fs = require('fs');
var through2 = require('through2');
var assign = require('object-assign');
var Url = require('url');
var assert = require('assert');
var CssUrlFinder = require('./css-url-finder.js');

function createHtmlParser(onResource, onEnd, enableHtmlImports) {
  var parser = new htmlparser2.Parser({
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
  var originalWrite = parser.write;
  parser.write = function(data, chunk, callback) {
    var _arguments = arguments;
    originalWrite.apply(parser, _arguments);
    // setImmediate(function() {
    callback && callback();
    // });
  };
  return parser;
}

function createCssParser(onResource) {
  var parser = new CssUrlFinder();
  parser.on('data', function(url) {
    onResource(url.toString());
  });
  return parser;
}

var ContentType = {
  isHtml: function(value) {
    return value.indexOf('text/html') >= 0;
  },
  isCSS: function(value) {
    return value.indexOf('text/css') >= 0;
  }
};
var ContentEncoding = {
  isGzip: function(value) {
    return value.toLowerCase().indexOf('gzip') >= 0;
  }
};
var logCatch = function(f) {
  return function() {
    try {
      f.apply(this, arguments)
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
};

function pipeToParser(options, res, onResource, enableHtmlImports, url, onPushEnd, log) {
  var parser = null;
  var originalWrite = res.write;
  var originalWriteHead = res.writeHead;
  var originalSetHeader = res.setHeader;
  var originalEnd = res.end;
  var writePromises = [];
  var promises = [];
  var pushDone = false;
  var applyWrite = [];

  var _onResource = function() {
    promises.push(onResource.apply(null, arguments));
  };
  var setParser = function(contentType) {
    if (ContentType.isHtml(contentType)) {
      parser = parser || createHtmlParser(_onResource, null, enableHtmlImports);
    } else if (ContentType.isCSS(contentType)) {
      parser = parser || createCssParser(_onResource);
    }
  };
  var setHeaderForReverseProxy = function(res) {
    if (res.nghttpxPush) { // TODO not pluggable...
      var value = res.nghttpxPush.map(function(url) {
        return '<' + url + '>; rel=preload';
      }).join(',');
      originalSetHeader.apply(res, ['link', value]);
    } else if (res.modspdyPush) {
      var value = res.modspdyPush.map(function(url) {
        return '"' + url + '"';
      }).join(',');
      originalSetHeader.apply(res, ['X-Associated-Content', value]);
    }
  };
  var isClosed = function(res) {
    if (res.stream && res.stream.state === 'CLOSED') {
      log('ignored: ' + url);
      return true;
    }
    return false;
  };
  var assurePushEnd = function() {
    !pushDone && onPushEnd();
    pushDone = true;
  };

  var NewRes = function() {};
  NewRes.prototype = res;
  var newRes = new NewRes();
  newRes.writeHead = logCatch(function(status) {
    var _arguments = arguments;
    if (isClosed(this)) {
      return;
    }
    if (options.mode) {
      this.statusCode = _arguments[0];
      var header = _arguments[1];
      header && Object.keys(header).forEach(function(key) {
        var value = header[key];
        this.setHeader(key, value);
      }.bind(this));
    } else {
      originalWriteHead.apply(res, _arguments);
    }
  });
  newRes.setHeader = logCatch(function(key, value) {
    var lowerKey = key.toLowerCase();
    if (lowerKey === 'connection' || lowerKey === 'transfer-encoding') {
      return;
    }
    if (key.toLowerCase() === 'content-type' && !ContentType.isHtml(value) && !ContentType.isCSS(value)) {
      assurePushEnd();
    }
    originalSetHeader.apply(res, arguments);
  });
  newRes.write = logCatch(function(data) {
    if (isClosed(this)) {
      return;
    }
    var gziped = ContentEncoding.isGzip(this.getHeader('content-encoding') || '');

    var contentType = this.getHeader('content-type') || '';
    var _arguments = arguments;
    var _write = function() {
      log('data: ' + url);
      originalWrite.apply(res, _arguments);
    };

    setParser(contentType);
    if (parser) {
      if (res._isOriginalRes && options.mode) {
        parser.write(data, null, function() {
          applyWrite.push(_write);
        });
      } else {
        writePromises.push(new Promise(function(resolve) {
          parser.write(data, null, function() {
            _write();
            resolve();
          });
        }));
      }
    } else {
      assurePushEnd();
      _write();
    }
  });
  newRes.__defineSetter__("statusCode", function(s) {
    res.statusCode = s;
  });
  newRes.end = logCatch(function(data) {
    if (isClosed(this)) {
      return;
    }
    var _arguments = arguments;
    var contentType = this.getHeader('content-type') || '';

    if (data) {
      setParser(contentType);
      if (parser) {
        writePromises.push(new Promise(function(resolve) {
          parser.write(data, null, resolve);
        }));
      }
    }
    Promise.all(promises).then(function() {
      if (options.mode && res._isOriginalRes) {
        setHeaderForReverseProxy(res);
        applyWrite.forEach(function(f) {
          f();
        });
      }
      assurePushEnd();
      Promise.all(writePromises).then(function() {
        originalEnd.apply(res, _arguments);
        log('end: ' + url);
      });
    }.bind(this));
  });
  newRes._isOriginalRes = false;

  return newRes;
}

function createPushRequest(req, newURL) {

  var NewReq = function() {};
  NewReq.prototype = req;
  var newReq = new NewReq();
  newReq.url = newURL;
  newReq.headers = assign({}, req.headers, {
    'if-modified-since': null,
    'if-none-match': null
  });
  newReq.sturl = null; // for 'st' module
  return newReq;
}

function defaultPushStrategy(middleware, req, originalRes, next, options, realURL, log, pushed) {
  if (!originalRes.push) {
    middleware(req, originalRes, next);
    return Promise.resolve();
  }
  var push = originalRes.push(realURL);
  var pushRequest = createPushRequest(req, realURL);
  return handleRequest(middleware, pushRequest, originalRes, push, next, realURL, options, log, pushed);
}

function nghttpxPushStrategy(middleware, req, originalRes, next, options, realURL, log, pushed) {
  originalRes.nghttpxPush = originalRes.nghttpxPush || [];
  originalRes.nghttpxPush.push(realURL);
  return Promise.resolve();
}

function modSpdyPushStrategy(middleware, req, originalRes, next, options, realURL, log, pushed) {
  originalRes.modspdyPush = originalRes.modspdyPush || [];
  originalRes.modspdyPush.push(realURL);
  return Promise.resolve();
}

function pushLogic(options) {
  var pushStrategy = options.mode === 'nghttpx' ? nghttpxPushStrategy : (options.mode === 'mod_spdy' ? modSpdyPushStrategy : defaultPushStrategy);
  return function(middleware, req, originalRes, next, options, url, href, log, pushed) {
    var realURL = Url.resolve(url, href);
    if (!pushed[realURL]) {
      log('pushed: ' + realURL);
      pushed[realURL] = true;
      return pushStrategy(middleware, req, originalRes, next, options, realURL, log, pushed);
    } else {
      return Promise.resolve();
    }
  };
}

function canHtmlImports(req) {
  var userAgent = req.headers['user-agent'] ? req.headers['user-agent'].toLowerCase() : '';
  return userAgent.indexOf('chrome') >= 0 || userAgent.indexOf('opr') >= 0;
}

function handleRequest(middleware, req, originalRes, res, next, url, options, log, pushed) {

  if (!originalRes.push && !options.mode) {
    middleware(req, originalRes, next);
    return Promise.resolve();
  }

  var _push = pushLogic(options);

  return new Promise(function(resolve, reject) {
    if (options.relations[url]) {
      var promises = options.relations[url].map(function(href) {
        return _push(middleware, req, originalRes, next, options, url, href, log, pushed);
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
        return _push(middleware, req, originalRes, next, options, url, href, log, pushed);
      };
      var newRes = pipeToParser(options, res, onResource, canHtmlImports(req), url, resolve, log);
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
    res._isOriginalRes = true;
    handleRequest(middleware, req, res, res, next, url, options, log, {});
  };
};

autoPush.private = {
  createHtmlParser: createHtmlParser,
  handleRequest: handleRequest
};

module.exports = autoPush;
