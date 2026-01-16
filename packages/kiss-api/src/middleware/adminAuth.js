/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN AUTH MIDDLEWARE - Protección de Endpoints Administrativos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Protege endpoints sensibles como:
 * - /chatwoot/cache/clear
 * - /chatwoot/queue/pause
 * - /health/models/reset
 * - /internal/config/*
 * 
 * Métodos de autenticación soportados:
 * 1. Header: X-Admin-Token
 * 2. Query param: ?admin_token=xxx
 * 3. Bearer token: Authorization: Bearer xxx
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || process.env.TAGERS_ADMIN_TOKEN || "";

// En desarrollo sin token configurado, advertir pero permitir
const DEV_MODE = !ADMIN_TOKEN && process.env.NODE_ENV !== "production";

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Comparación timing-safe
// ═══════════════════════════════════════════════════════════════════════════

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) {
    // Evitar timing attack por longitud comparando con string dummy
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Middleware de autenticación admin
 * 
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function adminAuthMiddleware(req, res, next) {
  // En modo desarrollo sin token, advertir y permitir
  if (DEV_MODE) {
    logger.warn({
      path: req.path,
      method: req.method,
    }, "Admin endpoint accessed without auth (DEV MODE)");
    return next();
  }
  
  // Si no hay token configurado en producción, denegar todo
  if (!ADMIN_TOKEN) {
    logger.error({ path: req.path }, "Admin endpoint accessed but ADMIN_API_TOKEN not configured");
    return res.status(503).json({
      ok: false,
      error: "ADMIN_AUTH_NOT_CONFIGURED",
      message: "Admin authentication is not configured. Set ADMIN_API_TOKEN environment variable.",
    });
  }
  
  // Extraer token de múltiples fuentes
  const tokenFromHeader = req.header("X-Admin-Token") || "";
  const tokenFromQuery = String(req.query.admin_token || "");
  const authHeader = req.header("Authorization") || "";
  const tokenFromBearer = authHeader.startsWith("Bearer ") 
    ? authHeader.slice(7).trim() 
    : "";
  
  // Usar el primer token encontrado
  const providedToken = tokenFromHeader || tokenFromQuery || tokenFromBearer;
  
  if (!providedToken) {
    logger.warn({
      path: req.path,
      method: req.method,
      ip: req.ip,
    }, "Admin endpoint accessed without token");
    
    return res.status(401).json({
      ok: false,
      error: "MISSING_ADMIN_TOKEN",
      message: "Admin authentication required. Provide X-Admin-Token header.",
    });
  }
  
  // Validar token
  if (!timingSafeEqual(providedToken, ADMIN_TOKEN)) {
    logger.warn({
      path: req.path,
      method: req.method,
      ip: req.ip,
    }, "Admin endpoint accessed with invalid token");
    
    return res.status(403).json({
      ok: false,
      error: "INVALID_ADMIN_TOKEN",
      message: "Invalid admin token.",
    });
  }
  
  // Token válido
  logger.info({
    path: req.path,
    method: req.method,
  }, "Admin endpoint accessed with valid token");
  
  next();
}

/**
 * Middleware opcional que solo loguea si no hay auth
 * Útil para endpoints que quieres monitorear pero no bloquear
 */
export function adminAuthOptional(req, res, next) {
  const tokenFromHeader = req.header("X-Admin-Token") || "";
  const tokenFromQuery = String(req.query.admin_token || "");
  
  const providedToken = tokenFromHeader || tokenFromQuery;
  
  if (!providedToken || !timingSafeEqual(providedToken, ADMIN_TOKEN || "")) {
    logger.info({
      path: req.path,
      method: req.method,
      authenticated: false,
    }, "Admin endpoint accessed without valid auth");
  }
  
  next();
}

/**
 * Verifica si el request tiene autenticación admin válida
 */
export function isAdminAuthenticated(req) {
  if (!ADMIN_TOKEN) return false;
  
  const tokenFromHeader = req.header("X-Admin-Token") || "";
  const tokenFromQuery = String(req.query.admin_token || "");
  const authHeader = req.header("Authorization") || "";
  const tokenFromBearer = authHeader.startsWith("Bearer ") 
    ? authHeader.slice(7).trim() 
    : "";
  
  const providedToken = tokenFromHeader || tokenFromQuery || tokenFromBearer;
  
  return providedToken && timingSafeEqual(providedToken, ADMIN_TOKEN);
}

export default adminAuthMiddleware;
