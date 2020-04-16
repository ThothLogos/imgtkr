const fs = require('fs');
const child_process = require("child_process");
//const request = require('request');
//const JSZip = require('jszip');
//const FileSaver = require('file-saver');

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
  if (fs.existsSync(`${dir}/${img}`)) { // Prevent duplicates
    console.log (`WARN: wgetImageURL skipped for ${img}, already exists.`);
  } else {
    try {
      child_process.execSync(`wget ${image_url} -P ${dir}/`);
      console.log(`File complete: ${img}`);
//    request(image_url).pipe(fs.createWriteStream(`${dir}/${img}`))
//    .on('close', () =>  console.log(`File complete: ${img}`));
    } catch (e) { console.log(`ERROR wgetImageURL fail: ${e}`); }
  }
}

function createTempImageDir() {
  let now = Date.now();
  if (!fs.existsSync(`${datadir}/${now}`)){
    try { fs.mkdirSync(`${datadir}/${now}`); }
    catch (e) { console.log(`ERROR createTempImageDir fail: ${e}`); }
    console.log(`Created directory: ${datadir}/${now}`);
  }
  return `${datadir}/${now}`;
}

function processImageArray(imagelist, tempdir) {
  imagelist.forEach( image_url => {
    console.log("Processing URL: " + image_url);
    if (isValidImageURL(image_url)) {
      let wutsdis = wgetImageURL(image_url, tempdir);
      console.log(`Wut it is: ${typeof wutsdis}`);
    } else {
      console.log(`ERROR isValidImageURL fail: ${image_url}`);
    }
  });
}

function buildArchiveFromDir(image_dir) {
  //let archive = new JSZip();
  //archive.file(`${image_dir}/${img}`);
  console.log(`tempdir holding: ${image_dir}`)
  if (fs.existsSync(`${datadir}/latest.zip`)) { fs.unlinkSync(`${datadir}/latest.zip`) }
  child_process.execSync(`zip -urj ${datadir}/latest.zip ${image_dir}/*`);
  if (fs.existsSync(`${datadir}/latest.zip`)) {
    console.log("latest.zip created");
  }
  /*
  fs.readdirSync(image_dir).forEach( img => {
    console.log(`Adding ${image_dir}/${img} to zip`);
    child_process.execSync(`zip -urj ${datadir}/latest.zip ${image_dir}/${img}`);
  });
  */

  //let buffer = archive.generateNodeStream({ type:"nodebuffer", streamFiles:true });
  //fs.writeFileSync(`${datadir}/latest.zip`, buffer);
  
  /*
  archive.generateNodeStream({ type:"nodebuffer", streamFiles:true })
    .pipe(fs.createWriteStream(`${datadir}/latest.zip`))
    .on('finish', () => { console.log("Latest.zip written to file.")
  });
  */

  /*
  archive.generateAsync({type : "blob"}).then( file => {
    let timestampdir = image_dir.split('/').pop();
    console.log("Attempting zip write");
    FileSaver.saveAs(file, 'latest.zip')
  });
  */
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
          /*
          console.log(' [!] Orders received, attempting send of zip');
          let pack = getImageArchive(zipfile);
          ws.binaryType = "blob";
          console.log(`Pack is packed, type set to: ${ws.binaryType}.`);
          ws.send(pack); */
        } else if (isValidJSON(message)) {
          ws.send("Server received valid JSON from client.");
          let imagelist = JSON.parse(message);
          if (Array.isArray(imagelist)) {
            console.log("Passed the isArray test, attempting processing");
            let tempdir = createTempImageDir();
            processImageArray(imagelist, tempdir);
            buildArchiveFromDir(tempdir);
          }
        } else {
          console.log('Received from client: %s', message);
          ws.send('Server received from client: ' + message);
        }
    });
 });