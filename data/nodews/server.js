const VERSION     = `1.1.0`;

const fs          = require(`fs`);                                 // File reading->blob->xmit
const util        = require(`util`);                               // Promise-wrapper for child_proc
const syscall     = util.promisify(require(`child_process`).exec); // Promise-based syscall for curl
const syscallSync = require(`child_process`).execSync;             // Synchronous syscall for zip/rm
const ws          = require(`ws`).Server;                          // WebSocket lib

// Important local server paths
const DATADIR   = `/cover-data`;                // Our main working directory
const HISTDIR   = `${DATADIR}/previous_zips`;   // Store prev zips, limited by MAXHIST
const LATESTZIP = `${DATADIR}/latest.zip`;      // Always references the most recent zip

// Logfiles
const ERRLOGFILE = `${DATADIR}/imgtkr_errors.log`;  // All elog() calls able to be written-to-file

// Magic numbers
const MAXHIST   = 10;     // Limits how many historic zips we keep           pruneHistoryDir()
const BSIZE     = 15;     // Max async requests per interval for curls
var   BTIME     = 50;     // Pause length in milliseconds for curl batches   rateLimitTimeout()
const PORT      = 8011;   // WebSocketServer will listen here

const MAXRETRIES = 100;   // Prevent run-away loops
var   RETRIES    = 0;

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

initErrorLogFile();     // Ensure the ERRLOGFILE exists
initHistoryDir();       // Check the HISTDIR for setup/cleanup, potential call to pruneHistoryDir()
pruneRogueDirs();       // Check for & cleanup orphaned temp download dirs (from server interupts)
elog(`serverStartup`, `The server was started (not actually an error)`, true, false);

