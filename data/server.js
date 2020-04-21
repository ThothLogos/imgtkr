const fs          = require(`fs`);
const util        = require('util');
const syscall     = util.promisify(require(`child_process`).exec);
const syscallSync = require(`child_process`).execSync;

const DATADIR   = `/cover-data`;
const HISTDIR   = `${DATADIR}/previous_zips`;
const LATESTZIP = `${DATADIR}/latest.zip`;
const MAXHIST   = 12;
const BATCHSIZE = 30;
const BATCHTIME = 1250;

const rst = `\x1b[0m`;
const bld = `\x1b[1m`;
const red = `\x1b[31m`;
const grn = `\x1b[32m`;
const ylw = `\x1b[33m`;
const blu = `\x1b[34m`;
const mag = `\x1b[35m`;
const cyn = `\x1b[36m`;
const wht = `\x1b[37m`;

// Color Logging - Error, Warn, Job, Message, Cleanup, Setup
function elog(src, err) { console.log(`[ ${red}${bld}!${rst} ${red}ERR${rst} ] ${src}\t\t${err}`);}
function wlog(src, wrn) { console.log(`[ ${ylw}${bld}!${rst} ${ylw}WRN${rst} ] ${src}\t\t${wrn}`); }
function jlog(src, msg) { console.log(`[ ${mag} JOB ${rst} ] ${src}\t\t${msg}`); }
function mlog(src, msg) { console.log(`[${cyn}MESSAGE${rst}] ${src}\t\t${msg}`); }
function cleanuplog(src, msg) { console.log(`[ ${ylw}CLEAN${rst} ] ${src}\t\t${msg}`); }
function statuslog(src, msg) { console.log(`[ ${blu}STATE${rst} ] ${src}\t\t${msg}`); }

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

async function rateLimitTimeout() {
  statuslog(`rateLimitTimeout`,`(${ylw}LIMIT${rst}) Set to ${BATCHSIZE} per ${BATCHTIME} ms`);
  return new Promise( resolve => {
    setTimeout( () => { resolve('resolved!'); }, BATCHTIME);
  });
}

function getImageArchive(path) {
  if (fs.existsSync(path)) {
    jlog(`getImageArchive`, `Found archive at ${path}, attempting read...`);
    return fs.readFileSync(path);
  } else {
    elog(`getImageArchive`, `Failed to locate .zip archive at ${path}`);
  }
}

function createTempDir() {
  let now = Date.now();
  if (!fs.existsSync(`${DATADIR}/${now}`)){
    try { fs.mkdirSync(`${DATADIR}/${now}`); }
    catch (e) { elog(`createTempDir`, e); }
    jlog(`createTempDir`, `Created temporary processing directory: ${DATADIR}/${now}`);
  }
  return `${DATADIR}/${now}`;
}

async function processImageArray(imagelist, tempdir, ws) {
  jlog(`processImageArray`, `Attempting to download images...`);
  let promises = [];
  let count = 1;
  for (let image_url of imagelist) {
    if (count % BATCHSIZE == 0) { await rateLimitTimeout(BATCHTIME); } // don't piss off imagehost
    if (isValidImageURL(image_url)) {
      let img = image_url.toString().split(`/`).pop();
      let prom = syscall(`curl -s -o ${tempdir}/${img} ${image_url}`);
      promises.push(prom.then(
        success => { 
          jlog(`curlImagePromise`, `(${grn}done${rst})  ${img} - from URL: ${image_url}`);
          let chunk = { request:`imagechunk`,result:`success`,file:img };
          ws.send(JSON.stringify(chunk));
        },
        err => { elog(`curlImagePromise Rejection`, err); }
      ).catch( e => { elog(`curlImagePromise Error`, e); }));
    } else {
      elog(`isValidImageURL`, `Failed to pass URL regex: ${image_url}`);
    }
    count++;
  }
  return Promise.all(promises);
}

function buildLatestZip(image_dir) {
  if (fs.existsSync(LATESTZIP)) fs.unlinkSync(LATESTZIP);
  jlog(`buildLatestZip`, `Compressing contents of ${image_dir} to ${LATESTZIP}`);
  try {
    syscallSync(`zip -urj ${LATESTZIP} ${image_dir}/*`);
  } catch (e) {
    elog(`buildLatestZip`, e);
  }
  if (fs.existsSync(LATESTZIP)) {
    archiveLatestZip(LATESTZIP); // Timestamp and cp to HISTDIR
    pruneHistoryDir(fs.readdirSync(HISTDIR)); // Prune the zip history when we add a new one
  } else {
    elog(`buildLatestZip`, `Failed to verify ${LATESTZIP} existence for archival!`);
  }
}

