var assert = require('assert');
var fs = require('fs');
var stream = require('stream');
var CssUrlFinder = require('../css-url-finder.js');
require('should');


describe('css-url-finder', function() {

  it('should read stream', function(done) {
    var url = '';
    fs.createReadStream('test/assets/1.css').pipe(new CssUrlFinder()).on('data', function(_url) {
      url = _url.toString();
    }).on('end', function() {

      url.should.equal('foo/bar-_0123ABC.png');
      done();
    });
  });

  it('should parse url 1', function(done) {
    assertSingle('body { background: url("foo/bar-_0123ABC.png"); }', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse url 2', function(done) {
    assertSingle('body { background: url(\'foo/bar-_0123ABC.png\'); }', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse url 3', function(done) {
    assertSingle('body { background: url(foo/bar-_0123ABC.png); }', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse url 4', function(done) {
    assertSingle('body { background: url ( "foo/bar-_0123ABC.png" ) ; }', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse @import 1', function(done) {
    assertSingle('@import "foo/bar-_0123ABC.png";', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse @import 2', function(done) {
    assertSingle('@import \'foo/bar-_0123ABC.png\';', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse @import 3', function(done) {
    assertSingle('@import url("foo/bar-_0123ABC.png");', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse @import 4', function(done) {
    assertSingle('@import url(\'foo/bar-_0123ABC.png\');', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse @import 5', function(done) {
    assertSingle('@import url(foo/bar-_0123ABC.png);', 'foo/bar-_0123ABC.png', done);
  });
  it('should parse @import 6', function(done) {
    assertSingle('@import url(foo/bar-_0123ABC.png) print;', 'foo/bar-_0123ABC.png', done);
  });

  it('should read separated url', function(done) {
    var url = '';
    var s = new stream.Readable();
    s._read = function noop() {};
    s.pipe(new CssUrlFinder()).on('data', function(_url) {
      url = _url.toString();
    }).on('end', function() {
      url.should.equal('foo/bar-_0123ABC.png');
      done();
    });
    s.push('body { background: url("fo');
    s.push('o/bar-_0123ABC.png"); }');
    s.push(null);
  });

  it('should pick url without \\n', function(done) {
    assertSingle2('body { background: url("foo/bar-_0123ABC.png"); }', 'foo/bar-_0123ABC.png', done);
  });

  function assertSingle(line, expectedUrl, done) {
    var url = '';
    var s = new stream.Readable();
    s._read = function noop() {};
    s.pipe(new CssUrlFinder()).on('data', function(_url) {
      url = _url.toString();
    }).on('end', function() {
      url.should.equal(expectedUrl);
      done();
    });
    s.push(line);
    s.push(null);
  }
  function assertSingle2(line, expectedUrl, done) {
    var finder = new CssUrlFinder();
    finder.on('data', function(url) {
      url.toString().should.equal(expectedUrl);
      done();
    });
    finder.write(line);
  }


});
