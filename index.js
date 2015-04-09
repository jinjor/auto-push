var Path = require('path');
var htmlparser2 = require('htmlparser2');
var fs = require('fs');
var through2 = require('through2');
var assign = require('object-assign');
var Url = require('url');
var assert = require('assert');
var zlib = require('zlib');
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
function logCatch(f) {
  return function() {
    try {
      f.apply(this, arguments)
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
}

function headerForReverseProxy(res) {
  if (res.nghttpxPush) { // TODO not pluggable...
    var value = res.nghttpxPush.map(function(url) {
      return '<' + url + '>; rel=preload';
    }).join(',');
    return ['link', value];
  } else if (res.modspdyPush) {
    var value = res.modspdyPush.map(function(url) {
      return '"' + url + '"';
    }).join(',');
    return ['X-Associated-Content', value];
  }
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
  var is304 = res.statusCode === 304;

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

  var isClosed = function(res) {
    if (res.stream && res.stream.state === 'CLOSED') {
      assurePushEnd();
      log('ignored: ' + url);
      return true;
    }
    return false;
  };
  var assurePushEnd = function() {
    !pushDone && onPushEnd();
    pushDone = true;
  };
  var writeGunzip = null;
  var setGunzipWriter = function(res) {
    if (writeGunzip) {
      return;
    }
    var gziped = ContentEncoding.isGzip(res.getHeader('content-encoding') || '');
    if (!gziped) {
      return;
    }
    var gunzip = zlib.createGunzip();
    var queue = [];
    gunzip.on('data', function(data) {
      queue.push(data);
    });
    writeGunzip = function(data, callback) {
      gunzip.write(data, null, function() {
        var _queue = queue;
        queue = [];
        callback(Buffer.concat(_queue));
      });
    };
  };
  var _unzip = function(data, callback) {
    if (writeGunzip) {
      writeGunzip(data, callback)
    } else {
      setImmediate(function() { // XXX: for Firefox
        callback(data);
      });
    }
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
      setParser(this.getHeader('content-type') || '');
      if (!parser) {
        assurePushEnd();
      }
    }
  });
  newRes.setHeader = logCatch(function(key, value) {
    var lowerKey = key.toLowerCase();
    if (lowerKey === 'connection' || lowerKey === 'transfer-encoding') {
      return;
    }
    if (key.toLowerCase() === 'content-type') {
      setParser(value);
      if (!parser) {
        assurePushEnd();
      }
    }
    originalSetHeader.apply(res, arguments);
  });
  newRes.write = logCatch(function(data) {
    if (isClosed(this)) {
      return;
    }
    var _arguments = arguments;
    var _write = is304 ? function(){} : function() {
      log('data: ' + url);
      originalWrite.apply(res, _arguments);
    };
    setParser(this.getHeader('content-type') || '');
    if (parser) {
      setGunzipWriter(this);
      writePromises.push(new Promise(function(resolve) {
        var parseCallback = (res._isOriginalRes && options.mode) ?
          function() {
            applyWrite.push(_write);
            resolve();
          } : function() {
            _write();
            resolve();
          };
        _unzip(data, function(data) {
          parser.write(data, null, parseCallback);
        });
      }));
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

    if (data) {
      setParser(this.getHeader('content-type') || '');
      if (parser) {
        setGunzipWriter(this);
        writePromises.push(new Promise(function(resolve) {
          _unzip(data, function(data) {
            parser.write(data, null, resolve);
          });
        }));
      }
    }
    Promise.all(writePromises).then(function() {
      if (options.mode && res._isOriginalRes) {
        originalSetHeader.apply(res, headerForReverseProxy(res));
        applyWrite.forEach(function(f) {
          f();
        });
      }
      assurePushEnd();

      Promise.all(promises).then(function() {
        originalEnd.apply(res, is304 ? [] : _arguments);
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
    // 'if-modified-since': null,
    // 'if-none-match': null
  });
  newReq.sturl = null; // for 'st' module
  return newReq;
}

function defaultPushStrategy(middleware, req, originalRes, res, next, options, realURL, log, pushed) {
  if (!originalRes.push) {
    middleware(req, originalRes, next);
    return Promise.resolve();
  }
  if(req.headers['if-modified-since'] && req.headers['if-none-match'] && !res._isOriginalRes) {
    var push304 = true;
    if(push304) {
      var push = originalRes.push(realURL);
      push.statusCode = 304;
      return handleRequest(middleware, pushRequest, originalRes, push, next, realURL, options, log, pushed);
    }
    return Promise.resolve();
  }

  var push = originalRes.push(realURL);
  var pushRequest = createPushRequest(req, realURL);
  return handleRequest(middleware, pushRequest, originalRes, push, next, realURL, options, log, pushed);
}

function nghttpxPushStrategy(middleware, req, originalRes, res, next, options, realURL, log, pushed) {
  originalRes.nghttpxPush = originalRes.nghttpxPush || [];
  originalRes.nghttpxPush.push(realURL);
  return Promise.resolve();
}

function modSpdyPushStrategy(middleware, req, originalRes, res, next, options, realURL, log, pushed) {
  originalRes.modspdyPush = originalRes.modspdyPush || [];
  originalRes.modspdyPush.push(realURL);
  return Promise.resolve();
}

function pushLogic(options) {
  var pushStrategy = options.mode === 'nghttpx' ? nghttpxPushStrategy : (options.mode === 'mod_spdy' ? modSpdyPushStrategy : defaultPushStrategy);
  return function(middleware, req, originalRes, res, next, options, url, href, log, pushed) {
    var realURL = Url.resolve(url, href);
    if (!pushed[realURL]) {
      log('pushed: ' + realURL);
      pushed[realURL] = true;
      return pushStrategy(middleware, req, originalRes, res, next, options, realURL, log, pushed);
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
      console.log('options.relation is not an official API!');
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
        return _push(middleware, req, originalRes, res, next, options, url, href, log, pushed);
      };
      var newRes = pipeToParser(options, res, onResource, canHtmlImports(req), url, function(){
        log('pushed-children: ' + url);
        resolve();
      }, log);
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
    log('\n' + req.method + ' ' + url);
    res._isOriginalRes = true;
    handleRequest(middleware, req, res, res, next, url, options, log, {});
  };
};

autoPush.private = {
  createHtmlParser: createHtmlParser,
  handleRequest: handleRequest
};

module.exports = autoPush;
