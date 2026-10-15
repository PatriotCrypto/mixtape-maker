FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY public ./public

ENV PORT=3000 \
    MUSIC_DIR=/music \
    DATA_DIR=/data

EXPOSE 3000
USER node
CMD ["node", "server.js"]
