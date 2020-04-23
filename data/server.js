const fs          = require(`fs`);                                 // File reading->blob->xmit
const util        = require(`util`);                               // Promise-wrapper for child_proc
const syscall     = util.promisify(require(`child_process`).exec); // Promise-based syscall for curl
const syscallSync = require(`child_process`).execSync;             // Synchronous syscall for zip/rm
const ws          = require(`ws`).Server;                          // WebSocket lib

// Important local server paths
const DATADIR   = `/cover-data`;                // Our main working directory
const HISTDIR   = `${DATADIR}/previous_zips`;   // Store prev zips, limited by MAXHIST
const LATESTZIP = `${DATADIR}/latest.zip`;      // Always references the most recent zip

// Magic numbers
const MAXHIST   = 10;     // Limits how many historic zips we keep           pruneHistoryDir()
const BSIZE = 30;     // Max async requests per interval for curls
const BTIME = 1250;   // Pause length in milliseconds for curl batches   rateLimitTimeout()
const PORT      = 8011;   // WebSocketServer will listen here

// Descriptive ANSI color macros, saving char cols where I can
const rs = `\x1b[0m`;
const bd = `\x1b[1m`;
const rd = `\x1b[31m`;
const gr = `\x1b[32m`;
const yl = `\x1b[33m`;
const bl = `\x1b[34m`;
const mg = `\x1b[35m`;
const cy = `\x1b[36m`;
const wt = `\x1b[37m`;

slog(`\t${bd}STARTUP${rs}`, `\tStarting Node WebSocket server on ${PORT}...`);
const WebSocketServer = new ws({port: PORT});

initHistoryDir();       // Check the HISTDIR for setup/cleanup, potential call to pruneHistoryDir()
pruneRogueDirs();       // Check for & cleanup orphaned temp download dirs (from server interupts)

WebSocketServer.on(`connection`, function(socket) {
  socket.on(`message`, function(message) {
    if (isValidJSON(message)) {
      message = JSON.parse(message);
      if (message.request == `processSkurls`) {
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) processSkurls -> call processSkurls()`);
        let tempdir = createTempDir();
        let acknowledgement = {request:`processSkurls`,result:`received`,size:message.data.length};
        socket.send(JSON.stringify(acknowledgement)); // Tell client we got the skurls and how many
        processSkurls(message.data, tempdir, socket).then( () => {
          jlog(`processSkurls`, `(${gr}COMPLETE${rs})  Downloaded images saved to ${tempdir}/`);
          buildLatestZip(tempdir);
          socket.send(JSON.stringify({request:`processSkurls`,result:`complete`,size:0}));
          sendLatestZip(socket);
          cleanupTempDir(tempdir); // We don't need to store the raw images anymore
        });
      } else if (message.request == `getLatestZip`) {
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) getLatestZip -> call sendLatestZip()`);
        sendLatestZip(socket);
      } else {
        mlog(`unhandledMessage`, `Unknown JSON request received: ${message}`);
      }
    } else {
      mlog(`unhandledMessage`, `${message}`);
      socket.send(`Server received from client: ${message}`);
    }
  });
  socket.on(`close`, function () {
    slog(`socketConnection`, `Connection with client closed.`);
  });
});



/* * * * * * * * * * * * * * * * * *
 *   REQUEST-PROCESSING FUNCTIONS  *
 * * * * * * * * * * * * * * * * * */


// Ensures the temporary directory exists that we will curl images into, for a fresh latest.zip
function createTempDir() {
  let now = Date.now(); // Returns unix-time seconds as our unique name for the tempdir
  if (!fs.existsSync(`${DATADIR}/${now}`)){
    try { fs.mkdirSync(`${DATADIR}/${now}`); }
    catch (e) { elog(`createTempDir`, e); }
    jlog(`createTempDir`, `Created temporary processing directory: ${DATADIR}/${now}`);
  }
  return `${DATADIR}/${now}`;
}

/* The workhorse. Called when a fresh processSkurls request object arrives.
 *  - Asynchronously blasts off curl requests for each url in the request
 *  - Avoids getting banned by imagehosts by relying on rateLimitTimeout() to pulse batches of curls
 *  - Writes those images to a tempdir with new filenames based on their SKU
 *  - Sends the client an "imagechunk" success object for each successful download (progress update)
 *  - Returns Promise.all that allows the server to wait for all curls to complete before proceeding
 *  - Rate Limiting is configurable with BSIZE and BTIME constants
 */
