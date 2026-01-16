# 🚀 MIGRACIÓN A MONOREPO: KISS + LUCA

## RESUMEN DEL PLAN

```
ANTES (ahora):
GitHub: tagers-kiss/
Railway: kiss-api → apunta a tagers-kiss

DESPUÉS:
GitHub: tagers-platform/
        ├── packages/kiss-api/
        ├── packages/luca-api/
        ├── packages/shared/
        └── packages/tower/

Railway: kiss-api → apunta a tagers-platform (subdirectorio packages/kiss-api)
         luca-api → apunta a tagers-platform (subdirectorio packages/luca-api)
```

---

## PASO 1: CREAR ESTRUCTURA DEL MONOREPO

### 1.1 Crear nuevo repo en GitHub

```bash
# En tu máquina local
mkdir tagers-platform
cd tagers-platform
git init
```

### 1.2 Crear estructura de carpetas

```bash
mkdir -p packages/kiss-api
mkdir -p packages/luca-api
mkdir -p packages/shared
mkdir -p packages/tower
```

### 1.3 Estructura final

```
tagers-platform/
├── packages/
│   ├── shared/                    # Código compartido
│   │   ├── src/
│   │   │   ├── config/           # Google Sheets loader
│   │   │   ├── db/               # PostgreSQL client
│   │   │   ├── redis/            # Redis client
│   │   │   ├── whatsapp/         # WhatsApp client
│   │   │   ├── chatwoot/         # Chatwoot client
│   │   │   └── utils/            # Utilidades
│   │   ├── package.json
│   │   └── index.js
│   │
│   ├── kiss-api/                  # Tu código actual de KISS
│   │   ├── src/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── railway.json
│   │
│   ├── luca-api/                  # Nuevo servicio LUCA
│   │   ├── src/
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   └── railway.json
│   │
│   └── tower/                     # Control Tower (Next.js)
│       ├── app/
│       ├── package.json
│       └── next.config.js
│
├── package.json                   # Root workspace
├── pnpm-workspace.yaml           # pnpm workspaces config
├── turbo.json                    # Turborepo (opcional)
├── .gitignore
└── README.md
```

---

## PASO 2: CONFIGURAR WORKSPACES

### 2.1 Root package.json

```json
{
  "name": "tagers-platform",
  "private": true,
  "scripts": {
    "dev:kiss": "pnpm --filter kiss-api dev",
    "dev:luca": "pnpm --filter luca-api dev",
    "dev:tower": "pnpm --filter tower dev",
    "build:kiss": "pnpm --filter kiss-api build",
    "build:luca": "pnpm --filter luca-api build",
    "build:tower": "pnpm --filter tower build",
    "lint": "pnpm -r lint",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "turbo": "^2.0.0"
  },
  "packageManager": "pnpm@8.15.0"
}
```

### 2.2 pnpm-workspace.yaml

```yaml
packages:
  - "packages/*"
```

### 2.3 packages/shared/package.json

```json
{
  "name": "@tagers/shared",
  "version": "1.0.0",
  "main": "src/index.js",
  "dependencies": {
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    "googleapis": "^130.0.0",
    "axios": "^1.6.0"
  }
}
```

### 2.4 packages/kiss-api/package.json

```json
{
  "name": "kiss-api",
  "version": "1.0.0",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "build": "echo 'No build needed'"
  },
  "dependencies": {
    "@tagers/shared": "workspace:*",
    "express": "^4.18.0",
    "bullmq": "^5.0.0"
    // ... resto de tus dependencias actuales
  }
}
```

### 2.5 packages/luca-api/package.json

```json
{
  "name": "luca-api",
  "version": "1.0.0",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "build": "echo 'No build needed'"
  },
  "dependencies": {
    "@tagers/shared": "workspace:*",
    "express": "^4.18.0",
    "bullmq": "^5.0.0",
    "@langchain/langgraph": "^0.0.20"
  }
}
```

---

## PASO 3: MIGRAR CÓDIGO DE KISS

### 3.1 Identificar código compartido

Revisa tu KISS actual y extrae a `packages/shared/`:

```javascript
// packages/shared/src/index.js
module.exports = {
  // Database
  db: require('./db'),
  
  // Redis
  redis: require('./redis'),
  
  // Config (Google Sheets)
  config: require('./config'),
  
  // WhatsApp
  whatsapp: require('./whatsapp'),
  
  // Chatwoot
  chatwoot: require('./chatwoot'),
  
  // Utils
  utils: require('./utils')
};
```

