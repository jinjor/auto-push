var Path = require('path');
var htmlparser2 = require('htmlparser2');
var fs = require('fs');
var through2 = require('through2');
var assign = require('object-assign');
var ecstatic = require('ecstatic');

function createHtmlParser(onResource, onEnd) {
  return new htmlparser2.Parser({
    onopentag: function(name, attribs) {
      if (name === 'script' && attribs.src) {
        onResource(attribs.src);
      } else if (name === 'link' && attribs.rel === 'stylesheet') {
        onResource(attribs.href);
      } else if (name === 'link' && attribs.rel === 'import') {
        onResource(attribs.href);
      } else if (name === 'img') {
        onResource(attribs.src);
      }
    },
    onend: onEnd
  });
}

function createCssParser(onResource) {
  // TODO: return a Writable Stream
}


function makeRealUrl(baseUrl, resourceUrl) {
  var array = baseUrl.split('/');
  array.length--;
  var baseDir = array.join('/');
  var realURL = Path.join('/', baseDir, resourceUrl).split('\\').join('/');
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
      console.log('pushed: ' + href + ' as ' + realURL);

      req = assign(req, {
        url: realURL,
      });
      handleRequest(middleware, req, push, next, root, realURL);
    };
    var originalWrite = res.write;
    var originalWriteHead = res.writeHead;
    var originalEnd = res.end;

    var parser = createHtmlParser(onResource);

    var notModified = false;
    res = assign(res, {
      write: function(data) {
        // console.log('write: ' + url);
        parser.write(data);
        originalWrite.apply(res, arguments);
      },
      end: function(data) {
        var _arguments = arguments;
        originalEnd.apply(res, _arguments);
        console.log('end: ' + url);
      }
    });
  }

  middleware(req, res, next);
}

module.exports = function(middleware) {
  return function(req, res, next) {
    var url = req.url;
    console.log(req.method + ' ' + url);
    handleRequest(middleware, req, res, next, root, url);
  };
}