const fs = require(`fs`);
const syscallSync = require(`child_process`).execSync;

const datadir   = `/cover-data`;
const histdir   = `${datadir}/previous_zips`;
const latestzip = `${datadir}/latest.zip`;

function getImageArchive(path) {
  if (fs.existsSync(path)) {
    console.log(`[JOB - PACK] Found archive at ${path}, attempting read...`);
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
    //try { syscallSync(`wget ${image_url} -P ${dir}/`); }
    try { syscallSync(`curl -s -o ${dir}/${img} ${image_url}`); }
    catch (e) { console.log(`ERROR wgetImageURL: ${e}`); }
  }
}

function createTempImageDir() {
  let now = Date.now();
  if (!fs.existsSync(`${datadir}/${now}`)){
    try { fs.mkdirSync(`${datadir}/${now}`); }
    catch (e) { console.log(`ERROR createTempImageDir: ${e}`); }
    console.log(`[JOB - PREP] Created temporary processing directory: ${datadir}/${now}`);
  }
  return `${datadir}/${now}`;
}

function processImageArray(imagelist, tempdir, ws) {
  let chunks = imagelist.length;
  console.log(`\n[JOB - GET] Attempting to download images...`);
  imagelist.forEach( image_url => {
    console.log(`[JOB - GET] Target: ${image_url}`);
    if (isValidImageURL(image_url)) {
      let img = image_url.toString().split(`/`).pop();
      wgetImageURL(image_url, tempdir, img);
      console.log(`[JOB - GET] ${img} complete.`);
      let chunk = { request:`imagechunk`,result:`success`,file:img };
      ws.send(JSON.stringify(chunk));
    } else {
      console.log(`ERROR isValidImageURL: ${image_url}`);
    }
  });
  console.log(`[JOB - GET] Downloads complete; images saved to temp directory ${tempdir}\n`);
}

function buildLatestZip(image_dir) {
  if (fs.existsSync(latestzip)) fs.unlinkSync(latestzip);
  console.log(`[JOB - ZIP] Compressing contents of ${image_dir} to ${latestzip}`)
  try {
    syscallSync(`zip -urj ${latestzip} ${image_dir}/*`);
  } catch (e) {
    console.log(`ERROR buildLatestZip: ${e}`);
  }
  archiveLatestZip(latestzip); // Timestamp and cp to histdir
  if (fs.existsSync(latestzip)) console.log(`[JOB - ZIP] ${latestzip} created`);
}

function createZipHistoryDir() {
  if (!fs.existsSync(histdir)) {
    try { fs.mkdirSync(histdir); }
    catch (e) { console.log(`ERROR createZipHistoryDir: ${e}`); }
    console.log(`[SETUP] No zip history folder found, created ${histdir}`);
  } else {
    fs.readdirSync(histdir, (err, files) => {
      if (err) { console.log(`ERROR createZipHistoryDir: ${err}`); }
      else { console.log(`[INFO] History directory holds ${files.length} previous zips.`); }
    });
  }
}

function archiveLatestZip(zipfile) {
  let now = new Date(Date.now());
  let yy  = now.getFullYear();
  let mm  = now.getMonth() + 1;
  let dd  = now.getDate();
  let hr  = now.getHours();
  let min = now.getMinutes();
  let sec = now.getSeconds();
  if (mm < 10) { mm = `0${mm}` } // Pad 0 for months before Oct
  if (hr < 10) { hr = `0${hr}` } // Pad 0 for hours before 10
  if (min < 10) { min = `0${min}` } // Pad 0
  if (sec < 10) { sec = `0${sec}` } // Pad 0
  let datename = `${yy}-${mm}-${dd}_${hr}${min}${sec}`
  console.log(`[JOB - ZIP] Copying ${latestzip} to archive as ${datename}.zip`);
  syscallSync(`cp ${zipfile} ${histdir}/${datename}.zip`);
}

function getHistoryList() {
  fs.readdirSync(histdir, (err, files) => {
    if (err) { console.log(`ERROR getHistoryList: ${err}`); }
    else { return files; }
  });
}

function sendLatestZip(ws) {
  let pack = getImageArchive(latestzip);
  ws.binaryType = `blob`; // Actually nodebuffer
  console.log(`[JOB - XMIT] Sending latest.zip to client.`);
  ws.send(pack);
}

createZipHistoryDir();

console.log(`[SETUP] Starting Node WebSocket server on 8011...`);
var WebSocketServer = require(`ws`).Server;
wss = new WebSocketServer({port: 8011});

wss.on(`connection`, function(ws) {
  ws.on(`message`, function(message) {
    if (isValidJSON(message)) {
      message = JSON.parse(message);
      if (Array.isArray(message)) {
        console.log(`\n[JOB - REQUEST] Received Array from client, attempting to process image URLs`);
        // Tell client we got good data and expected image count
        ws.send(JSON.stringify({request:`array`,result:`success`,size:message.length}));

        // wget the images and zip them up server-side (synchronous but atomic syscalls)
        let tempdir = createTempImageDir();
        processImageArray(message, tempdir, ws);
        buildLatestZip(tempdir);

        // Tell client we finished & send the latest.zip
        ws.send(JSON.stringify({request:`array`,result:`success`,size:0}));
        sendLatestZip(ws);
        syscallSync(`rm -r ${tempdir}`); // We don't need to store the raw images anymore
      } else if (message.request == `getlatest`) {
        console.log(`\n[JOB - REQUEST] Download request for latest.zip received`);
        sendLatestZip(ws);
      } else {
        console.log(`Unknown JSON request received: ${message}`);
      }
    } else {
      console.log(`[MESSAGE] Received from client: ${message}`);
      ws.send(`Server received from client: ${message}`);
    }
  });
  ws.on(`close`, function () {
    console.log(`Connection with client closed.`);
  });
});