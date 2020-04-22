#!/bin/bash

docker-compose down && docker rmi thothlogos/nodews:0.1
docker build -f ./Dockerfile -t thothlogos/nodews:0.1 . && docker-compose up

