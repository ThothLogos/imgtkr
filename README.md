# Current Implementation

### Server-side

- 4th container added to the stack - mostly default `node:12.16.2-alpine3.9` image with some additions: `zip` and `npm install ws` (websocket lib).

- Nginx confs modified to set up proxy_pass to websocket server on port `8011`.

- `server.js` listens on `nodews` container at `8011`, any messages passed to the server are checked to see if `Array.isArray(message)` passes - if so, it is treated as an array of Image URLs to go fetch. Otherwise, it treats the message as a string and simply echos it to console and back to the client.

- Current getImages() process: 

  - create a `tempdir` named with a unix-timestamp of Date.now()
  - iterate over the URL array, do synchronous syscall to `wget` for each item, write to `tempdir`
  - synchronous syscall to `zip` to package all image files into a zip, placed in `/cover-data` (shared volume)
  - do syncrhonous `fs.readFileSync()` on the finished zip, prep binary data for transfer
  - set `ws.binaryType = 'blob'`, perform `websocket.send()` to push zipfile to client
  
- __Server TODOs:__

  - Add JSON parse message for a "getlatest" from the client. Allow client to re-download the last archive.
  - Allow client to request a specific historic zip by name
  - Need to trap server's failure and do cleanup/graceful shutdown.
  - Need to manage and prune the zip history folder - keep last n.
  - Can we simplify the shared volume situation? Does nginx even need modification now?
  - Stress test, run the client script with hundreds of requests - try to double/triple-run before conclusion, etc.
  
 ### Client-side
 
- Basic html page serving as prototype, core functionality is just maintaining the websocket connection and pushing an image URL array through. Currently has some randomization of URLs so we get a different zip each time.

- Some basic GUI, added client-side console for easier output monitoring, progress bar that updates based on server's synchronous-atomic file-complete responses. Added buttons that are disabled while download is waiting for zip return.

- __Client TODOs:__

  - Handle refreshes - it kills the client end of the socket apparently? Can we trap the close/refresh and post a message to the server before we die so it can wind-down & cleanup?
  - Add button to re-grab the latest zip that's on the server
  - Add way to access server history and select previous download
  - Stress test the server with unconventional requests: very large numbers, double-sends, etc.
  
### Request Structure
  
Client request, sending image list:
  
```javascript
{
  request : "processimagelist",
  message : "none"
}
```
Requesting latest.zip:

```javascript
}
  request : "getlatest"
  message : "none"
}
```

Server responses:
  
```javascript
{
  request : "processimagelist",
  result  : "success",
  message : "none"
}

}
  request : "getlatest"
  result  : "success",
  message : "none"
}
```
