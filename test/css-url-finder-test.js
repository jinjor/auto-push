var assert = require('assert');
var fs = require('fs');
var CssUrlFinder = require('../css-url-finder.js');
require('should');


describe('css-url-finder', function() {

  it('works', function(done) {
    var url = '';
    fs.createReadStream('test/assets/1.css').pipe(new CssUrlFinder()).on('data', function(_url) {
      url = _url.toString();
    }).on('end', function() {
      url.should.equal('foo/bar-_0123ABC.png');
      done();
    });
  });

});
