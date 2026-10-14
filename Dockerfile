FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8097 HOST=0.0.0.0 REPORT_DIR=/app/data/reports
COPY package.json server.mjs ./
COPY public/ ./public/
RUN mkdir -p /app/data/reports && chown -R node:node /app
USER node
EXPOSE 8097
CMD ["node", "server.mjs"]
