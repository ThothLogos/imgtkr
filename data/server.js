const fs = require('fs');
const request = require('request');
const JSZip = require('jszip');

const datadir = `/cover-data`;
const zipfile = `${datadir}/testimages.zip`;

/* Using fs.existsSync for now, feelin' cute, may delete later

function checkFileExistsSync(path){
  let flag = true;
  try { fs.accessSync(path, fs.F_OK); }
  catch(e) { flag = false; }
  return flag;
} */

function getImageArchive(path) {
  if (fs.existsSync(path)) {
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
  return true; // TODO: sanity-check URL format
}

function wgetImageURL(image_url, dir) {
  let img = image_url.toString().split('/').pop();
  if (fs.existsSync(`${datadir}/${dir}/${img}`)) { // Prevent duplicates
    console.log (`WARN: wgetImageURL skipped for ${img}, already exists.`);
  } else {
    try { request(image_url).pipe(fs.createWriteStream(`${datadir}/${dir}/${img}`)); }
    catch (e) { console.log(`ERROR wgetImageURL fail: ${e}`); }
  }
}

function createTempImageDir() {
  let now = Date.now();
  if (!fs.existsSync(`${datadir}/${now}`)){
    try { fs.mkdirSync(`${datadir}/${now}`); }
    catch (e) { console.log(`ERROR createTempImageDir fail: ${e}`); }
    console.log(`Created directory: ${datadir}/${now}`);
  }
  return now;
}

function processImageArray(imagelist) {
  let tempdir = createTempImageDir();
  imagelist.forEach( image_url => {
    console.log("Processing URL: " + image_url);
    if (isValidImageURL(image_url)) {
      wgetImageURL(image_url, tempdir);
    } else {
      console.log(`ERROR isValidImageURL fail: ${image_url}`);
    }
  });
}

function buildArchiveFromDir(image_dir) {
  // TODO: Use JSZip to create zipfile from tempdir
}

function cleanupTempDir(tempdir) {
  // TODO: Verify zip is in-place/finished, then clean up tempdir/images
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