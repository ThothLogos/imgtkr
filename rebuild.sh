#!/bin/bash



docker-compose down && docker rmi thothlogos/nodews:0.1
docker build -f dockerfiles/nodews/Dockerfile -t thothlogos/nodews:0.1 . && docker-compose up