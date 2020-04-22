#!/bin/bash

if ! [[ $(docker images | grep alpinexws:0.1) ]];then
  docker build -f dockerfiles/nginx/Dockerfile -t thothlogos/alpinexws:0.1 .
fi

docker-compose down && docker rmi thothlogos/nodews:0.1
docker build -f dockerfiles/nodews/Dockerfile -t thothlogos/nodews:0.1 . && docker-compose up

