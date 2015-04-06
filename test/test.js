var assert = require('assert');
var autoPush = require('../index.js');
var fs = require('fs');
var http2 = require('http2');
require('should');

var tlsOptions = {
  key: fs.readFileSync(__dirname + '/ssl/key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/cert.pem')
};

var port = 8100;

function createServer(routes, options) {
  return http2.createServer(tlsOptions, autoPush(function(req, res) {
    var data = routes[req.url];
    var status = data.status || 200;
    var contentType = data.contentType || 'text/html';
    var content = data.content;
    res.writeHead(status, {
      'content-type': contentType
    });
    res.end(content);
  }, options));
}

function testSingleResource(routes, options, accessURL, wontPush, done) {
  var server = createServer(routes, options);
  server.listen(++port);

  var subresourceCount = Object.keys(routes).length - 1;

  var request = http2.get('https://localhost:' + port + accessURL);

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
      pushedRequestCount.should.equal(subresourceCount);
      data.toString().should.equal(routes[accessURL].content);
    });
    response.on('end', function() {
      push('response-end');
      if (wontPush) {
        done();
      }
    });

  });

  request.on('push', function(pushRequest) {
    push('push:'+pushRequest.url);
    if (wontPush) {
      assert.fail('unexpectedly pushed');
    }
    pushedRequestCount++;
    pushRequest.on('response', function(pushResponse) {
      push('push-response:'+pushRequest.url);
      pushResponse.statusCode.should.equal(200);
      pushResponse.on('data', function(data) {
        push('push-response-data:'+pushRequest.url);
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
    }, null, '/', false, done);
  });

  it('should push .css', function(done) {
    testSingleResource({
      '/': {
        content: '<link rel="stylesheet" href="/app.css"></link>'
      },
      '/app.css': {
        content: 'body { color: red; }'
      }
    }, null, '/', false, done);
  });

  it('should push image', function(done) {
    testSingleResource({
      '/': {
        content: '<img src="/image.png"></img>'
      },
      '/image.png': {
        content: '123'
      }
    }, null, '/', false, done);
  });

  it('should push image2', function(done) {
    testSingleResource({
      '/': {
        content: '<img src="/image.png"></img>'
      },
      '/image.png': {
        content: '123'
      }
    }, null, '/', false, done);
  });

  it('should resolve url 1', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', false, done);
  });

  it('should resolve url 2', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="./app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', false, done);
  });

  it('should resolve url 3', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="../app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', false, done);
  });

  it('should resolve url 4', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="/app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', false, done);
  });

  it('should resolve url 5', function(done) {
    testSingleResource({
      '/foo/': {
        content: '<script src="/foo/app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/', false, done);
  });


  it('should resolve url 1a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 2a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="./app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 3a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="../app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 4a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="/app.js"></script>'
      },
      '/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 5a', function(done) {
    testSingleResource({
      '/foo/index.html': {
        content: '<script src="/foo/app.js"></script>'
      },
      '/foo/app.js': {
        content: 'console.log("hello")'
      }
    }, null, '/foo/index.html', false, done);
  });

  // it('should NOT push if tag is illegular 1', function(done) {
  //   testSingleResource({
  //      '/': { content: '<script href="app.js"></script>'},
  //     '/app.js': { content: 'console.log("hello")'}
  //   }, null, '/', true, done);
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
    }, '/', false, done);
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
    }, '/', false, done);
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
    }, '/foo/', false, done);
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
    }, null, '/', false, done);
  });


});
