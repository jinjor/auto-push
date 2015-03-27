var stream = require('stream');
var util = require('util');

var Transform = stream.Transform;
util.inherits(CssUrlFinder, Transform);

function getUrl(line) {
  if (!line) {
    return null
  }
  var re = /.*url *\((.*)\).*/;
  var matched = line.match(re);
  var url = matched && matched[1];
  if (url) {
    return url.replace(/"/g, '').replace(/'/g, '').trim();
  }

  var re = / *@import *'(.*)'.*/;
  var matched = line.match(re);
  var url = matched && matched[1];
  if (url) {
    return url.trim();
  }
  var re = / *@import *"(.*)".*/;
  var matched = line.match(re);
  var url = matched && matched[1];
  if (url) {
    return url.trim();
  }
}

function CssUrlFinder(options) {
  Transform.call(this, options);
}

CssUrlFinder.prototype._transform = function(chunk, encoding, done) {
  chunk = this.fragment ? Buffer.concat([this.fragment, chunk]) : chunk;
  for (var i = 0; i < chunk.length; i++) {
    if (chunk[i] === 10) { // '\n'
      var line = chunk.slice(0, i).toString();
      var url = getUrl(line);
      if (url) {
        this.push(url);
      }
      chunk = chunk.slice(i + 1);
      i = 0;
    }
  }
  this.fragment = chunk;
  done();
};
CssUrlFinder.prototype._flush = function(done) {
  var line = this.fragment.toString();
  var url = getUrl(line);
  if (url) {
    this.push(url);
  }
  done();
}

module.exports = CssUrlFinder;
