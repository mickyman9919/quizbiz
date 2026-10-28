# ใช้กับ Railway, Fly.io, Google Cloud Run, VPS หรือที่ไหนก็ได้ที่รัน Docker
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
