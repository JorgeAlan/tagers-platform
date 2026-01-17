FROM node:20-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/luca-api/package.json ./packages/luca-api/

# Instalar pnpm y dependencias
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copiar código fuente
COPY packages/shared ./packages/shared
COPY packages/luca-api ./packages/luca-api

WORKDIR /app/packages/luca-api

EXPOSE 3002

CMD ["node", "src/server.js"]
