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


function pipeToParser(res, onResource, enableHtmlImports, url, onPushEnd, log) {
  var parser = null;
  var originalWrite = res.write;
  var originalWriteHead = res.writeHead;
  var originalSetHeader = res.setHeader;
  var originalEnd = res.end;
  var promises = [];
  var pushDone = false;
  var applyWrite = [];
  return assign(res, {
    writeHead: function() {
      if (this.stream.state === 'CLOSED') {
        log('ignored(writeHead): ' + url);
        return;
      }
      originalWriteHead.apply(res, arguments);
    },
    setHeader: function(key, value) {
      var lowerKey = key.toLowerCase();
      if (lowerKey === 'connection' || lowerKey === 'transfer-encoding') {
        return;
      }
      if (key.toLowerCase() === 'content-type' && !ContentType.isHtml(value) && !ContentType.isCSS(value)) {
        !pushDone && onPushEnd();
        pushDone = true;
      }
      originalSetHeader.apply(res, arguments);
    },
    write: function(data) {
      if (this.stream.state === 'CLOSED') {
        log('ignored(write): ' + url);
        return;
      }
      log('data: ' + url);
      var contentType = this.getHeader('content-type') || '';
      var _arguments = arguments;
      if (ContentType.isHtml(contentType)) {
        parser = parser || createHtmlParser(function() {
          promises.push(onResource.apply(null, arguments));
        }, null, enableHtmlImports);
        parser.write(data);
        applyWrite.push(function() {
          originalWrite.apply(res, _arguments);
        });
      } else if (ContentType.isCSS(contentType)) {
        parser = parser || createCssParser(function() {
          promises.push(onResource.apply(null, arguments));
        });
        parser.write(data);
        originalWrite.apply(res, _arguments);
      } else {
        !pushDone && onPushEnd();
        pushDone = true;
        originalWrite.apply(res, _arguments);
      }
    },
    end: function(data) {
      if (this.stream.state === 'CLOSED') {
        log('ignored(end): ' + url);
        return;
      }
      var _arguments = arguments;
      !pushDone && onPushEnd();
      // var contentType = this.getHeader('content-type') || '';
      Promise.all(promises).then(function() {
        applyWrite.forEach(function(f) {
          f();
        });
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

function defaultPushStrategy(middleware, req, originalRes, next, options, realURL, log, pushed) {
  var push = originalRes.push(realURL);
  var pushRequest = createPushRequest(req, realURL);
  return handleRequest(middleware, pushRequest, originalRes, push, next, realURL, options, log, pushed);
}

function nghttpxPushStrategy(middleware, req, originalRes, next, options, realURL, log, pushed) {
  originalRes.setHeader('link', '<' + realURL + '>; rel=preload');
  return Promise.resolve();
}

function pushLogic(options, pushed) {
  var pushStrategy = options.ngttpxMode ? nghttpxPushStrategy : defaultPushStrategy;
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
  if (!originalRes.push) {
    middleware(req, res, next);
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


autoPush.private = {
  createHtmlParser: createHtmlParser,
  handleRequest: handleRequest
};

module.exports = autoPush;