const fs = require(`fs`);
const syscallSync = require(`child_process`).execSync;

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
  return /^(?:\w+:)?\/\/([^\s\.]+\.\S{2}|localhost[\:?\d]*)\S*$/.test(image_url)
}

function wgetImageURL(image_url, dir, img) {
  if (fs.existsSync(`${dir}/${img}`)) { // Prevent duplicates
    console.log (`WARN: wgetImageURL skipped for ${img}, already exists.`);
  } else {
    try { syscallSync(`wget ${image_url} -P ${dir}/`); }
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
  return `${datadir}/${now}`;
}

function processImageArray(imagelist, tempdir, ws) {
  let chunks = imagelist.length;
  imagelist.forEach( image_url => {
    console.log(`Processing: ${image_url}`);
    if (isValidImageURL(image_url)) {
      let img = image_url.toString().split(`/`).pop();
      wgetImageURL(image_url, tempdir, img);
      console.log(`File complete: ${img}`);
      let chunk = { request:`imagechunk`,result:`success`,file:img };
      ws.send(JSON.stringify(chunk));
    } else {
      console.log(`ERROR isValidImageURL fail: ${image_url}`);
    }
  });
}

function buildArchiveFromDir(image_dir) {
  console.log(`tempdir holding: ${image_dir}`)
  if (fs.existsSync(`${datadir}/latest.zip`)) { fs.unlinkSync(`${datadir}/latest.zip`) }
  syscallSync(`zip -urj ${datadir}/latest.zip ${image_dir}/*`);
  if (fs.existsSync(`${datadir}/latest.zip`)) {
    console.log(`latest.zip created`);
  }
  return `${datadir}/latest.zip`;
}

console.log(`Starting Node WebSocket server on 8011...`);
var WebSocketServer = require(`ws`).Server;
wss = new WebSocketServer({port: 8011});

wss.on(`connection`, function(ws) {
  ws.on(`message`, function(message) {
    if (isValidJSON(message)) {
      let imagelist = JSON.parse(message);
      if (Array.isArray(imagelist)) {
        console.log(`Passed the isArray test, attempting processing`);
        // Tell client we got good data and expected image count
        ws.send(JSON.stringify({request:`array`,result:`success`,size:imagelist.length}));

        // wget the images and zip them up server-side (synchronous but atomic syscalls)
        let tempdir = createTempImageDir();
        processImageArray(imagelist, tempdir, ws);
        let pack = getImageArchive(buildArchiveFromDir(tempdir));

        // Tell client we finished (hacky)
        ws.send(JSON.stringify({request:`array`,result:`success`,size:0}));

        // Send the zip
        ws.binaryType = `blob`; // Actually nodebuffer
        console.log(`Sending latest.zip to client.`);
        ws.send(pack);

        // We don't need to store the raw images anymore
        syscallSync(`rm -r ${tempdir}`);
      }
    } else {
      console.log(`Received from client: ${message}`);
      ws.send(`Server received from client: ${message}`);
    }
  });
});