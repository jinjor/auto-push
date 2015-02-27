var request = require('request');

module.exports = function(port) {
  return function(req, res) {
    var url = req.url;
    var fullURL = 'http://localhost:' + port + url;
    var headers = req.headers;
    request({
      method: req.method,
      url: fullURL,
      headers: headers
    }).pipe(res);
  }
};