### 3.2 Ejemplo: Mover cliente de DB

```javascript
// packages/shared/src/db/index.js
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' 
        ? { rejectUnauthorized: false } 
        : false
    });
  }
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { getPool, query };
```

### 3.3 Actualizar imports en KISS

```javascript
// ANTES (en kiss-api)
const { query } = require('./db');
const { loadConfig } = require('./config');

// DESPUÉS
const { db, config } = require('@tagers/shared');
const { query } = db;
const { loadConfig } = config;
```

---

## PASO 4: CONFIGURAR RAILWAY

### 4.1 Entender cómo Railway maneja monorepos

Railway puede deployar subdirectorios de un monorepo. Cada servicio apunta a:
- El mismo repo
- Diferente "Root Directory"
- Diferente Dockerfile

### 4.2 Crear railway.json para cada servicio

**packages/kiss-api/railway.json**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node src/index.js",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

**packages/luca-api/railway.json**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "Dockerfile"
  },
  "deploy": {
    "startCommand": "node src/index.js",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### 4.3 Crear Dockerfile para cada servicio

**packages/kiss-api/Dockerfile**
```dockerfile
FROM node:20-alpine

# Instalar pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copiar archivos de workspace root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copiar packages
COPY packages/shared ./packages/shared
COPY packages/kiss-api ./packages/kiss-api

# Instalar dependencias
RUN pnpm install --frozen-lockfile

# Ir al directorio del servicio
WORKDIR /app/packages/kiss-api

EXPOSE 3000

CMD ["node", "src/index.js"]
```

**packages/luca-api/Dockerfile**
```dockerfile
FROM node:20-alpine

# Instalar pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copiar archivos de workspace root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copiar packages
COPY packages/shared ./packages/shared
COPY packages/luca-api ./packages/luca-api

# Instalar dependencias
RUN pnpm install --frozen-lockfile

# Ir al directorio del servicio
WORKDIR /app/packages/luca-api

EXPOSE 3001

CMD ["node", "src/index.js"]
```

---

## PASO 5: MIGRACIÓN EN RAILWAY (SIN DOWNTIME)

### 5.1 Orden de operaciones

```
1. Crear repo tagers-platform en GitHub (vacío)
2. Subir estructura monorepo con KISS migrado
3. Probar localmente que KISS funciona
4. En Railway: crear NUEVO servicio kiss-api-v2 apuntando al monorepo
5. Probar que kiss-api-v2 funciona
6. Cambiar dominio/webhook de kiss-api → kiss-api-v2
7. Verificar que todo funciona
8. Eliminar servicio kiss-api viejo
9. Renombrar kiss-api-v2 → kiss-api
```

### 5.2 Configurar nuevo servicio en Railway

**En Railway Dashboard:**

1. **Ir a tu proyecto** (donde está kiss-api actual)

2. **Click "New Service" → "GitHub Repo"**

3. **Seleccionar `tagers-platform`**

4. **Configurar:**
   ```
   Root Directory: packages/kiss-api
   Build Command: (dejar vacío, usa Dockerfile)
   Start Command: (dejar vacío, usa Dockerfile)
   ```

5. **Variables de entorno:** Copiar TODAS las variables de kiss-api actual

6. **Deploy y probar**

### 5.3 Diagrama del proceso

```
ESTADO INICIAL:
┌─────────────────────────────────────┐
│ Railway Project                      │
│                                      │
│  kiss-api ──────► tagers-kiss (repo) │
│  PostgreSQL                          │
│  Redis                               │
└─────────────────────────────────────┘

PASO 1: Agregar nuevo servicio
┌─────────────────────────────────────┐
│ Railway Project                      │
│                                      │
│  kiss-api ──────► tagers-kiss        │  ← Sigue funcionando
│  kiss-api-v2 ───► tagers-platform    │  ← Nuevo, probando
│  PostgreSQL                          │
│  Redis                               │
└─────────────────────────────────────┘

PASO 2: Cambiar tráfico
┌─────────────────────────────────────┐
│ Railway Project                      │
│                                      │
│  kiss-api ──────► tagers-kiss        │  ← Ya no recibe tráfico
│  kiss-api-v2 ───► tagers-platform    │  ← Recibe TODO el tráfico
│  PostgreSQL                          │
│  Redis                               │
└─────────────────────────────────────┘

ESTADO FINAL:
┌─────────────────────────────────────┐
│ Railway Project                      │
│                                      │
│  kiss-api ──────► tagers-platform    │  ← Renombrado
│  luca-api ──────► tagers-platform    │  ← Nuevo servicio
│  PostgreSQL                          │
│  Redis                               │
└─────────────────────────────────────┘
```

---

## PASO 6: CHECKLIST DE MIGRACIÓN

### Antes de empezar
- [ ] Backup de código actual de KISS
- [ ] Lista de todas las variables de entorno
- [ ] Documentar webhooks actuales (Chatwoot, WhatsApp)

### Crear monorepo
- [ ] Crear repo `tagers-platform` en GitHub
- [ ] Crear estructura de carpetas
- [ ] Configurar pnpm workspaces
- [ ] Crear `packages/shared` con código común
- [ ] Copiar código de KISS a `packages/kiss-api`
- [ ] Actualizar imports para usar `@tagers/shared`
- [ ] Crear Dockerfiles
- [ ] Probar localmente: `pnpm install && pnpm dev:kiss`

### Migrar en Railway
- [ ] Crear servicio `kiss-api-v2` apuntando a monorepo
- [ ] Configurar Root Directory: `packages/kiss-api`
- [ ] Copiar variables de entorno
- [ ] Deploy y verificar health check
- [ ] Probar funcionalidad (enviar mensaje de prueba)
- [ ] Cambiar webhook de Chatwoot al nuevo servicio
- [ ] Cambiar webhook de WhatsApp al nuevo servicio
- [ ] Verificar que todo funciona
- [ ] Eliminar servicio viejo
- [ ] Renombrar servicio

### Agregar LUCA
- [ ] Crear `packages/luca-api` con código inicial
- [ ] Crear servicio `luca-api` en Railway
- [ ] Configurar Root Directory: `packages/luca-api`
- [ ] Agregar variables de entorno
- [ ] Deploy

---

## COMANDOS ÚTILES

### Desarrollo local

```bash
# Instalar dependencias de todo el monorepo
pnpm install

# Correr KISS en desarrollo
pnpm dev:kiss

# Correr LUCA en desarrollo
pnpm dev:luca

# Correr ambos
pnpm dev:kiss & pnpm dev:luca

# Agregar dependencia a un package específico
pnpm --filter kiss-api add express

# Agregar dependencia al shared
pnpm --filter @tagers/shared add axios
```

### Docker local (para probar antes de Railway)

```bash
# Desde la raíz del monorepo
docker build -f packages/kiss-api/Dockerfile -t kiss-api .
docker run -p 3000:3000 --env-file .env kiss-api

docker build -f packages/luca-api/Dockerfile -t luca-api .
docker run -p 3001:3001 --env-file .env luca-api
```

---

## TROUBLESHOOTING

### Error: Cannot find module '@tagers/shared'

**Causa:** pnpm no instaló las dependencias del workspace correctamente.

**Solución:**
```bash
rm -rf node_modules packages/*/node_modules
pnpm install
```

### Error en Railway: Dockerfile not found

**Causa:** Root Directory mal configurado.

**Solución:** 
- Root Directory debe ser `packages/kiss-api` (sin slash al inicio)
- El Dockerfile debe estar en `packages/kiss-api/Dockerfile`

### Error: COPY failed: file not found

**Causa:** El Dockerfile intenta copiar desde rutas relativas al subdirectorio.

**Solución:** El Dockerfile debe copiar desde la raíz del repo porque Railway hace build desde la raíz aunque configures Root Directory.

```dockerfile
# INCORRECTO
COPY package.json ./

# CORRECTO (copia desde raíz del repo)
COPY packages/kiss-api/package.json ./
```

**PERO** si usas el Dockerfile que te di arriba, funciona porque:
1. Railway clona todo el repo
2. El COPY funciona desde la raíz
3. El WORKDIR cambia al subdirectorio para el CMD

---

## SIGUIENTE PASO

¿Quieres que empecemos la migración ahora? Necesitaría:

1. Ver la estructura actual de tu repo KISS
2. Identificar qué código mover a shared
3. Crear el monorepo completo

Dame acceso o pega la estructura de tu repo KISS actual.
