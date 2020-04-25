#!/bin/bash

docker-compose down && docker rmi imgtkr_nodews:latest
docker build -f ./Dockerfile -t imgtkr_nodews:latest . && docker-compose up

