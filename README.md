# 🏢 Tagers Platform

Monorepo con todos los servicios de Tagers.

## Estructura

```
tagers-platform/
├── packages/
│   ├── shared/           # Código compartido
│   │   ├── db/          # PostgreSQL client
│   │   ├── redis/       # Redis client
│   │   ├── config/      # Configuración base
│   │   ├── utils/       # Logger, helpers
│   │   └── integrations/# Chatwoot, WhatsApp
│   │
│   ├── kiss-api/         # Customer Service Bot
│   │   └── (código actual)
│   │
│   ├── luca-api/         # Operational Intelligence
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Business logic
│   │   ├── detectors/   # Anomaly detection
│   │   └── db/          # Migrations
│   │
│   └── tower/            # Control Tower PWA (coming)
│
├── package.json          # Workspace root
├── pnpm-workspace.yaml   # pnpm config
└── turbo.json           # Turborepo config
```

## Quick Start

### Requisitos
- Node.js 20+
- pnpm 8+

### Instalación

```bash
# Instalar pnpm si no lo tienes
npm install -g pnpm

# Instalar dependencias de todo el monorepo
pnpm install

# Configurar variables de entorno
cp packages/kiss-api/.env.example packages/kiss-api/.env
cp packages/luca-api/.env.example packages/luca-api/.env
# Editar los .env con tus valores
```

### Desarrollo

```bash
# Correr KISS en modo desarrollo
pnpm dev:kiss

# Correr LUCA en modo desarrollo
pnpm dev:luca

# Correr ambos en paralelo
pnpm dev:all
```

### Migraciones

```bash
# Correr migraciones de LUCA
pnpm db:migrate
```

## Servicios

### KISS API (kiss-api)
- **Puerto:** 8787
- **Propósito:** Bot de atención al cliente
- **Canales:** WhatsApp, Instagram, Messenger via Chatwoot

### LUCA API (luca-api)
- **Puerto:** 3001
- **Propósito:** Inteligencia operativa
- **Funciones:** Detección de anomalías, casos, alertas, briefings

### Control Tower (tower) - Coming Soon
- **Puerto:** 3002
- **Propósito:** Dashboard para socios
- **Stack:** Next.js 14 + Tailwind + shadcn/ui

## Deploy en Railway

Cada servicio se despliega como un servicio separado en Railway, apuntando al mismo repo pero con diferente Root Directory:

| Servicio | Root Directory | Puerto |
|----------|----------------|--------|
| kiss-api | `packages/kiss-api` | 8787 |
| luca-api | `packages/luca-api` | 3001 |
| tower | `packages/tower` | 3002 |

### Pasos para migrar desde repo separado:

1. **Crear servicio nuevo** apuntando a este repo
2. **Configurar Root Directory** (ej: `packages/kiss-api`)
3. **Copiar variables de entorno** del servicio viejo
4. **Probar** que funciona
5. **Cambiar webhooks** al nuevo servicio
6. **Eliminar servicio viejo**

## Variables de Entorno Compartidas

Estas variables son usadas por múltiples servicios:

```env
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# OpenAI
OPENAI_API_KEY=sk-...

# Chatwoot
CHATWOOT_ENABLED=true
CHATWOOT_BASE_URL=https://...
CHATWOOT_API_ACCESS_TOKEN=...
CHATWOOT_ACCOUNT_ID=...

# WhatsApp
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...

# LangSmith
LANGSMITH_ENABLED=true
LANGSMITH_API_KEY=...
LANGSMITH_PROJECT=tagers-platform
```

## Comandos Útiles

```bash
# Agregar dependencia a un paquete específico
pnpm --filter kiss-api add express

# Agregar dependencia al shared
pnpm --filter @tagers/shared add axios

# Actualizar todas las dependencias
pnpm update -r

# Limpiar node_modules
rm -rf node_modules packages/*/node_modules
pnpm install
```

## Documentación

- [LUCA Roadmap](docs/LUCA_ROADMAP.md)
- [Migración a Monorepo](docs/MIGRACION_MONOREPO.md)
- [Context Pack](docs/LUCA_CONTEXT_PACK.md)
