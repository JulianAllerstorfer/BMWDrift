FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NO_OPEN=1 \
    PORT=8046
COPY . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8046
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8046/ >/dev/null || exit 1
CMD ["node", "server.js"]
