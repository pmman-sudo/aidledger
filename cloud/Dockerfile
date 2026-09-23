FROM node:24-alpine AS dependencies
WORKDIR /app/cloud
COPY cloud/package.json cloud/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/cloud/node_modules ./cloud/node_modules
COPY cloud ./cloud
COPY artifacts/AidLedgerCloud.json ./artifacts/AidLedgerCloud.json
USER node
EXPOSE 8080
CMD ["node", "cloud/server.mjs"]