async function processSkurls(skurls, tempdir, socket) {
  jlog(`processSkurls`, `Attempting to download images...`);
  let curl_promises = [];
  let count = 1; // Used to enforce BSIZE rateLimitTimeout()
  for (let skurl of skurls) {
    if (count % BSIZE == 0) {
      slog(`processSkurls`, `(${yl}LIMIT${rs}) Enforcing rateLimitTimeout() every ${BSIZE} curls.`);
      await rateLimitTimeout(BTIME); // don't piss off imagehosts
    }
    if (isValidImageURL(skurl.url)) {
      let fileext = getImageURLFileExtension(skurl.url);
      let skuname = `${skurl.sku}${fileext}` // Make sure .jpg or .png from URL come along
      let curl = syscall(`curl -s -o ${tempdir}/${skuname} ${skurl.url}`);
      curl_promises.push(curl.then(
        success => {
          jlog(`curlImagePromise`, `(${gr}done${rs})  ${skuname} - from URL: ${skurl.url}`);
          let chunk = { request:`imagechunk`,result:`success`,file:skuname };
          socket.send(JSON.stringify(chunk)); }, // Send client notifications for each image success
        err => { elog(`curlImagePromise Rejection`, err); }
      ).catch( e => { elog(`curlImagePromise Error`, e); }));
    } else {
      elog(`isValidImageURL`, `Failed to pass URL regex: ${skurl.url}`);
    }
    count++;
  }
  return Promise.all(curl_promises);
}

// Creates a fresh latest.zip once processSkurls() has completed
// Calls archiveLatestZip and pruneHistoryDir
function buildLatestZip(image_dir) {
  if (fs.existsSync(LATESTZIP)) fs.unlinkSync(LATESTZIP);
  jlog(`buildLatestZip`, `Compressing contents of ${image_dir} to ${LATESTZIP}`);
  try { syscallSync(`zip -urj ${LATESTZIP} ${image_dir}/*`); }
  catch (e) { elog(`buildLatestZip`, e);}
  if (fs.existsSync(LATESTZIP)) {
    archiveLatestZip(LATESTZIP); // Timestamp and cp to HISTDIR
    pruneHistoryDir(fs.readdirSync(HISTDIR)); // Prune the zip history when we add a new one
  } else {
    elog(`buildLatestZip`, `Failed to verify ${LATESTZIP} existence for archival!`);
  }
}

// Copies the recently created latest.zip and moves it into the HISTDIR
// This involves a rename from latest.zip to a sortable datename, ie 2020-04-22_191732.zip
function archiveLatestZip(zipfile) {
  let datename = getDateName();
  jlog(`archiveLatestZip`, `Copying ${LATESTZIP} to archive as ${HISTDIR}/${datename}.zip`);
  try { syscallSync(`cp ${zipfile} ${HISTDIR}/${datename}.zip`); }
  catch (e) { elog(`archiveLatestZip`, e); }
}

// Packages the existing latest.zip file into a blob/nodebuffer object, and sends to the client
function sendLatestZip(socket) {
  try {
    let pack = fs.readFileSync(LATESTZIP)
    socket.binaryType = `blob`; // Actually nodebuffer
    jlog(`sendLatestZip`, `(${cy}TRANSMIT${rs})  Sending ${LATESTZIP} to client.`);
    socket.send(pack);
  } catch (e) { elog(`sendLatestZip`, e); }
}



/* * * * * * * * * * * * *
 *   STARTUP FUNCTIONS   *
 * * * * * * * * * * * * */


// Checks to make sure the historical zip folder exists, creates if not, if so enforces a cleanup
function initHistoryDir() {
  if (!fs.existsSync(HISTDIR)) {
    try { fs.mkdirSync(HISTDIR); }
    catch (e) { elog(`initHistoryDir`, e); }
    slog(`initHistoryDir`, `No zip history folder found, created ${HISTDIR}`);
  } else {
    try {
      let files = fs.readdirSync(HISTDIR);
      slog(`initHistoryDir`, `History directory holds ${files.length} previous zips.`);
      pruneHistoryDir(files);
    } catch (e) { elog(`initHistoryDir`, e); }
  }
}



