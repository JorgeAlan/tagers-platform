/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DOCUMENT LOADER - Carga y extrae texto de diferentes formatos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Soporta:
 * - PDF (con pdfjs-dist o pdf-parse)
 * - TXT / MD (texto plano)
 * - DOCX (con mammoth)
 * - JSON (estructurado)
 * - HTML (con cheerio)
 * - URL (fetch + extracción)
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const loaderConfig = {
  maxFileSizeBytes: parseInt(process.env.RAG_MAX_FILE_SIZE || String(50 * 1024 * 1024), 10), // 50MB
  supportedExtensions: [".pdf", ".txt", ".md", ".docx", ".json", ".html", ".htm"],
  timeoutMs: parseInt(process.env.RAG_LOADER_TIMEOUT_MS || "60000", 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// LOADERS INDIVIDUALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Carga archivo de texto plano (TXT, MD)
 */
async function loadTextFile(filePath) {
  const content = await fs.readFile(filePath, "utf-8");
  return {
    content: content.trim(),
    metadata: {
      format: "text",
      extension: path.extname(filePath).toLowerCase(),
      encoding: "utf-8",
    },
  };
}

/**
 * Carga archivo JSON estructurado
 * Convierte a texto para embedding
 */
async function loadJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  const data = JSON.parse(raw);
  
  // Convertir JSON a texto legible
  const content = jsonToText(data);
  
  return {
    content,
    metadata: {
      format: "json",
      structure: summarizeJsonStructure(data),
    },
    structured: data, // Mantener datos originales
  };
}

/**
 * Convierte objeto JSON a texto plano para embedding
 */
function jsonToText(obj, prefix = "") {
  const lines = [];
  
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      if (typeof item === "object" && item !== null) {
        lines.push(jsonToText(item, `${prefix}[${idx}]`));
      } else {
        lines.push(`${prefix}[${idx}]: ${item}`);
      }
    });
  } else if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const newPrefix = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "object" && value !== null) {
        lines.push(jsonToText(value, newPrefix));
      } else {
        lines.push(`${newPrefix}: ${value}`);
      }
    }
  } else {
    lines.push(`${prefix}: ${obj}`);
  }
  
  return lines.filter(Boolean).join("\n");
}

/**
 * Resume estructura de JSON para metadata
 */
function summarizeJsonStructure(obj) {
  if (Array.isArray(obj)) {
    return `array[${obj.length}]`;
  }
  if (typeof obj === "object" && obj !== null) {
    return Object.keys(obj).slice(0, 10).join(", ");
  }
  return typeof obj;
}

/**
 * Carga archivo PDF
 * Usa pdf-parse si está disponible
 */
async function loadPdfFile(filePath) {
  try {
    // Intentar importar pdf-parse dinámicamente
    const pdfParse = (await import("pdf-parse")).default;
    const dataBuffer = await fs.readFile(filePath);
    const data = await pdfParse(dataBuffer);
    
    return {
      content: data.text.trim(),
      metadata: {
        format: "pdf",
        pages: data.numpages,
        info: data.info,
      },
    };
  } catch (err) {
    // Fallback: usar pdftotext de poppler si está disponible
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(`pdftotext -layout "${filePath}" -`, {
        timeout: loaderConfig.timeoutMs,
        maxBuffer: loaderConfig.maxFileSizeBytes,
      });
      
      return {
        content: stdout.trim(),
        metadata: {
          format: "pdf",
          extraction: "pdftotext",
        },
      };
    } catch (fallbackErr) {
      logger.error({ err: err.message, fallback: fallbackErr.message }, "PDF loading failed");
      throw new Error(`Cannot load PDF: ${err.message}. Install pdf-parse or poppler-utils.`);
    }
  }
}

/**
 * Carga archivo DOCX
 * Usa mammoth para extracción de texto
 */
async function loadDocxFile(filePath) {
  try {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ path: filePath });
    
    return {
      content: result.value.trim(),
      metadata: {
        format: "docx",
        messages: result.messages,
      },
    };
  } catch (err) {
    // Fallback: usar pandoc si está disponible
    try {
      const { exec } = await import("child_process");
      const { promisify } = await import("util");
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(`pandoc -f docx -t plain "${filePath}"`, {
        timeout: loaderConfig.timeoutMs,
        maxBuffer: loaderConfig.maxFileSizeBytes,
      });
      
      return {
        content: stdout.trim(),
        metadata: {
          format: "docx",
          extraction: "pandoc",
        },
      };
    } catch (fallbackErr) {
      logger.error({ err: err.message, fallback: fallbackErr.message }, "DOCX loading failed");
      throw new Error(`Cannot load DOCX: ${err.message}. Install mammoth or pandoc.`);
    }
  }
}

/**
 * Carga archivo HTML
 * Extrae texto limpio sin tags
 */
async function loadHtmlFile(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return loadHtmlContent(raw);
}

/**
 * Extrae texto de contenido HTML
 */
function loadHtmlContent(html) {
  // Remover scripts, styles, comments
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ") // Remover tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  
  // Extraer título si existe
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : null;
  
  return {
    content: text,
    metadata: {
      format: "html",
      title,
    },
  };
}

/**
 * Carga contenido desde URL
 */
