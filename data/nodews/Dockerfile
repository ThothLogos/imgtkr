FROM node:12.16.2-alpine3.9

RUN apk add --no-cache zip
RUN apk add --no-cache curl
RUN mkdir /cover-data
RUN chown node:node /cover-data

COPY package.json ./package.json
COPY server.js ./server.js
RUN npm install ws

EXPOSE 8011