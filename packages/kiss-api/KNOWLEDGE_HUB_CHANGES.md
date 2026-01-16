# 🔄 CAMBIOS REALIZADOS - Knowledge Hub Integration

## Resumen

Se eliminó el hardcoding de sucursales, productos y mensajes. Ahora todo viene de:
1. **Google Sheets** (TAN_IA_KNOWLEDGE_BASE_TEMPLATE)
2. **WooCommerce API** (productos en tiempo real)

---

## 📁 ARCHIVOS NUEVOS CREADOS

### `src/knowledge-hub/index.js`
Módulo principal que:
- Inicializa y sincroniza la configuración
- Re-exporta todas las funciones de matchers
- Maneja auto-refresh cada 5 minutos

### `src/knowledge-hub/sheet-loader.js`
Lee el formato TAN_IA_KNOWLEDGE_BASE_TEMPLATE:
- KNOWLEDGE_FEED → Reglas, políticas, FAQs
- PRODUCTS → Productos con fuzzy_keywords
- BRANCHES → Sucursales con synonyms
- AGENT_CONFIG → Personalidad del agente
- TOOLS → Herramientas disponibles
- CANNED → Mensajes predefinidos

### `src/knowledge-hub/matchers.js`
Funciones de matching dinámico:
- `extractBranchHint(text)` → Detecta sucursal
- `extractProductHint(text)` → Detecta producto
- `getCannedMessage(key, vars)` → Obtiene mensaje con variables
- `getProductListForCustomer()` → Lista de productos
- `getBranchesPromptSection()` → Sección para LLM

---

## 📝 ARCHIVOS MODIFICADOS

### `src/server.js`
```diff
+ import KnowledgeHub from "./knowledge-hub/index.js";

// Después de Config Hub init:
+ await KnowledgeHub.initialize({
+   autoSync: true,
+   syncIntervalMs: configSyncInterval * 60 * 1000,
+ });
```

### `src/tools/intent_extractor.js`
```diff
+ import KnowledgeHub from "../knowledge-hub/index.js";

// extractBranchHint ahora usa:
+ const result = KnowledgeHub.extractBranchHint(text);

// extractProductHint ahora usa:
+ const result = KnowledgeHub.extractProductHint(text);

// Prompt de sucursales generado dinámicamente:
+ const branchesSection = KnowledgeHub.getBranchesPromptSection();
```

### `src/flows/orderCreateFlow.js`
```diff
+ import KnowledgeHub from "../knowledge-hub/index.js";

// Lista de productos dinámica:
- message: "1. Rosca Clásica\n2. Rosca de Nutella..."
+ message: KnowledgeHub.getProductListForCustomer('roscas')

// matchProduct usa Knowledge Hub:
+ const products = KnowledgeHub.getAllProducts();

// matchBranch usa Knowledge Hub:
+ const branches = KnowledgeHub.getAllBranches();
```

### `src/services/aiOrchestrator.js`
```diff
+ import KnowledgeHub from "../knowledge-hub/index.js";

// Saludo dinámico:
- message: "¡Hola! Soy Ana de Tagers..."
+ message: KnowledgeHub.getCannedMessage('greeting', {
+   agent_name: KnowledgeHub.getAgentName(),
+   brand_name: KnowledgeHub.getBrandName()
+ })
```

---

## 🔌 CÓMO FUNCIONA

### Startup
```
server.js
  ├── initConfigTables()           # PostgreSQL
  ├── startPeriodicSync()          # Config Hub existente
  └── KnowledgeHub.initialize()    # NUEVO
        ├── loadKnowledgeBase()    # Lee Google Sheets
        └── syncWooProducts()      # Lee WooCommerce
```

### Runtime
```
Usuario: "quiero en angelopolis"
    │
    ▼
extractBranchHint(text)
    │
    ▼
KnowledgeHub.extractBranch(text)
    │
    ▼
Busca en config.branches[].synonyms
    │
    ▼
Return: { branch_id: "ANGELOPOLIS", name: "Tagers Angelópolis" }
```

---

## 📊 ANTES vs DESPUÉS

| Componente | Antes | Después |
|------------|-------|---------|
| Sucursales | 6 regex hardcodeados | Google Sheets BRANCHES |
| Productos | 4 regex hardcodeados | Google Sheets PRODUCTS + WooCommerce |
| Mensajes | 20+ strings hardcodeados | Google Sheets CANNED |
| Lista de roscas | Array hardcodeado | `getProductListForCustomer()` |
| Matching | Regex estáticos | `fuzzy_keywords` dinámicos |

---

## ⚙️ CONFIGURACIÓN REQUERIDA

### Variables de entorno
```env
# Google Sheets (ya existente)
GOOGLE_SHEET_ID=tu_sheet_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...

# WooCommerce (ya existente)
WP_BASE_URL=https://tagers.mx
WP_CS_TOKEN=...
```

### Google Sheet requerido
El sheet debe tener las pestañas:
- KNOWLEDGE_FEED
- PRODUCTS (con columna `fuzzy_keywords`)
- BRANCHES (con columna `synonyms`)
- AGENT_CONFIG
- TOOLS
- CANNED

---

## 🧪 TESTING

```bash
# Verificar sintaxis
node --check src/knowledge-hub/index.js
node --check src/tools/intent_extractor.js
node --check src/flows/orderCreateFlow.js
node --check src/services/aiOrchestrator.js

# Verificar que carga config
node -e "import('./src/knowledge-hub/index.js').then(m => m.initialize().then(r => console.log(r)))"
```

---

## 🎯 BENEFICIOS

1. **Nueva sucursal** → Agregar fila en Sheet (no deploy)
2. **Nuevo producto** → Agregar en WooCommerce (automático)
3. **Cambiar mensaje** → Editar en Sheet (sin código)
4. **Temporada diferente** → Actualizar KNOWLEDGE_FEED
5. **A/B testing** → Cambiar AGENT_CONFIG
