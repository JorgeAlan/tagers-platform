# OpenTelemetry Distributed Tracing

## Overview

This system implements distributed tracing across the async webhook → queue → worker architecture, allowing you to visualize the complete request flow in tools like Jaeger, Grafana Tempo, or Honeycomb.

```
HTTP POST /chatwoot/webhook
  └─ chatwoot.webhook.process (45ms)
      ├─ whisper.transcribe (optional, 800ms)
      ├─ chatwoot.hydrate (120ms)
      ├─ tagers.governor.evaluate (5ms)
      ├─ tagers.dispatcher.route (15ms)
      └─ queue.produce (2ms)
          [Context propagated via _traceContext]
          └─ tagers.worker.process (2500ms)
              ├─ tagers.agentic.tania (2400ms)
              │   ├─ llm.openai (classifier, 600ms)
              │   ├─ http.woocommerce (products, 300ms)
              │   └─ llm.openai (response, 1200ms)
              └─ http.chatwoot (send message, 100ms)
```

## Quick Start

### 1. Enable Tracing in Railway

Add these environment variables:

```bash
OTEL_ENABLED=true
OTEL_SERVICE_NAME=tagers-kiss-api
OTEL_EXPORTER_OTLP_ENDPOINT=http://your-collector:4318
```

### 2. View Traces

Open your tracing backend (Jaeger, Grafana, Honeycomb) and search for:
- Service: `tagers-kiss-api`
- Operation: `chatwoot.webhook.process` or `tagers.worker.process`

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_ENABLED` | `false` | Enable/disable tracing |
| `OTEL_SERVICE_NAME` | `tagers-kiss-api` | Service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | `` | Auth headers (e.g., `key1=val1,key2=val2`) |
| `OTEL_SAMPLE_RATE` | `1.0` | Sample rate (0.0-1.0) |
| `OTEL_LOG_LEVEL` | `info` | SDK log level |
| `OTEL_CONSOLE_EXPORTER` | `false` | Print spans to console (dev) |

## Architecture

### Trace Propagation Pattern

The key challenge is propagating trace context across BullMQ:

```javascript
// In webhook (chatwoot.js)
const traceContext = extractTraceContext();
await aiQueue.add("process_message", {
  ...data,
  _traceContext: traceContext,      // Serialized W3C context
  _webhookStartTime: Date.now(),    // For e2e latency
});

// In worker (aiWorker.js)
return withWorkerTraceContext(job, async (span) => {
  // This restores the trace context from _traceContext
  // All operations here are children of the webhook span
  await processMessage(job.data);
});
```

### Auto-Instrumentation

These are automatically instrumented (no code changes needed):
- HTTP/Express requests
- PostgreSQL queries
- Redis/IORedis commands
- BullMQ queue operations

### Manual Spans

For business logic, use manual spans:

```javascript
import { withSpan, addSpanAttributes } from "./telemetry/index.js";

await withSpan("tagers.custom.operation", async (span) => {
  addSpanAttributes({
    "tagers.conversation_id": conversationId,
    "tagers.custom_attr": value,
  });
  
  // Your business logic here
  return result;
});
```

## Metrics

### Counters
- `messages_received` - Total incoming messages
- `messages_processed` - Successfully processed
- `messages_errored` - Processing failures
- `messages_skipped` - Governor filtered
- `cache_hits` / `cache_misses` - Semantic cache
- `llm_calls` / `llm_errors` - OpenAI API calls
- `handoffs` - Human handoffs initiated
- `orders_created` - Orders created through bot

### Histograms (Latency)
- `webhook_latency` - HTTP webhook duration
- `queue_wait_time` - Time in queue
- `worker_processing_time` - Worker processing
- `llm_latency` - OpenAI response time
- `governor_latency` - Governor evaluation
- `dispatcher_latency` - Route determination
- `e2e_latency` - End-to-end (webhook → response)

### Gauges
- `queue_size` - Current queue depth
- `active_workers` - Active worker count
- `cache_size` - Semantic cache entries

## Backend Setup

### Jaeger (Local Development)

```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

Then:
```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Open http://localhost:16686 to view traces.

### Grafana Tempo (Production)

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic YOUR_TOKEN
```

### Honeycomb

```bash
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=https://api.honeycomb.io
OTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=YOUR_API_KEY
```

## Troubleshooting

### Traces not appearing

1. Check `OTEL_ENABLED=true`
2. Verify endpoint is reachable: `curl -v http://your-endpoint:4318/v1/traces`
3. Enable console exporter for debugging: `OTEL_CONSOLE_EXPORTER=true`

### Worker spans not linked to webhook

Ensure `_traceContext` is passed in job data and `withWorkerTraceContext` is used in worker.

### High overhead

Reduce sample rate: `OTEL_SAMPLE_RATE=0.1` (10% of requests)

## Query Examples

### Find slow requests (Jaeger)
```
service=tagers-kiss-api operation=tagers.worker.process minDuration=5s
```

### Find errors
```
service=tagers-kiss-api error=true
```

### Find by conversation
```
service=tagers-kiss-api tagers.conversation_id=12345
```

## Files

```
src/telemetry/
├── index.js          # Unified exports
├── instrumentation.js # SDK initialization
├── tracer.js         # Manual span creation
├── propagation.js    # Queue context propagation
└── metrics.js        # Custom metrics
```

## Version History

- **5.5.0** - Initial OpenTelemetry implementation
  - Auto-instrumentation for HTTP/DB/Redis
  - Manual spans for business logic
  - Trace propagation through BullMQ
  - Custom metrics collection
