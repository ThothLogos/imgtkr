# Notes

- nginx has wget, can shell into /bin/sh, vi. no apt!

- postgres - no editor? no vi, vim, nano, ed -- can apt-get update and install nano

- able to make shared volume and have both containers have live updates




### Possible ways to trigger scripts:

- get http lua module for nginx and use os.system('myscript.sh'), can launch from an endpoint

- post a lockfile (or delete a lockfile) to cause a cron-controlled watcher to kick into gear, then place .zip at another endpoint for download


### WIP

- Created custom `Dockerfile` to attach additional functionality to nginx box: a lua http module, bash, nano

- Set a shared volume between postres and nginx. Update `app.conf` to serve shared volume `/cover-data`.

- `nginx.conf` needed some `load_module` directives to enable our desired lua functionality

- Add route in `app.conf` to server `/imagefetch` as the script tigger point for `image_fetch_unlock.sh`

- Lua module allows us to use `os.system("/usr/local/bin/image_fetch_unlock.sh")` as a response to `/imagefetch` URL.

- `image_fetch_unlock.sh` is a test script which detects and creates a `/cover-data/lockfile` and logs its activites to `/cover-data/image_fetch_unlock.log`

- As changes are made to our `Dockerfile`, keep `docker-compose.yml` in line with the new versions. Tear down, rebuild.

### TODO \[DEPRECATED]

- Postgres side needs: watcher script for lockfile, and getpics script to generate zip file output to /cover-data.

- Solve the Nginx Octet prompt bullshit

- Can Nginx (or a lua functionality) allow us to detect the zip and redirect `/imagefetch` -> `/cover-data/image_archive.zip` ? How can we save an extra step here to make it seamless? Can the `image_fetch_unlock.sh` script be made to pause execution until the zip file shows up? Must test.


### Next Ideas \[DEPRECATED]

- Nginx doesn't natively support CGI. Can we use FastCGI to do something like: browser pushes array of images to cgi endpoint, cgi script does its work, places zip in a served directory, then messages back that the file is complete/ready? Then browsier handles the response and either attempts to download the zip or not, based on success/failure?

- Nginx can act to proxy requests to a WebSockets server. Can we run node on nginx container (or separate container), then browser sends array of images to /websocket_addr, nginx passes this request to a node server which receives the array, parses/sanity checks, does the downloading/zipping, then either:

  - Directly pushes blob data back through to the browser, which would've been doing some async shit waiting for a response, then grabs the zip?

  - Or, if we can't do that, can we send a simple response that "zip script successful, here is the url/filename" and the browser utilizes that response to grab the file after from a 2nd, nginx served directory? (shared volume)

### 4/15 Success

- Created a custom NodeJS image Dockerfile that ensures access to shared volume and installs server.js and npm necessities. Runs on port 8011.

- Nginx handles requests to 8011 and has updated configs to allow WebSocket passthrough.

- Client-side browser uses built-in WebSocket() class to send a specific request string, to which the server will respond by serving the testimages.zip file as a Blob. Client receives this message and uses FileReader.readAsArrayBuffer to trigger onload() which uses FileSaver.saveAs(msg.data) to rip the Blob to local file.

- Zip successfully transferred!

- TODO: Have client send a JS Array to the server. Server should parse this message for sanity checks, once passing it performs the `wget` operations to get the images, compile them into a zip, and use that instead of a test file.

- TODO: Client should have proper async handling of this event: a button to send the array, an element that shows status "Ready/Transmitting/Waiting for Response/Received", updated as different parts progress. The main goal is responsive user feedback that lets them know things are happening - large zip files may take several momments to wget and transmit.