function initHistoryDir() {
  if (!fs.existsSync(HISTDIR)) {
    try { fs.mkdirSync(HISTDIR); }
    catch (e) { elog(`initHistoryDir`, e); }
    statuslog(`initHistoryDir`, `No zip history folder found, created ${HISTDIR}`);
  } else {
    try {
      let files = fs.readdirSync(HISTDIR);
      statuslog(`initHistoryDir`, `History directory holds ${files.length} previous zips.`);
      pruneHistoryDir(files);
    } catch (e) { elog(`initHistoryDir`, e); }
  }
}

function archiveLatestZip(zipfile) {
  let datename = getDateName();
  jlog(`archiveLatestZip`, `Copying ${LATESTZIP} to archive as ${HISTDIR}/${datename}.zip`);
  try { syscallSync(`cp ${zipfile} ${HISTDIR}/${datename}.zip`); }
  catch (e) { elog(`archiveLatestZip`, e); }
}

function sendLatestZip(ws) {
  let pack = getImageArchive(LATESTZIP);
  ws.binaryType = `blob`; // Actually nodebuffer
  jlog(`sendLatestZip`, `Sending ${LATESTZIP} to client.`);
  ws.send(pack);
}

function getOldestHistZip(files) {
  let oldest = files[0];
  files.forEach( file => {
    let fmtime = fs.statSync(`${HISTDIR}/${file}`);
    let omtime = fs.statSync(`${HISTDIR}/${oldest}`);
    if (Date.parse(fmtime) < Date.parse(omtime)) {
      oldest = file; // We found a new oldest
    }
  });
  return oldest;
}

function pruneHistoryDir(files) {
  if (files.length > MAXHIST) {
    cleanuplog(`pruneHistoryDir`, `Removing oldest zips down to MAXHIST (${MAXHIST})`);
    for (let i = files.length; i > MAXHIST; i--) {
      let oldest = getOldestHistZip(files);
      try {
        syscallSync(`rm ${HISTDIR}/${oldest}`);
        files.splice(files.indexOf(oldest), 1); // We nuked the file, now remove from the array
        cleanuplog(`pruneHistoryDir`, `Removed ${oldest}`);
      } catch (e) { elog(`pruneHistoryDir`, e); }
    }
    cleanuplog(`pruneHistoryDir`, `(${grn}COMPLETE${rst})  Pruned ${HISTDIR} down to ${MAXHIST}`);
  }
}

function cleanupTempDir(tempdir) {
  try {
    syscallSync(`rm -r ${tempdir}`);
    cleanuplog(`cleanupTempDir`, `(${grn}COMPLETE${rst})  Removed temporary directory ${tempdir}`);
  } catch (e) { elog(`cleanupTempDir`, e); }
}

statuslog(`${bld}${wht}STARTUP${rst}`, `Starting Node WebSocket server on 8011...`);
var WebSocketServer = require(`ws`).Server;
wss = new WebSocketServer({port: 8011});
initHistoryDir();

wss.on(`connection`, function(ws) {
  ws.on(`message`, function(message) {
    if (isValidJSON(message)) {
      message = JSON.parse(message);
      if (Array.isArray(message)) {
        jlog(`${bld}${ylw}New ${rst}Request`, `processImageArray`);
        // Tell client we got good data and expected image count
        ws.send(JSON.stringify({request:`array`,result:`success`,size:message.length}));

        // async curl the images and zip them up server-side
        let tempdir = createTempDir();
        processImageArray(message, tempdir, ws).then( () => {
          jlog(`processImageArray`, `(${grn}COMPLETE${rst})  Downloaded images saved to ${tempdir}/`);
          buildLatestZip(tempdir);
          // Tell client we finished & send the latest.zip
          ws.send(JSON.stringify({request:`array`,result:`success`,size:0}));
          sendLatestZip(ws);
          cleanupTempDir(tempdir); // We don't need to store the raw images anymore
        });
      } else if (message.request == `getlatest`) {
        jlog(`${bld}${ylw}New ${rst}Request`, `sendLatestZip`);
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
    statuslog(`socketConnection`, `Connection with client closed.`);
  });
});