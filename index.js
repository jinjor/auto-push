var Path = require('path');
var htmlparser2 = require('htmlparser2');
var fs = require('fs');
var through2 = require('through2');
var assign = require('object-assign');
var Url = require('url');
var assert = require('assert');
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

function pipeToParser(options, res, onResource, enableHtmlImports, url, onPushEnd, log) {
  // console.log(url);

  var parser = null;
  var originalWrite = res.write;
  var originalWriteHead = res.writeHead;
  var originalSetHeader = res.setHeader;
  var originalEnd = res.end;
  var promises = [];
  var pushDone = false;
  var applyWrite = [];
  var applyWriteHead = null;

  var NewRes = function() {};
  NewRes.prototype = res;
  var newRes = new NewRes();
  newRes.writeHead = function(status) {
    try {
      var _arguments = arguments;
      if (this.stream && this.stream.state === 'CLOSED') {
        log('ignored(writeHead): ' + url);
        return;
      }
      if(options.mode) {
        applyWriteHead = function() {
          originalWriteHead.apply(res, _arguments);
        };
      } else {
        originalWriteHead.apply(res, _arguments);
      }
    } catch (e) {
      console.log(e);
      throw e;
    }
  };
  newRes.setHeader = function(key, value) {
    try {
      var lowerKey = key.toLowerCase();
      if (lowerKey === 'connection' || lowerKey === 'transfer-encoding') {
        return;
      }
      if (key.toLowerCase() === 'content-type' && !ContentType.isHtml(value) && !ContentType.isCSS(value)) {
        !pushDone && onPushEnd();
        pushDone = true;
      }
      originalSetHeader.apply(res, arguments);
    } catch (e) {
      console.log(e);
      throw e;
    }
  };
  newRes.write = function(data) {
    try {
      if (this.stream && this.stream.state === 'CLOSED') {
        log('ignored(write): ' + url);
        return;
      }
      var gziped = ContentEncoding.isGzip(this.getHeader('content-encoding') || '');

      var contentType = this.getHeader('content-type') || '';
      var _arguments = arguments;

      if (ContentType.isHtml(contentType)) {
        parser = parser || createHtmlParser(function() {
          promises.push(onResource.apply(null, arguments));
        }, null, enableHtmlImports);
      } else if (ContentType.isCSS(contentType)) {
        parser = parser || createCssParser(function() {
          promises.push(onResource.apply(null, arguments));
        });
      }
      if (parser) {
        parser.write(data);
        if (res._isOriginalRes) {
          applyWrite.push(function() {
            log('data: ' + url);
            originalWrite.apply(res, _arguments);
          });
        } else {
          log('data: ' + url);
          originalWrite.apply(res, _arguments);
        }
      } else {
        !pushDone && onPushEnd();
        pushDone = true;
        log('data: ' + url);
        originalWrite.apply(res, _arguments);
      }
    } catch (e) {
      console.log(e);
      throw e;
    }
  };
  newRes.__defineSetter__("statusCode", function(s) {
    res.statusCode = s;
  });
  newRes.end = function(data) {
    try {
      if (this.stream && this.stream.state === 'CLOSED') {
        log('ignored(end): ' + url);
        return;
      }
      var _arguments = arguments;
      var contentType = this.getHeader('content-type') || '';

      if (data) {
        if (ContentType.isHtml(contentType)) {
          parser = parser || createHtmlParser(function() {
            promises.push(onResource.apply(null, arguments));
          }, null, enableHtmlImports);
          parser.write(data);
        } else if (ContentType.isCSS(contentType)) {
          parser = parser || createCssParser(function() {
            promises.push(onResource.apply(null, arguments));
          });
          parser.write(data);
        }
      }

      if (res._isOriginalRes && options.mode) {
        if (this.nghttpxPush) { // TODO not pluggable...
          argumentsForWriteHead


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
        applyWriteHead();
      }
      !pushDone && onPushEnd();
      Promise.all(promises).then(function() {
        applyWrite.forEach(function(f) {
          f();
        });
        originalEnd.apply(res, _arguments);
        log('end: ' + url);
      });
    } catch (e) {
      console.log(e);
      throw e;
    }
  };
  newRes.end.a = 789
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
    middleware(req, res, next);
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
  originalRes.modspdyPush = originalRes.nghttpxPush || [];
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

  var debug = true;
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
