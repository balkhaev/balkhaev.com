#!/bin/sh
# The standard Nginx entrypoint keeps serving the built edition during refreshes.
su -s /bin/sh nginx -c 'exec bun /opt/news/refresh.js /usr/share/nginx/html/news --poll' &
