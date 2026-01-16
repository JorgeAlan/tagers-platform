# ═══════════════════════════════════════════════════════════════════════════
# KISS API - Dockerfile para Monorepo
# ═══════════════════════════════════════════════════════════════════════════
# 
# Este Dockerfile se ejecuta desde la raíz del monorepo.
# Railway configura Root Directory: packages/kiss-api
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
COPY packages/kiss-api ./packages/kiss-api

# Instalar dependencias
# --frozen-lockfile falla si no hay lock, por eso el fallback
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Ir al directorio del servicio
WORKDIR /app/packages/kiss-api

# Puerto de KISS
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

CMD ["node", "src/server.js"]
