FROM nginx:1.15-alpine

RUN mkdir -p /run/nginx
RUN rm /etc/nginx/nginx.conf
RUN mkdir /cover-data
RUN chown nginx:nginx /cover-data
COPY ./data/nginx.conf /etc/nginx/
COPY ./data/nginx/app.conf /etc/nginx/conf.d/
