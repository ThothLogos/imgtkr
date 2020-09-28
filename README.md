# Current Implementation Details


### Server-side

- 4th container added to the stack - mostly default `node:12.16.2-alpine3.9` image with some additions: `zip`, `curl` and `npm install ws` (websocket lib).

- Nginx confs modified to set up proxy_pass to websocket server on port `8011`. The only change to Nginx's docker-compose configuration is a new volume directive `./data/nginx.conf:/etc/nginx/nginx.conf` to install the modified conf.

- `server.js` listens on `nodews` container at `8011`, any messages passed to the server are checked for their `message.request` property, which contain procotol keywords to trigger and track server-side events.

- A new data type known as the "skurl" has been born to reference such a construction:

```javascript
let skurl = { sku : "SKU123098", url : "https://img.example.com/images/somepic0001.jpg" };
```

- Current process for handling the `processSkurls` request type:

  - create a temporary directory named with a unix-timestamp
  - `processSkurls()` uses the `BSIZE` constant to count up and fire-off batches of curls at a time (basically it self-limits the maximum number of concurrent curl processes that can be spun up)
  - each batch is allowed to fully finish before the next is processed
  - batches are passed off to `processSkurlBatch()` which does the work
  - do asynchronous calls to `curl` for each image in the batch
  - use regex capture on each `skurl.url` to get the `file_ext` ie jpg, png, etc
  - use the `skurl.sku` along with the captured `file_ext` to rename files to `${skurl.sku}.${file_ext}`. The actual re-naming happens as part of the `curl` command's parameters.
  - after all `curl` calls return in the batch, control is passed back to `processSkurls()` to get the next batch
  - after all batches complete, perform synchronous syscall to `zip` to package all SKUnamed images, placing the resultant file at `/cover-data/latest.zip`
  - do `fs.readFileSync()` on the finished zip, prep binary data for transfer
  - set `websocket.binaryType = 'blob'`
  - perform `websocket.send()` to push zipfile to client
  - `cp` the fresh `latest.zip` to `/cover-data/previous_zips/` and rename with datetime, ie `2020-04-21_191039.zip`
  - perform auto-cleanup using `const MAXHIST` to determine how many historical zips to keep. This runs when any new zips are made and during server startup, preventing container filesystem bloat. A history is kept to insure against "oh-shit" moments of lost/misplaced data.
  
- __Server TODOs:__

  - Stress test, run the client script with hundreds of requests - try to double/triple-run before conclusion, etc.
  
 ### Client-side
 
- Basic html page serving as prototype, core functionality is just maintaining the websocket connection and pushing a properly formatted request to the server. The test `client.html` generates dummy skurls for development uses.

- Some basic GUI, added client-side console for easier output monitoring, progress bar that updates based on server's `imagechunk` responses. Added buttons that are disabled while download is waiting for zip return.

- __Client TODOs:__

  - Handle refreshes - it kills the client end of the socket apparently? Can we trap the close/refresh and post a message to the server before we die so it can wind-down & cleanup?
  - Stress test the server with unconventional requests: very large numbers, double-sends, etc.
  
# Request Structure

## Client Requests

__The server will respond to any WebSocket-sent JSON request following the formats below:__

Client request, sending image list:
  
```javascript

// Each image URL comes in an object containing its product SKU
// I dub thee, a 'skurl'
let skurl1 = { sku : "SKU0000009", url : "https://img.example.com/images/somepic0001.jpg" };
let skurl2 = { sku : "SKU0011119", url : "https://img.example.com/images/somepic0001.jpg" };
// and so on

// Push each SKU/URL object above into an Array
let skurls_arr = [ skurl1, skurl2, ... ];

// Wrap that array in an object that includes a "request" property, informing the server of the request
let request = { request : "processSkurls", data : skurls_arr };

// JSON.stringify() the above, and fire it off
WebSocket.send(JSON.stringify(request));

```
Client request, getting the existing latest.zip:

```javascript
// Tell the server what we want done
let request = { request : "getLatestZip" };

// Always be JSONing.
WebSocket.send(JSON.stringify(request));

```
Client request, asking for a list of old zips still archived on the server:

```javascript
let request = { request : "getZipHistory" };
WebSocket.send(JSON.stringify(request));
```
Client request, asking to download one of the old zips by filename:

```javascript

let request = { request : "getZipByName", zipname: "somefileIwant.zip" };
WebSocket.send(JSON.stringify(request));
```
Client request for the current server-version:
```javascript
let request = { request: "getServerVersion" }
WebSocket.send(JSON.stringify(request));
```

## Server Responses

__The server will also fire back event updates that can be used by the Vue front-end to provide feedback/updates to the user.__
  
```javascript
// The server will affirm receipt of requests to the client
// We can trigger status updates on the UI with this ie "Server received image list."
// Size can be used to track progress/remaining etc
{
  request : "processSkurls",
  result  : "received",
  size    : Serverside.skurls.length
}

// Server informs the client of every successful image completion
// Can be used for GUI progress bars, logging, etc.
{
  request : 'imageChunk',
  result  : 'success',
  file    : 'SKU064508.jpg'
}

// Server sends a final notice that the Skurls request has finished server-side
// After this the server compiles and pushes latest.zip to client
// Again this can be used to trigger UI status updates, progress tracking etc
{
  request : "processSkurls",
  result  : "complete",
  size    : 0
}

// Some skurls may fail! Could be a bad url, for example - a report will come back:
{
  request : "processSkurls",
  result  : "failures",
  data    : [ { sku:"SKU0000", url:"http://doesnotexist.com"},
              { sku:"SKU0001", url:"htts://badprotocol" },
              ... ]
}

// Server confirms receipt of a getLatestZip request
// UI status update: "Server is re-sending most recent zip..."
{
  request : "getLatestZip",
  result  : "received"
}

// Server responding to getZipHistory request with an array of filenames:
// (this is the contents of the HISTDIR location on the server /cover-data/previous_zips/)
{
  request : "getZipHistory",
  data    : [ "2020-04-22_235057.zip", "2020-04-21_21726.zip", ... ]
}

// Server lets Client know if the requested getZipByName is not found:
{
  request : "getZipByName",
  result  : "notfound",
  zipname : "thisfilenamewasntfound.zip"
}
```
## Client Handling of Server Responses Examples

```javascript

socket.onmessage = (message) => {
  if (message.data instanceof Blob) {
    // zip must be coming, do zip stuff
    // saveAs() from File-Saver.js
  } else if (isValidJSON(message.data)) {
    let server_response = JSON.parse(message.data);
    if (server_response.request == `processSkurls` && server_response.result == `received`) {
      // Server is acknowledging receipt of the processSkurls request
      document.getElementbyID(`status-box`).textContent = "Server received request.";
    } else if (server_response.request == `processSkurls` && server_response.result == `complete`) {
      // Server is telling us the entire Skurl request is finished
      document.getElementbyID(`status-bar`).textContent = "Server image downloads complete");
    } else if (server_response.request == `getLatestZip` && server_response.result == `received`) {
      // Server acknowledging request for a re-download of the most recent zip
    }
  } else {
    console.log(`Unrecognized message: ${message.data`};
  }
}
```
