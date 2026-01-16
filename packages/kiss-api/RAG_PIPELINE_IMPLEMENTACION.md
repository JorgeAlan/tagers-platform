# 📋 RAG Pipeline - Resumen de Implementación

## ✅ Estado: COMPLETADO

El pipeline de ingesta RAG está **listo para producción**. pgvector ya estaba configurado; ahora el sistema permite indexar documentos propios vía HTTP.

---

## 📁 Archivos Creados/Actualizados

### Nuevos
| Archivo | Tamaño | Descripción |
|---------|--------|-------------|
| `src/rag/routes.js` | 14KB | API HTTP para ingesta y búsqueda |
| `scripts/test-rag-pipeline.js` | 8KB | Script de pruebas automatizadas |

### Actualizados
| Archivo | Cambio |
|---------|--------|
| `src/rag/index.js` | Exporta `ragRoutes` |
| `src/server.js` | Monta rutas en `/rag` |

### Ya Existían (sin cambios)
| Archivo | Función |
|---------|---------|
| `src/rag/documentLoader.js` | Carga PDF, DOCX, TXT, MD, JSON, HTML, URL |
| `src/rag/chunker.js` | Divide en chunks (semantic, paragraph, sentence, fixed) |
| `src/rag/ingestPipeline.js` | Orquesta el flujo completo |
| `src/rag/agentHelper.js` | Integración con Tan•IA |

---

## 🌐 Endpoints Disponibles

### Ingesta (requieren `X-API-Key`)
```
POST /rag/ingest/file      → Subir archivos (multipart)
POST /rag/ingest/url       → Indexar desde URL
POST /rag/ingest/text      → Indexar texto directo
POST /rag/ingest/directory → Indexar directorio completo
```

### Búsqueda (públicos)
```
GET  /rag/search?q=...     → Buscar documentos
POST /rag/search           → Búsqueda con body
GET  /rag/context?q=...    → Contexto para AI
```

### Admin (requieren `X-API-Key`)
```
GET    /rag/stats          → Estadísticas
GET    /rag/health         → Health check
DELETE /rag/reindex/:src   → Re-indexar fuente
GET    /rag/categories     → Listar categorías
POST   /rag/init           → Inicializar directorios
```

---

## 🔧 Variables de Entorno Requeridas

```bash
# Ya configuradas (pgvector)
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...

# Agregar para admin
ADMIN_API_KEY=tu-clave-segura

# Opcionales
RAG_PIPELINE_ENABLED=true
RAG_DOCUMENTS_DIR=./documents
RAG_MAX_FILE_SIZE=52428800
```

---

## 🚀 Uso Rápido

### 1. Subir documento PDF
```bash
curl -X POST https://tu-api.railway.app/rag/ingest/file \
  -H "X-API-Key: tu-clave" \
  -F "file=@menu-tagers.pdf" \
  -F "title=Menú 2025" \
  -F "category=menu"
```

### 2. Buscar
```bash
curl "https://tu-api.railway.app/rag/search?q=precios%20de%20roscas"
```

### 3. Obtener contexto para AI
```bash
curl "https://tu-api.railway.app/rag/context?q=política%20devoluciones"
```

---

## 📊 Categorías y TTL

| Categoría | TTL | Uso |
|-----------|-----|-----|
| menu | 7 días | Productos, precios |
| policy | 30 días | Políticas, procedimientos |
| recipe | 90 días | Recetas, ingredientes |
| history | ∞ | Historia de marca |
| faq | 7 días | Preguntas frecuentes |
| training | 14 días | Capacitación |
| promo | 1 día | Promociones |
| general | 7 días | Todo lo demás |

---

## 🧪 Probar Localmente

```bash
cd tagers-kiss-api-main
node scripts/test-rag-pipeline.js
```

---

## 📝 Siguiente Paso Recomendado

1. **Configurar `ADMIN_API_KEY`** en Railway
2. **Subir documentos iniciales**:
   - Menú actualizado
   - Políticas de la empresa
   - FAQ compilado
   - Historia de Tagers
3. **Verificar búsquedas** funcionan correctamente
4. **Monitorear** `/rag/stats` para ver uso

---

## 🔗 Documentación Completa

Ver: `docs/RAG_PIPELINE.md`
