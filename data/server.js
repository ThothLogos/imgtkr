const fs = require(`fs`);
const syscallSync = require(`child_process`).execSync;

const datadir   = `/cover-data`;
const histdir   = `${datadir}/previous_zips`;
const latestzip = `${datadir}/latest.zip`;

const xrst = `\x1b[0m`;
const xbld = `\x1b[1m`;
const xred = `\x1b[31m`;
const xgrn = `\x1b[32m`;
const xylw = `\x1b[33m`;
const xblu = `\x1b[34m`;
const xmag = `\x1b[35m`;
const xcyn = `\x1b[36m`;
const xwht = `\x1b[37m`;

function elog(src, err) { console.log(`[ ${xred}${xbld}!!${xrst} ${xred}ERROR${xrst} ] ${src}: ${err}`);}
function wlog(src, wrn) { console.log(`[ ${xylw}${xbld}!!${xrst} ${xylw}WARN${xrst} ] ${src}: ${wrn}`); }
function jlog(src, msg) { console.log(`[ ${xmag} JOB ${xrst} ] ${src}: ${msg}`); }
function mlog(src, msg) { console.log(`[${xcyn}MESSAGE${xrst}] ${src}: ${msg}`); }
function setuplog(src, msg)  { console.log(`[ ${xgrn}SETUP${xrst} ] ${src}: ${msg}`); }

function getDateName() {
  let now = new Date(Date.now());
  let yy  = now.getFullYear();
  let mm  = now.getMonth() + 1 < 10 ? `0${now.getMonth()+1}` : now.getMonth() + 1;
  let dd  = now.getDate()      < 10 ? `0${now.getDate()}`    : now.getDate();
  let hr  = now.getHours()     < 10 ? `0${now.getHours()}`   : now.getHours();
  let min = now.getMinutes()   < 10 ? `0${now.getMinutes()}` : now.getMinutes();
  let sec = now.getSeconds()   < 10 ? `0${now.getSeconds()}` : now.getSeconds();
  return `${yy}-${mm}-${dd}_${hr}${min}${sec}`
}

function isValidJSON(str) {
  try { JSON.parse(str); }
  catch (e) { return false; }
  return true;
}

function isValidImageURL(image_url) {
  return /^(?:\w+:)?\/\/([^\s\.]+\.\S{2}|localhost[\:?\d]*)\S*$/.test(image_url);
}

function getImageArchive(path) {
  if (fs.existsSync(path)) {
    jlog(`getImageArchive`, `Found archive at ${path}, attempting read...`);
    return fs.readFileSync(path);
  } else {
    elog(`getImageArchive`, `Failed to locate .zip archive at ${path}`);
  }
}

function curlImageURL(image_url, dir, img) {
  if (fs.existsSync(`${dir}/${img}`)) { // Prevent duplicates
    wlog(`curlImageURL`, `skipping ${img}, already exists in ${dir}`);
    return false;
  } else {
    try { syscallSync(`curl -s -o ${dir}/${img} ${image_url}`); }
    catch (e) { elog(`curlImageURL`, e); }
    return true;
  }
}

function createTempImageDir() {
  let now = Date.now();
  if (!fs.existsSync(`${datadir}/${now}`)){
    try { fs.mkdirSync(`${datadir}/${now}`); }
    catch (e) { elog(`createTempImageDir`, e); }
    jlog(`createTempImageDir`, `Created temporary processing directory: ${datadir}/${now}`);
  }
  return `${datadir}/${now}`;
}

function processImageArray(imagelist, tempdir, ws) {
  let chunks = imagelist.length;
  jlog(`processImageArray`, `Attempting to download images...`);
  imagelist.forEach( image_url => {
    jlog(`processImageArray`, image_url);
    if (isValidImageURL(image_url)) {
      let img = image_url.toString().split(`/`).pop();
      if (curlImageURL(image_url, tempdir, img)) {
        jlog(`processImageArray`, `${img} complete.`);
        let chunk = { request:`imagechunk`,result:`success`,file:img };
        ws.send(JSON.stringify(chunk));
      }
    } else {
      elog(`isValidImageURL`, image_url);
    }
  });
  jlog(`${xbld}${xgrn}Complete${xrst}`, `Downloaded images saved to temp directory ${tempdir}`);
}

