# ═══════════════════════════════════════════════════════════════════════════
# LUCA API - Dockerfile para Monorepo
# ═══════════════════════════════════════════════════════════════════════════
# 
# Este Dockerfile se ejecuta desde la raíz del monorepo.
# Railway configura Root Directory: packages/luca-api
# Pero el build context es la raíz del repo.
#
# ═══════════════════════════════════════════════════════════════════════════

FROM node:20-alpine

# Instalar pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copiar archivos de workspace root
COPY package.json pnpm-workspace.yaml ./
# pnpm-lock.yaml puede no existir en primera ejecución
COPY pnpm-lock.yaml* ./

# Copiar packages necesarios
COPY packages/shared ./packages/shared
COPY packages/luca-api ./packages/luca-api

# Instalar dependencias
# --frozen-lockfile falla si no hay lock, por eso el fallback
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Ir al directorio del servicio
WORKDIR /app/packages/luca-api

# Puerto de LUCA
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3002/health || exit 1

CMD ["node", "src/server.js"]
