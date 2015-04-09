var assert = require('assert');
var autoPush = require('../index.js');
var fs = require('fs');
var http2 = require('http2');
var http = require('http');
var should = require('should');
var request = require('request');

var tlsOptions = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

var port = 8100;

function createServer(serverType, routes, options, responseStrategy) {

  var middleware = autoPush(function(req, res) {
    var data = routes[req.url];
    var status = data.status || 200;
    var contentType = data.contentType || 'text/html';
    var content = data.content;
    if (!responseStrategy) {
      res.writeHead(status, {
        'content-type': contentType
      });
      res.end(content);
    } else if (responseStrategy === 1) {
      res.statusCode = status;
      res.setHeader('content-type', contentType);
      res.write(content);
      res.end();
    }


  }, options);

  if (!serverType) {
    return http2.createServer(tlsOptions, middleware);
  } else if (serverType === 1) {
    return http.createServer(middleware);
  }
}

function testSingleResource(routes, options, accessURL, responseStrategy, wontPush, done) {
  var server = createServer(0, routes, options, responseStrategy);
  server.listen(++port);

  var subresourceCount = Object.keys(routes).length - 1;

  var request = http2.get({
    hostname: 'localhost',
    port: port,
    path: accessURL,
    headers: {
      'user-agent': 'chrome'
    }
  });

  var pushedRequestCount = 0;
  var pushedResponseCount = 0;

  var log = [];
  var push = function(message) {
    // console.log(message);
    log.push(message);
  }

  request.on('response', function(response) {
    push('response');
    response.statusCode.should.equal(200);
    response.on('data', function(data) {
      push('response-data');
      data.toString().should.equal(routes[accessURL].content);
    });
    response.on('end', function() {
      push('response-end');
      pushedRequestCount.should.equal(subresourceCount);
      if (wontPush) {
        done();
      }
    });

  });

  request.on('push', function(pushRequest) {
    push('push:' + pushRequest.url);
    if (wontPush) {
      assert.fail('unexpectedly pushed');
    }
    pushedRequestCount++;
    pushRequest.on('response', function(pushResponse) {
      push('push-response:' + pushRequest.url);
      pushResponse.statusCode.should.equal(200);
      pushResponse.on('data', function(data) {
        push('push-response-data:' + pushRequest.url);
        pushedResponseCount++;
        data.toString().should.equal(routes[pushRequest.url].content);
        // console.log(pushedResponseCount +'/' + subresourceCount);
        if (pushedResponseCount === subresourceCount) {
          pushedRequestCount.should.equal(pushedResponseCount);
          // console.log(log);
          server.close(function() {

          });
          done();
        }
      });
    });
  });
}

