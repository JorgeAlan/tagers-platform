/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VECTOR MODULE - Índice Principal
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Exporta todas las funcionalidades del sistema de vectores:
 * - vectorStore: Base de datos vectorial con pgvector
 * - embeddings: Generación de embeddings con OpenAI
 * - semanticMatchers: Búsqueda semántica de productos, sucursales, FAQs
 * - vectorPopulator: Sincronización desde Config Hub y WooCommerce
 * 
 * @version 1.0.0
 */

// Core
export * from "./vectorStore.js";
export * from "./embeddings.js";

// Matchers
export * from "./semanticMatchers.js";

// Population
export * from "./vectorPopulator.js";

// Default exports
export { vectorStore, default as default } from "./vectorStore.js";
export { embeddings } from "./embeddings.js";
export { semanticMatchers } from "./semanticMatchers.js";
export { vectorPopulator } from "./vectorPopulator.js";