/* * * * * * * * * * * * *
 *   CLEANUP FUNCTIONS   *
 * * * * * * * * * * * * */


// Runs on startup, clears out potential orphaned temporary directories (server interrupts) 
function pruneRogueDirs() {
  let directories = getDirNamesAt(DATADIR);
  directories.forEach( dir => {
    if(isTempImageDir(dir)) {
      let roguepath = `${DATADIR}/${dir}`;
      cleanuplog(`pruneRogueDirs`, `Rogue temp directory found, removing: ${roguepath}`);
      try { syscallSync(`rm -r ${roguepath}`); }
      catch (e) { elog(`pruneRogueDirs`, e); }
    }
  });
}

// Runs on startup and every time a new latest.zip is made - enforces a max HISTDIR population
// Removes zips from HISTDIR based on MAXHIST number, the oldest files are removed
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
    cleanuplog(`pruneHistoryDir`, `(${gr}COMPLETE${rs})  Pruned ${HISTDIR} down to ${MAXHIST}`);
  }
}

// Runs after latest.zip is created archived and sent; cleans up tempdir and images used
function cleanupTempDir(tempdir) {
  try {
    syscallSync(`rm -r ${tempdir}`);
    cleanuplog(`cleanupTempDir`, `(${gr}COMPLETE${rs})  Removed temporary directory ${tempdir}`);
  } catch (e) { elog(`cleanupTempDir`, e); }
}



/* * * * * * * * * * * *
 *   HELPER FUNCTIONS  *
 * * * * * * * * * * * */

// Used during processSkurls() asynchronous curl calls to slow them down
// Better to rate-limit ourselves than fail curls b/c the target host blocked us
async function rateLimitTimeout() {
  slog(`rateLimitTimeout`, `(${yl}LIMIT${rs}) Paused for ${BTIME} ms.`);
  return new Promise( resolve => { setTimeout( () => { resolve(`resolved!`); }, BTIME); });
}

// Extract file extensions from URLs (hopefully)
function getImageURLFileExtension(url) {
  let ext_regex = /\.([0-9a-z]+)(?=[?#])|(\.)(?:[\w]+)$/gmi;
  let ext = ``;
  if (url.match(ext_regex)) { ext = url.match(ext_regex)[0]; }
  return ext;
}

// Helper for pruneHistoryDir() to delete based on file modified times
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

// Crappy regex to detect Unix-time formatted strings (10-digits)
function isTempImageDir(dir) {
  return /^1\d{9}/.test(dir);
}

// Return list of directories within target path
function getDirNamesAt(path) {
  return fs.readdirSync(path, {withFileTypes:true}).filter(d => d.isDirectory()).map(d => d.name);
}

// Verify JSON is valid before we attempt to use it, used by WebSocketServer for parsing requests
function isValidJSON(str) {
  try { JSON.parse(str); } catch (e) { return false; }
  return true;
}

// Sanity-check URLs sent to us as part of the processSkurls request
function isValidImageURL(image_url) {
  return /^(?:\w+:)?\/\/([^\s\.]+\.\S{2}|localhost[\:?\d]*)\S*$/.test(image_url);
}

// An absolutely disgusting process for generating custom datetime to name archived zips
// "As I rained blows upon him, I realized: there has to be another way!" - Frank Costanza
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

// Color Logging - Error, Warn, Job, Message, Cleanup, Status
function elog(src, err) { console.log(`[ ${rd}${bd}!${rs} ${rd}ERR${rs} ] ${src}\t${err}`);}
function wlog(src, wrn) { console.log(`[ ${yl}${bd}!${rs} ${yl}WRN${rs} ] ${src}\t${wrn}`); }
function jlog(src, msg) { console.log(`[ ${mg} JOB ${rs} ] ${src}\t${msg}`); }
function mlog(src, msg) { console.log(`[${cy}MESSAGE${rs}] ${src}\t${msg}`); }
function cleanuplog(src, msg) { console.log(`[${yl}CLEANUP${rs}] ${src}\t${msg}`); }
function slog(src, msg) { console.log(`[ ${bl}STATE${rs} ] ${src}\t${msg}`); }
