#!/bin/bash

docker-compose down && docker rmi docker-guttest_nodews:latest
docker build -f ./Dockerfile -t docker-guttest_nodews:latest . && docker-compose up

