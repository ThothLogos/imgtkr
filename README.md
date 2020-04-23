## Installation: Marge my work into main repo

- Your main repo's `data` folder will need `data/server.js`, `data/package.json`, `data/nginx.conf`, and `data/nginx/app.conf` from this repo.
- The `Dockerfile` in this repo controls customizations to the default `node-alpine` image. It will need to be present.
- My changes to `docker-compose.yml` should be merged into the main repo's as well.
- ???
- Profit


~~- I think that's it, after that you need to build the `nodews` image:~~
  ~~- `docker build -f [DOCKERFILE] -t [IMAGE_NAME] [BUILD_CONTEXT_PATH]`, where `IMAGE_NAME` format is typically: `[REPO/AUTHOR]/[IMAGENAME]:[VERSION]`. Examples: `thothlogos/nodews:0.1` or `gutterpop/imgtkr:1.0` etc.~~
  ~~- The command might be `docker build -f ./Dockerfile -t thothlogos/nodews:0.1 .` __Note the dot at the end!__ The last argument is the "build context", so in this example I would be running it from the project root, the same place the `docker-compose.yml` exists right now. This is relevant for the image to orient itself in the file system, in the event it needs to follow instructions about finding files to copy over, etc.~~
  ~~- This image should be built and ready to go, __IF__ you changed the `IMAGE_NAME` stuff above, you will need to update the `docker-compose.yml` to use the new naming.~~
~~- Once the image is built, I believe running `docker-compose up` should `doAllTheThings()` from there.~~

- The `rebuild.sh` script is a dev tool for me to quickly tear down all containers, nuke the `nodews` image, rebuild it fresh, and re-compose the cluster. It should be an irrelevant process to a production environment but may be handy when testing.
- The `client.html` file is also a dev/testing tool, it is not necessary for the cluster, but may serve as a reference for implementing a WebSocket client in the Vue app.

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
  - do asynchronous calls to `curl` for each image, using a `setTimeout` promise to rate-limit
  - use regex capture on each `skurl.url` to get the `file_ext` ie jpg, png, etc
  - use the `skurl.sku` property with the `file_ext` to rename files to `${skurl.sku}.${file_ext}`. This happens as part of the `curl` command's parameters.
  - after all `curl` calls return, perform synchronous syscall to `zip` to package all SKUnamed images, placing the resultant file at `/cover-data/latest.zip`
  - do `fs.readFileSync()` on the finished zip, prep binary data for transfer
  - set `ws.binaryType = 'blob'`
  - perform `websocket.send()` to push zipfile to client
  - `cp` the fresh `latest.zip` to `/cover-data/previous_zips/` and rename with datetime, ie `2020-04-21_191039.zip`
  - perform auto-cleanup using `const MAXHIST` to determine how many historical zips to keep. This runs when any new zips are made and during server startup, prevent container filesystem bloat. Historical zips are kept in-case of oh-shit need, and for a future potential feature to allow the user to access previous archives for re-download.
  
- __Server TODOs:__

  - Cleanup on startup for potential tempdir orphans
  - Allow client to request a specific historic zip by name
  - Need to trap server's failure and do cleanup/graceful shutdown.
  - Can we simplify the shared volume situation? Does nginx even need modification now?
  - Stress test, run the client script with hundreds of requests - try to double/triple-run before conclusion, etc.
  
 ### Client-side
 
- Basic html page serving as prototype, core functionality is just maintaining the websocket connection and pushing a properly formatted request to the server. The test `client.html` generates dummy skurls for development uses.

- Some basic GUI, added client-side console for easier output monitoring, progress bar that updates based on server's `imagechunk` responses. Added buttons that are disabled while download is waiting for zip return.

- __Client TODOs:__

  - Handle refreshes - it kills the client end of the socket apparently? Can we trap the close/refresh and post a message to the server before we die so it can wind-down & cleanup?
  - Add way to access server history and select previous download
  - Stress test the server with unconventional requests: very large numbers, double-sends, etc.
  
# Request Structure

## Client Requests

__The server will respond to any WebSocket-sent JSON request follow the formats below:__

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
  request : 'imagechunk',
  result  : 'success',
  file    : '064508.jpg'
}

// Server sends a final notice that the Skurls request has finished server-side
// After this the server compiles and pushes latest.zip to client
// Again this can be used to trigger UI status updates, progress tracking etc
{
  request : "processSkurls",
  result  : "complete",
  size    : 0
}

// Server confirms receipt of a getLatestZip request
// UI status update: "Server is re-sending most recent zip..."
}
  request : "getLatestZip",
  result  : "received"
}
```
## Client Handling of Server Responses Example

```javascript

socket.onmessage = function(message) {
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
