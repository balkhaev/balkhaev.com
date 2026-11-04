FROM oven/bun:1 AS build
WORKDIR /site
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build
RUN bun build ./scripts/refresh-news.ts --target=bun --outfile=/site/news-refresh.js

FROM oven/bun:1-alpine AS news-runtime

FROM nginx:alpine
RUN apk add --no-cache libstdc++
COPY --from=news-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=build /site/news-refresh.js /opt/news/refresh.js
COPY --chmod=755 deploy/40-news.sh /docker-entrypoint.d/40-news.sh
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /site/dist /usr/share/nginx/html
RUN chown nginx /usr/share/nginx/html/news && bun --version
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
