const fs = require('fs');
const request = require('request');

const datadir = `/cover-data`;
const zipfile = `${datadir}/testimages.zip`;

function checkFileExistsSync(path){
  let flag = true;
  try{
    fs.accessSync(path, fs.F_OK);
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

function isValidJSON(str) {
  try { JSON.parse(str); }
  catch (e) { return false; }
  return true;
}

function isValidImageURL(image_url) {
  return true;
}

function wgetImageURL(image_url) {
  let filename = image_url.toString().split('/').pop();
  if (checkFileExistsSync(`${datadir}/${filename}`)) {
    console.log (`WARN: wgetImageURL skipped for ${filename}, already exists.`);
  } else {
    try { request(image_url).pipe(fs.createWriteStream(`${datadir}/${filename}`)); }
    catch (e) { console.log(`ERROR: wgetImageURL failure: ${e}`); }
  }
}

function processImageArray(imagelist) {
  imagelist.forEach( image_url => {
    console.log("Processing URL: " + image_url);
    if (isValidImageURL(image_url)) {
      wgetImageURL(image_url);
    } else {
      console.log(`ERROR: failed isValidImageURL ${image_url}`);
    }
  });
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
          console.log(`Pack is packed, type set to: ${ws.binaryType}.`);
          ws.send(pack);
        } else if (isValidJSON(message)) {
          ws.send("Server received valid JSON from client.");
          let imagelist = JSON.parse(message);
          if (Array.isArray(imagelist)) {
            console.log("Passed the isArray test, attempting processing");
            processImageArray(imagelist);
          }
        } else {
          console.log('Received from client: %s', message);
          ws.send('Server received from client: ' + message);
        }
    });
 });