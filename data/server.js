const fs = require('fs');

const zipfile = '/cover-data/testimages.zip';

function checkFileExistsSync(filepath){
  let flag = true;
  try{
    fs.accessSync(filepath, fs.F_OK);
  }catch(e){
    flag = false;
  }
  return flag;
}

function getImageArchive(path) {
  if (checkFileExistsSync(path)) {
    console.log(`Found archive at ${path}, attempting read...`);
    return fs.readFileSync(path);
  } else {
    console.log(`ERROR - could not locate ${path}`);
  }
}


console.log("Starting Node WebSocket server on 8011...");

var Msg = '';
var WebSocketServer = require('ws').Server
    , wss = new WebSocketServer({port: 8011});
    wss.on('connection', function(ws) {
        ws.on('message', function(message) {
        if (message == "dothething") {
          console.log(' [!] Orders received, attempting send of zip');
          let pack = getImageArchive(zipfile);
          ws.binaryType = "blob";
          ws.send(pack);
        } else {
          console.log('Received from client: %s', message);
        }
        ws.send('Server received from client: ' + message);
    });
 });