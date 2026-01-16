/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RAG MODULE INDEX - Exportaciones del módulo de Retrieval Augmented Generation
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El módulo RAG permite:
 * 
 * 1. CARGAR documentos de múltiples formatos (PDF, DOCX, TXT, MD, JSON, HTML, URL)
 * 2. DIVIDIR en chunks óptimos para embeddings
 * 3. GENERAR embeddings con OpenAI text-embedding-3-small
 * 4. ALMACENAR en pgvector para búsqueda semántica
 * 5. BUSCAR documentos relevantes para enriquecer respuestas del agente
 * 
 * Uso básico:
 * ```javascript
 * import { ragPipeline } from './rag/index.js';
 * 
 * // Ingestar documento
 * await ragPipeline.ingest('./docs/menu.pdf', { category: 'menu' });
 * 
 * // Buscar documentos relevantes
 * const results = await ragPipeline.search('¿Tienen pan sin gluten?');
 * 
 * // Generar contexto para el agente
 * const context = await ragPipeline.generateContext('precios de roscas');
 * ```
 * 
 * @version 1.0.0
 */

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

// Document Loader
export { 
  documentLoader,
  loadDocument,
  loadDirectory,
  loadFromBuffer,
} from "./documentLoader.js";

// Chunker
export {
  chunker,
  chunkDocument,
  estimateTokens,
  isValidChunkSize,
} from "./chunker.js";

// Pipeline principal
export {
  ragPipeline,
  ingestDocument,
  ingestBatch,
  ingestDirectory,
  searchDocuments,
  generateRAGContext,
  getPipelineStats,
  getHealthStatus,
  getPipelineConfig,
  reindexSource,
  initPipeline,
} from "./ingestPipeline.js";

// Agent Helper (integración con Tan•IA)
export {
  ragAgentHelper,
  enrichPromptWithRAG,
  generateSystemPromptWithRAG,
  shouldUseRAG,
  detectRelevantCategories,
} from "./agentHelper.js";

// AI Enhancer (chunking inteligente, resúmenes, extracción de entidades)
export {
  default as aiEnhancer,
  enhanceDocument,
  intelligentChunk,
  generateSummary,
  extractEntities,
  isEnhancerReady,
  getEnhancerConfig,
  setConfigHub,
} from "./aiEnhancer.js";

// HTTP Routes
export { default as ragRoutes } from "./routes.js";

// Default export
import { ragPipeline } from "./ingestPipeline.js";
export default ragPipeline;
