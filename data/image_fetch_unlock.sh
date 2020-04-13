#!/bin/sh

if [[ -f /cover-data/lockfile ]];then
  echo "$(date) - Lockfile in place." >> /cover-data/image_fetch_unlock.log
else
  touch /cover-data/lockfile
  if [[ $? -eq 0 ]];then
    echo "$(date) - Successfully created lockfile." >> /cover-data/image_fetch_unlock.log
  else
    echo "$(date) - Lockfile created exited with non-zero status" >> /cover-data/image_fetch_unlock.log
  fi
fi