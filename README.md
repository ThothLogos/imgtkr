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

### TODO

- Postgres side needs: watcher script for lockfile, and getpics script to generate zip file output to /cover-data.

- Solve the Nginx Octet prompt bullshit

- Can Nginx (or a lua functionality) allow us to detect the zip and redirect `/imagefetch` -> `/cover-data/image_archive.zip` ? How can we save an extra step here to make it seamless? Can the `image_fetch_unlock.sh` script be made to pause execution until the zip file shows up? Must test.