async function loadFromUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), loaderConfig.timeoutMs);
  
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TagersKissAPI-RAG/1.0",
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    
    if (contentType.includes("application/json")) {
      const data = JSON.parse(text);
      return {
        content: jsonToText(data),
        metadata: {
          format: "json",
          source: "url",
          url,
        },
        structured: data,
      };
    }
    
    if (contentType.includes("text/html")) {
      const result = loadHtmlContent(text);
      result.metadata.source = "url";
      result.metadata.url = url;
      return result;
    }
    
    // Texto plano
    return {
      content: text.trim(),
      metadata: {
        format: "text",
        source: "url",
        url,
        contentType,
      },
    };
    
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Carga un documento desde archivo o URL
 * 
 * @param {string} source - Path del archivo o URL
 * @param {Object} options
 * @param {string} [options.title] - Título del documento
 * @param {string} [options.category] - Categoría (menu, policy, recipe, history)
 * @param {Object} [options.metadata] - Metadata adicional
 * @returns {Promise<{content: string, metadata: Object}>}
 */
export async function loadDocument(source, options = {}) {
  const startTime = Date.now();
  
  // Detectar si es URL
  if (source.startsWith("http://") || source.startsWith("https://")) {
    logger.info({ url: source }, "Loading document from URL");
    const result = await loadFromUrl(source);
    result.metadata = { ...result.metadata, ...options.metadata };
    if (options.title) result.metadata.title = options.title;
    if (options.category) result.metadata.category = options.category;
    return result;
  }
  
  // Es archivo local
  const filePath = path.resolve(source);
  const ext = path.extname(filePath).toLowerCase();
  
  // Validar extensión
  if (!loaderConfig.supportedExtensions.includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext}. Supported: ${loaderConfig.supportedExtensions.join(", ")}`);
  }
  
  // Validar tamaño
  const stats = await fs.stat(filePath);
  if (stats.size > loaderConfig.maxFileSizeBytes) {
    throw new Error(`File too large: ${(stats.size / 1024 / 1024).toFixed(2)}MB. Max: ${loaderConfig.maxFileSizeBytes / 1024 / 1024}MB`);
  }
  
  // Cargar según tipo
  let result;
  
  switch (ext) {
    case ".txt":
    case ".md":
      result = await loadTextFile(filePath);
      break;
    case ".json":
      result = await loadJsonFile(filePath);
      break;
    case ".pdf":
      result = await loadPdfFile(filePath);
      break;
    case ".docx":
      result = await loadDocxFile(filePath);
      break;
    case ".html":
    case ".htm":
      result = await loadHtmlFile(filePath);
      break;
    default:
      throw new Error(`No loader for extension: ${ext}`);
  }
  
  // Agregar metadata común
  result.metadata = {
    ...result.metadata,
    ...options.metadata,
    fileName: path.basename(filePath),
    filePath,
    fileSize: stats.size,
    loadedAt: new Date().toISOString(),
    loadTimeMs: Date.now() - startTime,
  };
  
  if (options.title) result.metadata.title = options.title;
  if (options.category) result.metadata.category = options.category;
  
  // Generar hash del contenido
  result.contentHash = crypto
    .createHash("sha256")
    .update(result.content)
    .digest("hex")
    .substring(0, 16);
  
  logger.info({
    source: path.basename(filePath),
    format: result.metadata.format,
    contentLength: result.content.length,
    loadTimeMs: result.metadata.loadTimeMs,
  }, "Document loaded");
  
  return result;
}

/**
 * Carga múltiples documentos de un directorio
 * 
 * @param {string} dirPath - Path del directorio
 * @param {Object} options
 * @param {boolean} [options.recursive=false] - Buscar en subdirectorios
 * @param {string} [options.category] - Categoría para todos los documentos
 */
export async function loadDirectory(dirPath, options = {}) {
  const { recursive = false, category } = options;
  const results = [];
  const errors = [];
  
  async function processDir(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory() && recursive) {
        await processDir(fullPath);
        continue;
      }
      
      if (!entry.isFile()) continue;
      
      const ext = path.extname(entry.name).toLowerCase();
      if (!loaderConfig.supportedExtensions.includes(ext)) continue;
      
      try {
        const doc = await loadDocument(fullPath, { category });
        results.push(doc);
      } catch (err) {
        errors.push({
          file: fullPath,
          error: err.message,
        });
        logger.warn({ file: fullPath, err: err.message }, "Failed to load document");
      }
    }
  }
  
  await processDir(path.resolve(dirPath));
  
  logger.info({
    directory: dirPath,
    loaded: results.length,
    errors: errors.length,
  }, "Directory loaded");
  
  return { documents: results, errors };
}

/**
 * Carga documento desde buffer (para uploads)
 * 
 * @param {Buffer} buffer - Contenido del archivo
 * @param {string} fileName - Nombre del archivo (para detectar tipo)
 * @param {Object} options
 */
export async function loadFromBuffer(buffer, fileName, options = {}) {
  const ext = path.extname(fileName).toLowerCase();
  const tempDir = process.env.TEMP_DIR || "/tmp";
  const tempPath = path.join(tempDir, `rag-upload-${Date.now()}-${fileName}`);
  
  try {
    // Escribir a archivo temporal
    await fs.writeFile(tempPath, buffer);
    
    // Cargar usando loader normal
    const result = await loadDocument(tempPath, options);
    result.metadata.originalFileName = fileName;
    result.metadata.uploadedAt = new Date().toISOString();
    
    return result;
    
  } finally {
    // Limpiar archivo temporal
    try {
      await fs.unlink(tempPath);
    } catch (_) {
      // Ignorar error de limpieza
    }
  }
}

/**
 * Obtiene configuración del loader
 */
export function getLoaderConfig() {
  return { ...loaderConfig };
}

/**
 * Verifica si un archivo es soportado
 */
export function isSupported(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return loaderConfig.supportedExtensions.includes(ext);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const documentLoader = {
  loadDocument,
  loadDirectory,
  loadFromBuffer,
  loadFromUrl,
  getConfig: getLoaderConfig,
  isSupported,
  supportedExtensions: loaderConfig.supportedExtensions,
};

export default documentLoader;
