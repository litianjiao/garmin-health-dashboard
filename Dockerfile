FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
COPY package*.json ./
RUN npm ci --omit=dev && npm install -g garmin-connect-mcp@0.4.0 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/types.ts src/demo.ts ./src/
RUN npm install --no-save tsx@4.21.0 && npm cache clean --force
USER node
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
