FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ ./src/
EXPOSE 8080
CMD ["node", "src/index.js"]
