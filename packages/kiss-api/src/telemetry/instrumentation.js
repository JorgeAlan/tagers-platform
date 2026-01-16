/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPENTELEMETRY INSTRUMENTATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * CRITICAL: This file MUST be imported FIRST before any other imports
 * to ensure auto-instrumentation works correctly.
 * 
 * Usage in server.js:
 *   import { initTelemetry, shutdownTelemetry } from "./telemetry/instrumentation.js";
 *   initTelemetry(); // FIRST LINE
 *   import express from "express"; // Then other imports
 * 
 * Environment Variables:
 *   OTEL_ENABLED=true                              - Enable tracing
 *   OTEL_SERVICE_NAME=tagers-kiss-api              - Service name
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://host:4318   - OTLP endpoint
 *   OTEL_EXPORTER_OTLP_HEADERS=key=value           - Auth headers
 *   OTEL_SAMPLE_RATE=1.0                           - Sample rate (0.0-1.0)
 *   OTEL_CONSOLE_EXPORTER=true                     - Dev: print to console
 * 
 * @version 1.0.0
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { Resource } from "@opentelemetry/resources";
// ESM/CommonJS compatibility fix for semantic-conventions
import semconv from "@opentelemetry/semantic-conventions";
const { 
  ATTR_SERVICE_NAME = "service.name",
  ATTR_SERVICE_VERSION = "service.version",
  ATTR_DEPLOYMENT_ENVIRONMENT = "deployment.environment",
} = semconv;
import { ConsoleSpanExporter, BatchSpanProcessor, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const config = {
  enabled: process.env.OTEL_ENABLED === "true",
  serviceName: process.env.OTEL_SERVICE_NAME || "tagers-kiss-api",
  serviceVersion: process.env.npm_package_version || "5.5.0",
  environment: process.env.NODE_ENV || "development",
  otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318",
  otlpHeaders: parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS || ""),
  sampleRate: parseFloat(process.env.OTEL_SAMPLE_RATE || "1.0"),
  logLevel: process.env.OTEL_LOG_LEVEL || "info",
  useConsoleExporter: process.env.OTEL_CONSOLE_EXPORTER === "true",
  metricExportIntervalMs: parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL_MS || "30000", 10),
};

function parseHeaders(str) {
  if (!str) return {};
  const headers = {};
  str.split(",").forEach(pair => {
    const [key, value] = pair.split("=");
    if (key && value) headers[key.trim()] = value.trim();
  });
  return headers;
}

// ═══════════════════════════════════════════════════════════════════════════
// SDK INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

let sdk = null;
let initialized = false;

/**
 * Initialize OpenTelemetry SDK
 * Call this BEFORE any other imports in server.js
 */
export function initTelemetry() {
  if (initialized) {
    console.log("[OTEL] Already initialized, skipping");
    return;
  }
  
  if (!config.enabled) {
    console.log("[OTEL] Disabled (OTEL_ENABLED != true)");
    initialized = true;
    return;
  }
  
  try {
    // Set diagnostic logger based on config
    const logLevelMap = {
      debug: DiagLogLevel.DEBUG,
      verbose: DiagLogLevel.VERBOSE,
      info: DiagLogLevel.INFO,
      warn: DiagLogLevel.WARN,
      error: DiagLogLevel.ERROR,
      none: DiagLogLevel.NONE,
    };
    diag.setLogger(new DiagConsoleLogger(), logLevelMap[config.logLevel] || DiagLogLevel.INFO);
    
    // Resource identifies this service
    const resource = new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      [ATTR_DEPLOYMENT_ENVIRONMENT]: config.environment,
      "service.instance.id": process.env.RAILWAY_REPLICA_ID || process.env.HOSTNAME || "local",
    });
    
    // Configure exporters
    const spanProcessors = [];
    
    // OTLP exporter for production (Jaeger, Grafana Tempo, Honeycomb, etc.)
    if (config.otlpEndpoint) {
      const traceExporter = new OTLPTraceExporter({
        url: `${config.otlpEndpoint}/v1/traces`,
        headers: config.otlpHeaders,
      });
      spanProcessors.push(new BatchSpanProcessor(traceExporter));
    }
    
    // Console exporter for development
    if (config.useConsoleExporter) {
      spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    }
    
    // Metrics exporter
    let metricReader = undefined;
    if (config.otlpEndpoint) {
      const metricExporter = new OTLPMetricExporter({
        url: `${config.otlpEndpoint}/v1/metrics`,
        headers: config.otlpHeaders,
      });
      metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: config.metricExportIntervalMs,
      });
    }
    
    // Auto-instrumentation for common libraries
    const instrumentations = getNodeAutoInstrumentations({
      // HTTP instrumentation
      "@opentelemetry/instrumentation-http": {
        enabled: true,
        ignoreIncomingRequestHook: (req) => {
          // Ignore health checks to reduce noise
          const url = req.url || "";
          return url === "/health" || url === "/" || url.startsWith("/health/");
        },
      },
      // Express instrumentation
      "@opentelemetry/instrumentation-express": {
        enabled: true,
      },
      // Redis/IORedis instrumentation (BullMQ)
      "@opentelemetry/instrumentation-ioredis": {
        enabled: true,
        dbStatementSerializer: (cmd, args) => {
          // Only show command name for security
          return cmd;
        },
      },
      "@opentelemetry/instrumentation-redis-4": {
        enabled: true,
      },
      // PostgreSQL instrumentation
      "@opentelemetry/instrumentation-pg": {
        enabled: true,
        enhancedDatabaseReporting: true,
      },
      // Disable noisy instrumentations
      "@opentelemetry/instrumentation-fs": {
        enabled: false,
      },
      "@opentelemetry/instrumentation-dns": {
        enabled: false,
      },
      "@opentelemetry/instrumentation-net": {
        enabled: false,
      },
    });
    
    // Create and start SDK
    sdk = new NodeSDK({
      resource,
      spanProcessors,
      metricReader,
      instrumentations,
    });
    
    sdk.start();
    initialized = true;
    
    console.log(`[OTEL] ✓ Initialized - service: ${config.serviceName}, endpoint: ${config.otlpEndpoint}`);
    
    // Register shutdown handler
    process.on("SIGTERM", async () => {
      await shutdownTelemetry();
    });
    
  } catch (error) {
    console.error("[OTEL] Failed to initialize:", error.message);
    initialized = true; // Prevent retry
  }
}

/**
 * Gracefully shutdown OpenTelemetry SDK
 * Flushes pending spans and metrics before exit
 */
export async function shutdownTelemetry() {
  if (!sdk) {
    return;
  }
  
  try {
    console.log("[OTEL] Shutting down...");
    await sdk.shutdown();
    console.log("[OTEL] ✓ Shutdown complete");
  } catch (error) {
    console.error("[OTEL] Shutdown error:", error.message);
  }
}

/**
 * Check if OpenTelemetry is enabled and initialized
 */
export function isOtelEnabled() {
  return config.enabled && initialized;
}

/**
 * Get telemetry configuration (for health endpoint)
 */
export function getOtelConfig() {
  return {
    enabled: config.enabled,
    initialized,
    serviceName: config.serviceName,
    endpoint: config.otlpEndpoint,
    sampleRate: config.sampleRate,
    consoleExporter: config.useConsoleExporter,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  initTelemetry,
  shutdownTelemetry,
  isOtelEnabled,
  getOtelConfig,
};
