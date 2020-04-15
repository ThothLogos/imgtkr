console.log("Server started");
var Msg = '';
var WebSocketServer = require('ws').Server
    , wss = new WebSocketServer({port: 8011});
    wss.on('connection', function(ws) {
        ws.on('message', function(message) {
        if (message == "dothething") {
          console.log(' [!] Orders received.');
        } else {
          console.log('Received from client: %s', message);
        }
        ws.send('Server received from client: ' + message);
    });
 });