function buildLatestZip(image_dir) {
  if (fs.existsSync(latestzip)) fs.unlinkSync(latestzip);
  jlog(`buildLatestZip`, `Compressing contents of ${image_dir} to ${latestzip}`);
  try {
    syscallSync(`zip -urj ${latestzip} ${image_dir}/*`);
  } catch (e) {
    elog(`buildLatestZip`, e);
  }
  if (fs.existsSync(latestzip)) {
    archiveLatestZip(latestzip); // Timestamp and cp to histdir
  } else {
    elog(`buildLatestZip`, `Failed to verify ${latestzip} existence for archival!`);
  }
}

function createZipHistoryDir() {
  if (!fs.existsSync(histdir)) {
    try { fs.mkdirSync(histdir); }
    catch (e) { elog(`createZipHistoryDir`, e); }
    setuplog(`createZipHistoryDir`, `No zip history folder found, created ${histdir}`);
  } else {
    fs.readdirSync(histdir, (err, files) => {
      if (err) { elog(`createZipHistoryDir`, err); }
      else { setuplog(`createZipHistoryDir`, `History directory holds ${files.length} previous zips.`); }
    });
  }
}

function archiveLatestZip(zipfile) {
  let datename = getDateName();
  jlog(`archiveLatestZip`, `Copying ${latestzip} to archive as ${histdir}/${datename}.zip`);
  try { syscallSync(`cp ${zipfile} ${histdir}/${datename}.zip`); }
  catch (e) { elog(`archiveLatestZip`, e); }
}

function getHistoryList() {
  fs.readdirSync(histdir, (err, files) => {
    if (err) { elog(`getHistoryList`, err); }
    else { return files; }
  });
}

function sendLatestZip(ws) {
  let pack = getImageArchive(latestzip);
  ws.binaryType = `blob`; // Actually nodebuffer
  jlog(`sendLatestZip`, `Sending ${latestzip} to client.`);
  ws.send(pack);
}


setuplog(`${xbld}${xwht}STARTUP${xrst}`, `Starting Node WebSocket server on 8011...`);
var WebSocketServer = require(`ws`).Server;
wss = new WebSocketServer({port: 8011});

createZipHistoryDir();

wss.on(`connection`, function(ws) {
  ws.on(`message`, function(message) {
    if (isValidJSON(message)) {
      message = JSON.parse(message);
      if (Array.isArray(message)) {
        jlog(`${xbld}${xylw}NEW ${xrst}${xwht}Request${xrst}`, `processImageArray`);
        // Tell client we got good data and expected image count
        ws.send(JSON.stringify({request:`array`,result:`success`,size:message.length}));

        // curl the images and zip them up server-side (synchronous but atomic syscalls)
        let tempdir = createTempImageDir();
        processImageArray(message, tempdir, ws);
        buildLatestZip(tempdir);

        // Tell client we finished & send the latest.zip
        ws.send(JSON.stringify({request:`array`,result:`success`,size:0}));
        sendLatestZip(ws);
        syscallSync(`rm -r ${tempdir}`); // We don't need to store the raw images anymore
      } else if (message.request == `getlatest`) {
        jlog(`${xbld}${xylw}NEW ${xrst}${xwht}Request${xrst}`, `sendLatestZip`);
        sendLatestZip(ws);
      } else {
        mlog(`unhandledMessage`, `Unknown JSON request received: ${message}`);
      }
    } else {
      mlog(`unhandledMessage`, `${message}`);
      ws.send(`Server received from client: ${message}`);
    }
  });
  ws.on(`close`, function () {
    console.log(`Connection with client closed.`);
  });
});