function testProxyMode(routes, options, accessURL, expectedURLs, serverType, responseStrategy, done) {
  var server = createServer(serverType, routes, options, responseStrategy);
  server.listen(++port);

  var _request = serverType ? request : http2;
  var url = (serverType ? 'http' : 'https') + '://localhost:' + port + accessURL;
  _request.get(url).on('response', function(response) {
    if (options.mode === 'nghttpx') {
      var expects = expectedURLs.map(function(url) {
        return '<' + url + '>; rel=preload';
      }).join(',');
      should.exist(response.headers['link']);
      response.headers['link'].should.equal(expects);
    } else if (options.mode === 'mod_spdy') {
      var expects = expectedURLs.map(function(url) {
        return '"' + url + '"';
      }).join(',');
      should.exist(response.headers['x-associated-content']);
      response.headers['x-associated-content'].should.equal(expects);
    }
    done();
  });
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

describe('auto-push', function() {

  it('should push .js', function(done) {
    testSingleResource({
      '/': {
        content: '<script src="/app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/', 0, false, done);
  });

  it('should push .css', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="/app.css"></link>'
      },
      '/app.css': {
        content: 'body { color: red; }',
        contentType: 'text/css'
      }
    }, null, '/', 0, false, done);
  });

  it('should push image', function(done) {
    testSingleResource({
      '/': {
        content: '<img src="/image.png"></img>'
      },
      '/image.png': {
        content: '123'
      }
    }, null, '/', 0, false, done);
  });

  it('should push image2', function(done) {
    testSingleResource({
      '/': {
        content: '<img src="/image.png"></img>'
      },
      '/image.png': {
        content: '123'
      }
    }, null, '/', 0, false, done);
  });

  it('should push .js --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<script src="/app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/', 1, false, done);
  });

  it('should push .css --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="/app.css"></link>'
      },
      '/app.css': {
        content: 'body { color: red; }',
        contentType: 'text/css'
      }
    }, null, '/', 1, false, done);
  });

  it('should push image --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<img src="/image.png"></img>'
      },
      '/image.png': {
        content: '123'
      }
    }, null, '/', 1, false, done);
  });

  it('should push image2 --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<img src="/image.png"></img>'
      },
      '/image.png': {
        content: '123'
      }
    }, null, '/', 1, false, done);
  });

  it('should resolve url 1', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', 0, false, done);
  });

  it('should resolve url 2', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="./app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', 0, false, done);
  });

  it('should resolve url 3', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="../app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', 0, false, done);
  });

  it('should resolve url 4', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="/app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', 0, false, done);
  });

  it('should resolve url 5', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="/foo/app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', 0, false, done);
  });


  it('should resolve url 1a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', 0, false, done);
  });

  it('should resolve url 2a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="./app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', 0, false, done);
  });

  it('should resolve url 3a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="../app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', 0, false, done);
  });

  it('should resolve url 4a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="/app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', 0, false, done);
  });

  it('should resolve url 5a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="/foo/app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', 0, false, done);
  });

  // it('should NOT push if tag is illegular 1', function(done) {
  //   testSingleResource({
  //      '/': { content: '<script href="app.js"></script>'},
  //     '/app.js': { content: 'console.log("hello")'}
  //   }, null, '/', 0, true, done);
  // });

  it('should push pre-related resources', function(done) {
    testSingleResource({
      '/': {
        content: ''
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, {
      relations: {
        '/': ['/app.js']
      }
    }, '/', 0, false, done);
  });

  it('should push pre-related resources 2', function(done) {
    testSingleResource({
      '/': {
        content: ''
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, {
      relations: {
        '/': ['./app.js']
      }
    }, '/', 0, false, done);
  });

  it('should push pre-related resources 3', function(done) {
    testSingleResource({
      '/foo/': {
        content: ''
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, {
      relations: {
        '/foo/': ['../app.js']
      }
    }, '/foo/', 0, false, done);
  });

  it('should recursively push', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      },
      '/app.css': {
        contentType: 'text/css',
        content: 'body { background: url("a.jpeg"); }'
      },
      '/a.jpeg': {
        content: '_'
      }
    }, null, '/', 0, false, done);
  });

  it('should recursively push --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      },
      '/app.css': {
        contentType: 'text/css',
        content: 'body { background: url("a.jpeg"); }'
      },
      '/a.jpeg': {
        content: '_'
      }
    }, null, '/', 1, false, done);
  });

  it('should support HTML Imports', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="import" href="a.html"></link>'
      },
      '/a.html': {
        content: '<link rel="import" href="b.html"></link>'
      },
      '/b.html': {
        content: '_'
      }
    }, null, '/', 0, false, done);
  });

  it('should support HTML Imports --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="import" href="a.html"></link>'
      },
      '/a.html': {
        content: '<link rel="import" href="b.html"></link>'
      },
      '/b.html': {
        content: '_'
      }
    }, null, '/', 1, false, done);
  });

  it('should dedupe', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="foo/a.css"></link><img src="foo/a.jpeg"></img>'
      },
      '/foo/a.css': {
        contentType: 'text/css',
        content: 'body { background: url("a.jpeg"); }'
      },
      '/foo/a.jpeg': {
        content: '_'
      }
    }, null, '/', 0, false, done);
  });

  it('should dedupe --strategy1', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="foo/a.css"></link><img src="foo/a.jpeg"></img>'
      },
      '/foo/a.css': {
        contentType: 'text/css',
        content: 'body { background: url("a.jpeg"); }'
      },
      '/foo/a.jpeg': {
        content: '_'
      }
    }, null, '/', 1, false, done);
  });

  it('should work on nghttpx mode', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'nghttpx'
    }, '/', ['/app.css'], 0, 0, done);
  });

  it('should work on nghttpx mode --server1', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'nghttpx'
    }, '/', ['/app.css'], 1, 0, done);
  });

  it('should work on nghttpx mode --strategy1', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'nghttpx'
    }, '/', ['/app.css'], 0, 1, done);
  });

  it('should work on nghttpx mode --server1 --strategy1', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'nghttpx'
    }, '/', ['/app.css'], 1, 1, done);
  });

  it('should work on mod_spdy mode', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'mod_spdy'
    }, '/', ['/app.css'], 0, 0, done);
  });

  it('should work on mod_spdy mode --server1', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'mod_spdy'
    }, '/', ['/app.css'], 1, 0, done);
  });

  it('should work on mod_spdy mode --strategy1', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'mod_spdy'
    }, '/', ['/app.css'], 0, 1, done);
  });

  it('should work on mod_spdy mode --server1 --strategy1', function(done) {
    testProxyMode({
      '/': {
        content: '<link rel="stylesheet" href="app.css"></link>'
      }
    }, {
      mode: 'mod_spdy'
    }, '/', ['/app.css'], 1, 1, done);
  });

});
