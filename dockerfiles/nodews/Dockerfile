FROM node:12.16.2-alpine3.9

RUN apk add --no-cache nano
RUN mkdir /cover-data
#RUN chown nginx:nginx /cover-data

COPY ./data/package.json ./package.json
COPY ./data/server.js ./server.js
RUN npm install ws

EXPOSE 8011