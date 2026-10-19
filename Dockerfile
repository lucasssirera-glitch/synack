FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY agents ./agents
COPY mcp ./mcp
ENV PORT=8787 DB_PATH=/app/data/synack.db
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 8787
USER node
CMD ["node", "--no-warnings", "server/index.js"]
