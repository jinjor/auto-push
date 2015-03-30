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

function createServer(mainUrl, html, routes, options) {
  return http2.createServer(tlsOptions, autoPush(function(req, res) {
    if (req.url === mainUrl) {
      res.writeHead(200, {
        'content-type': 'text/html'
      });
      res.end(html);
    } else {
      res.end(routes[req.url]);
    }
  }, options));
}

function testSingleResource(mainUrl, html, routes, options, accessURL, wontPush, done) {
  var server = createServer(mainUrl, html, routes, options);
  server.listen(++port);

  var routesCount = Object.keys(routes).length;

  var request = http2.get('https://localhost:' + port + accessURL);

  var pushedRequestCount = 0;
  var pushedResponseCount = 0;

  request.on('response', function(response) {
    // console.log('response');
    response.statusCode.should.equal(200);
    response.on('data', function(data) {
      // console.log('response-data');
      pushedRequestCount.should.equal(routesCount);
      data.toString().should.equal(html);
    });
    if(wontPush) {
      response.on('end', done);
    }
  });

  request.on('push', function(pushRequest) {
    if(wontPush) {
      assert.fail('unexpectedly pushed');
    }
    pushedRequestCount++;
    pushRequest.on('response', function(pushResponse) {
      // console.log('push-response');
      pushResponse.statusCode.should.equal(200);
      pushResponse.on('data', function(data) {
        // console.log('push-response-data');
        pushedResponseCount++;
        data.toString().should.equal(routes[pushRequest.url]);
        // console.log(pushedResponseCount +'/' + routesCount);
        if (pushedResponseCount === routesCount) {
          pushedRequestCount.should.equal(pushedResponseCount);
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
    testSingleResource('/', '<script src="/app.js"></script>', {
      '/app.js': 'console.log("hello")'
    }, null, '/', false, done);
  });

  it('should push .css', function(done) {
    testSingleResource('/', '<link rel="stylesheet" href="/app.css"></link>', {
      '/app.css': 'body { color: red; }'
    }, null, '/', false, done);
  });

  it('should push image', function(done) {
    testSingleResource('/', '<img src="/image.png"></img>', {
      '/image.png': '123'
    }, null, '/', false, done);
  });

  it('should push image2', function(done) {
    testSingleResource('/', '<img src="/image.png"></img>', {
      '/image.png': '123'
    }, null, '/', false, done);
  });

  it('should resolve url 1', function(done) {
    testSingleResource('/foo/', '<script src="app.js"></script>', {
      '/foo/app.js': 'console.log("hello")'
    }, null, '/foo/', false, done);
  });

  it('should resolve url 2', function(done) {
    testSingleResource('/foo/', '<script src="./app.js"></script>', {
      '/foo/app.js': 'console.log("hello")'
    }, null, '/foo/', false, done);
  });

  it('should resolve url 3', function(done) {
    testSingleResource('/foo/', '<script src="../app.js"></script>', {
      '/app.js': 'console.log("hello")'
    }, null, '/foo/', false, done);
  });

  it('should resolve url 4', function(done) {
    testSingleResource('/foo/', '<script src="/app.js"></script>', {
      '/app.js': 'console.log("hello")'
    }, null, '/foo/', false, done);
  });

  it('should resolve url 5', function(done) {
    testSingleResource('/foo/', '<script src="/foo/app.js"></script>', {
      '/foo/app.js': 'console.log("hello")'
    }, null, '/foo/', false, done);
  });


  it('should resolve url 1a', function(done) {
    testSingleResource('/foo/index.html', '<script src="app.js"></script>', {
      '/foo/app.js': 'console.log("hello")'
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 2a', function(done) {
    testSingleResource('/foo/index.html', '<script src="./app.js"></script>', {
      '/foo/app.js': 'console.log("hello")'
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 3a', function(done) {
    testSingleResource('/foo/index.html', '<script src="../app.js"></script>', {
      '/app.js': 'console.log("hello")'
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 4a', function(done) {
    testSingleResource('/foo/index.html', '<script src="/app.js"></script>', {
      '/app.js': 'console.log("hello")'
    }, null, '/foo/index.html', false, done);
  });

  it('should resolve url 5a', function(done) {
    testSingleResource('/foo/index.html', '<script src="/foo/app.js"></script>', {
      '/foo/app.js': 'console.log("hello")'
    }, null, '/foo/index.html', false, done);
  });

  it('should NOT push if tag is illegular 1', function(done) {
    testSingleResource('/', '<script href="app.js"></script>', {
      '/app.js': 'console.log("hello")'
    }, null, '/', true, done);
  });

  it('should push pre-related resources', function(done) {
    testSingleResource('/', '', {
      '/app.js': 'console.log("hello")'
    }, {
      relations: {
        '/': ['/app.js']
      }
    }, '/', false, done);
  });

  it('should push pre-related resources 2', function(done) {
    testSingleResource('/', '', {
      '/app.js': 'console.log("hello")'
    }, {
      relations: {
        '/': ['./app.js']
      }
    }, '/', false, done);
  });

  it('should push pre-related resources 3', function(done) {
    testSingleResource('/foo/', '', {
      '/app.js': 'console.log("hello")'
    }, {
      relations: {
        '/foo/': ['../app.js']
      }
    }, '/foo/', false, done);
  });


});