WebSocketServer.on(`connection`, function(socket) {
  socket.on(`message`, function(message) {
    if (isValidJSON(message)) {
      message = JSON.parse(message);
      if (message.request == `processSkurls`) {
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) processSkurls -> call processSkurls()`);
        let tempdir = createTempDir();
        let acknowledgement = {request:`processSkurls`,result:`received`,size:message.data.length};
        socket.send(JSON.stringify(acknowledgement)); // Tell client we got the skurls and how many
        let skurl_fails = []; // will hold any unhandled failed skurls, to be logged/sent clientside
        processSkurls(message.data, tempdir, skurl_fails, socket).then( () => {
          jlog(`processSkurls`, `(${gr}done${rs}) Downloaded images saved to ${tempdir}/`);
          if (skurl_fails.length > 0) {
            jlog(`processSkurls`, `(${rd}FAILURES${rs}) Some skurls failed to be completed!`);
            jlog(`processSkurls`, `(${rd}-${rs}) Total failed skurls: ${skurl_fails.length}. ` +
                `See ${ERRLOGFILE} for specific skurl details.`);
            reportSkurlFails(skurl_fails, socket);
          } else {
            jlog(`processSkurls`, `(${gr}COMPLETE${rs}) All skurls were retrieved, 0 fails.`);
          }
          buildLatestZip(tempdir);
          socket.send(JSON.stringify({request:`processSkurls`,result:`complete`,size:0}));
          sendLatestZip(socket);
          cleanupTempDir(tempdir); // We don't need to store the raw images anymore
          BTIME = 50; // Reset any rateLimit accumulation for the next request
        });
      } else if (message.request == `getLatestZip`) {
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) getLatestZip -> call sendLatestZip()`);
        sendLatestZip(socket);
      } else if (message.request == `getZipHistory`) {
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) getZipHistory -> call sendZipHistory()`);
        sendZipHistory(socket);
      } else if (message.request == `getZipByName`) {
        let zip = message.zipname;
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) getZipByName -> call sendZipByName()`);
        sendZipByName(zip, socket);
      } else if (message.request == `getServerVersion`) {
        jlog(`\t${yl}NEW${rs}\t`, `(${yl}REQUEST${rs}) getServerVersion -> call reportVersion()`);
        reportVersion(socket);
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


// Attempt to shutdown before forced kill from docker
process.once('SIGTERM', () => {
  slog(`shutdownProcess`, `(${rd}SIGTERM${rs}) Attempting graceful shutdown...`);
  WebSocketServer.close();
});



/* * * * * * * * * * * * * * * * * *
 *   REQUEST-PROCESSING FUNCTIONS  *
 * * * * * * * * * * * * * * * * * */


/* Called when a fresh processSkurls request object arrives.
 *  - Uses the BSIZE (Batchsize) const to parse the incoming skurls into smaller collections
 *  - Feeds these batches into processSkurlBatch()
 *  - Uses a small rateLimitTimeout() to give the server a chance to close some PIDs
 */
async function processSkurls(skurls, tempdir, skurl_fails, socket) {
  elog(`processSkurls`, `New processSkurls() curl session has begun`, true, false);
  let skurl_batch = []; // will hold sub-array to be sent to processSkurlBatch()
  let skurl_count = 1;  // used in combination with BSIZE to segregate batches
  let batch_count = 0;  // informational purposes in logging
  let batch_fails = 0;  // informational purposes in logging
  for (let skurl of skurls) {
    if (isValidImageURL(skurl.url)) {
      skurl_batch.push(skurl);
      if (skurl_count % BSIZE == 0 || skurl_count == skurls.length) {
        batch_count++;
        let sf0 = skurl_fails.length;
        jlog(`processSkurls`, `Starting Batch ${batch_count} ` +
             `\tBatch size (configured): ${BSIZE}\tCurls in batch: ${skurl_batch.length}`);
        await processSkurlBatch(skurl_batch, tempdir, skurl_fails, socket);
        batch_fails += skurl_fails.length - sf0;
        let fmsg = ``;
        if (batch_fails) fmsg = `(${rd}-${rs}) ${batch_fails} unrecoverable error(s) this batch.`;
        jlog(`processSkurls`, `(${gr}+${rs}) Batch ${batch_count} has finished. ${fmsg}`);
        skurl_batch = [];
        batch_fails = 0;
      }
    } else {
      elog(`isValidImageURL`, `Failed to pass URL regex: ${skurl.url}`);
      skurl_fails.push(skurl);
      batch_fails++;
    }
    skurl_count++;
  }
}

/* Called by procesSkurls() to process a batch of skurls
 *  - Receives a batch of skurls from processSkurls()
 *  - Fires off asynchronous curls for each skurl to grab the images
 *  - Writes those images to a tempdir with new filenames based on their SKU
 *  - Sends the client an "imageChunk" success object for each successful download (progress update)
 *  - Returns Promise.all, allows processSkurls to wait for each batch to complete before proceeding
 */
async function processSkurlBatch(skurls, tempdir, skurl_fails, socket) {
  jlog(`processSkurlBatch`, `(${bl}wait${rs}) Processing skurl batch...`);
  let curl_promises = [];
  let skurl_retries = [];
  for (let skurl of skurls) {
    let fileext = getImageURLFileExtension(skurl.url);
    let skuname = `${skurl.sku}${fileext}`; // Make sure .jpg or .png from URL come along
    let curl = syscall(`curl -s -o ${tempdir}/${skuname} ${skurl.url}`);
    curl_promises.push(curl.then(
      success => {
        let chunk = { request:`imageChunk`,result:`success`,file:skuname };
        socket.send(JSON.stringify(chunk)); }, // Send client notifications for each image success
      err => { 
        if (err.code == 1) {
          elog(`curlImagePromise`, `1 - CURLE_UNSUPPORTED_PROTOCOL \t ${skurl.url}`);
          skurl_fails.push(skurl);
        } else if (err.code == 6) {
          wlog(`curlImagePromise`, `6 - CURLE_COULDNT_RESOLVE_HOST \t ${skurl.url}`);
          skurl_retries.push(skurl);
        } else if (err.code == 7) {
          wlog(`curlImagePromise`, `7 - CURLE_COULDNT_CONNECT \t ${skurl.url}`);
          skurl_retries.push(skurl);
        } else {
          elog(`curlImagePromise`, `${err.code} - ${err}`);
          skurl_fails.push(skurl);
        }
    }).catch( e => { elog(`curlImagePromise`, e); }));
  }
  await Promise.all(curl_promises); // Allow the full round of requests to finish
  if (skurl_retries.length > 0) { // We may have had some failed curls - we'll retry them
    jlog(`processSkurlBatch`, `(${yl}RETRIES${rs}) ${skurl_retries.length} failed, retrying...`);
    if (RETRIES >= MAXRETRIES) {
      wlog(`skurlRetries`, `Retried too many times, these skurls failed: ` +
           `${JSON.stringify(skurl_retries)}`);
      skurl_fails.concat(skurl_retries); // Whatever we gave up on, consider it failed
    } else {
      RETRIES++;
      BTIME += 500;
      await rateLimitTimeout(BTIME); // don't piss off imagehosts
      await processSkurls(skurl_retries, tempdir, socket); // Recurse our failures (what a metaphor)
    }
  } else { BTIME <= 25 ? BTIME = 25 : BTIME -= 50; }
}

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

// Creates a fresh latest.zip once processSkurls() has completed
// Calls archiveLatestZip and pruneHistoryDir
function buildLatestZip(image_dir) {
  if (fs.existsSync(LATESTZIP)) fs.unlinkSync(LATESTZIP);
  if (getFileNamesAt(image_dir).length > 0) {
    jlog(`buildLatestZip`, `(${bl}wait${rs}) Compressing contents of ${image_dir} to ${LATESTZIP}`);
    try { syscallSync(`zip -urj ${LATESTZIP} ${image_dir}/*`); }
    catch (e) { elog(`buildLatestZip`, e);}
    if (fs.existsSync(LATESTZIP)) {
      archiveLatestZip(LATESTZIP); // Timestamp and cp to HISTDIR
      pruneHistoryDir(fs.readdirSync(HISTDIR)); // Prune the zip history when we add a new one
    } else {
      elog(`buildLatestZip`, `Failed to verify ${LATESTZIP} existence for archival!`);
    }
    jlog(`buildLatestZip`, `(${gr}COMPLETE${rs}) ${LATESTZIP} is ready.`);
  } else {
    elog(`buildLatestZip`, `The directory ${image_dir} was empty! Cannot zip! Aborting.`);
  }
}

// Copies the recently created latest.zip and moves it into the HISTDIR
// This involves a rename from latest.zip to a sortable datename, ie 2020-04-22_191732.zip
function archiveLatestZip(zipfile) {
  let datename = getDateName();
  jlog(`archiveLatestZip`, `(${bl}+${rs}) Copying ${LATESTZIP} to archive as ` +
       `${HISTDIR}/${datename}.zip`);
  try { syscallSync(`cp ${zipfile} ${HISTDIR}/${datename}.zip`); }
  catch (e) { elog(`archiveLatestZip`, e); }
}

// Packages the existing latest.zip file into a blob/nodebuffer object, and sends to the client
function sendLatestZip(socket) {
  try {
    let pack = fs.readFileSync(LATESTZIP)
    socket.binaryType = `blob`; // Actually nodebuffer
    jlog(`sendLatestZip`, `(${cy}TRANSMIT${rs}) Sending ${LATESTZIP} to client.`);
    socket.send(pack);
  } catch (e) { elog(`sendLatestZip`, e); }
}

// Generates an array of filenames in the HISTDIR, and sends them as JSON to the client
function sendZipHistory(socket) {
  try {
    let zipnames = getFileNamesAt(HISTDIR);
    let response = { request:`getZipHistory`, data: zipnames };
    socket.send(JSON.stringify(response));
    jlog(`sendZipHistory`, `(${gr}COMPLETE${rs}) Sent contents of ${HISTDIR} to client.`);
  } catch (e) { elog(`sendZipHistory`, e); }
}

function sendZipByName(zipname, socket) {
  let path = `${HISTDIR}/${zipname}`;
  if (fs.existsSync(path)) {
    try {
      let pack = fs.readFileSync(path);
      socket.binaryType = `blob`; // Actually nodebuffer
      jlog(`sendZipByName`, `(${cy}TRANSMIT${rs}) Sending ${path} to client.`);
      socket.send(pack);
    } catch (e) { elog(`sendZipByName`, e); }
  } else {
    let fail_response = {request:`getZipByName`,result:`notfound`,zipname: path};
    socket.send(JSON.stringify(fail_response));
    jlog(`sendZipByName`, `(${rd}FAIL${rs}) Client requested file not found on server (${path})`);
  }
}

function reportSkurlFails(skurl_fails, socket) {
  let report = { request:`processSkurls`, result:`failures`, data: skurl_fails };
  socket.send(JSON.stringify(report));
  jlog(`reportSkurlFails`, `(${rd}-${rs}) Sent list of failed skurl requests to client`);
}

function reportVersion(socket) {
  let response = { request: `getServerVersion`, result: `success`, data: VERSION };
  socket.send(JSON.stringify(response));
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

// Check for ERRLOGFILE on startup, make sure it's `touch` ed if not
function initErrorLogFile() {
  if (!fs.existsSync(ERRLOGFILE)) {
    try {
      fs.closeSync(fs.openSync(ERRLOGFILE, 'w'));
      slog(`initErrorLogFile`, `Created logfile at ${ERRLOGFILE}`);
    } catch (e) {
      // Pass false so that we don't write to a non-existent file that failed creation
      elog(`initErrorLogFile`, `Unable to create a new ${ERRLOGFILE}!!`, false);
    }
  } else {
    slog(`initErrorLogFile`, `Error logile exists at ${ERRLOGFILE}`);
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
    cleanuplog(`pruneHistoryDir`, `(${bl}+${rs}) Removing old zips down to MAXHIST (${MAXHIST})`);
    for (let i = files.length; i > MAXHIST; i--) {
      let oldest = getOldestHistZip(files);
      try {
        syscallSync(`rm ${HISTDIR}/${oldest}`);
        files.splice(files.indexOf(oldest), 1); // We nuked the file, now remove from the array
        cleanuplog(`pruneHistoryDir`, `(${bl}+${rs}) Removed ${oldest}`);
      } catch (e) { elog(`pruneHistoryDir`, e); }
    }
    cleanuplog(`pruneHistoryDir`, `(${bl}+${rs}) Pruned ${HISTDIR} down to ${MAXHIST}`);
  }
}

// Runs after latest.zip is created archived and sent; cleans up tempdir and images used
function cleanupTempDir(tempdir) {
  try {
    syscallSync(`rm -r ${tempdir}`);
    cleanuplog(`cleanupTempDir`, `Removed temporary directory ${tempdir}`);
  } catch (e) { elog(`cleanupTempDir`, e); }
}



/* * * * * * * * * * * *
 *   HELPER FUNCTIONS  *
 * * * * * * * * * * * */


// Used during processSkurls() asynchronous curl calls to slow them down
// Better to rate-limit ourselves than fail curls b/c the target host blocked us
async function rateLimitTimeout(ms) {
  slog(`rateLimitTimeout`, `(${yl}LIMIT${rs}) Paused for ${ms} ms.`);
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

function getFileNamesAt(path) {
  return fs.readdirSync(path, {withFileTypes:true}).filter(d => !d.isDirectory()).map(d => d.name);
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
function elog(src, err, writetofile = true, broadcast = true) {
  if (broadcast) console.log(`[${rd}${bd}!${rs} ${rd}ERR ${bd}!${rs}] ${src}\t${err}`);
  if (writetofile) {
    let logger = fs.createWriteStream(ERRLOGFILE, { flags: `a` });
    let dt = new Date().toISOString().slice(0, -5);
    logger.write(`${dt}  ${src}\t${err}\n`);
    logger.close;
  }
}
function wlog(src, wrn) { console.log(`[${yl}${bd}!${rs} ${yl}WRN ${bd}!${rs}] ${src}\t${wrn}`); }
function jlog(src, msg) { console.log(`[ ${mg} JOB ${rs} ] ${src}\t${msg}`); }
function mlog(src, msg) { console.log(`[${cy}MESSAGE${rs}] ${src}\t${msg}`); }
function cleanuplog(src, msg) { console.log(`[${yl}CLEANUP${rs}] ${src}\t${msg}`); }
function slog(src, msg) { console.log(`[ ${bl}STATE${rs} ] ${src}\t${msg}`); }
