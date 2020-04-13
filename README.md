# Notes

- nginx has wget, can shell into /bin/sh, vi. no apt!

- postgres - no editor? no vi, vim, nano, ed -- can apt-get update and install nano

- able to make shared volume and have both containers have live updates




### Possible ways to trigger scripts:

- get http lua module for nginx and use os.system('myscript.sh'), can launch from an endpoint

- post a lockfile (or delete a lockfile) to cause a cron-controlled watcher to kick into gear, then place .zip at another endpoint for download
