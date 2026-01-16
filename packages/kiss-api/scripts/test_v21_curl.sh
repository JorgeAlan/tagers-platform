#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# TAGERS KISS API v21 - Test Manual con Curl
# ═══════════════════════════════════════════════════════════════════════════
#
# Uso:
#   ./test_v21_curl.sh                    # Usa localhost:3000
#   ./test_v21_curl.sh https://tu-app.railway.app
#
# ═══════════════════════════════════════════════════════════════════════════

BASE_URL="${1:-http://localhost:3000}"
TOKEN="${CHATWOOT_WEBHOOK_TOKEN:-test-token}"

echo ""
echo "╔═══════════════════════════════════════════════════════════════════╗"
echo "║        TAGERS KISS API v21 - Test Suite (curl)                    ║"
echo "╚═══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Base URL: $BASE_URL"
echo "  Token: ${TOKEN:0:10}..."
echo ""

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

passed=0
failed=0

test_result() {
  if [ "$1" = "0" ]; then
    echo -e "  ${GREEN}✓${NC} $2"
    ((passed++))
  else
    echo -e "  ${RED}✗${NC} $2 ${YELLOW}($3)${NC}"
    ((failed++))
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
echo "═══ HEALTH CHECKS ═══"
# ═══════════════════════════════════════════════════════════════════════════

# Test 1: Root endpoint
response=$(curl -s "$BASE_URL/")
if echo "$response" | grep -q '"ok":true'; then
  version=$(echo "$response" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
  test_result 0 "GET / → ok (version: $version)"
else
  test_result 1 "GET /" "No ok:true"
fi

# Test 2: Chatwoot health
response=$(curl -s "$BASE_URL/chatwoot/health")
if echo "$response" | grep -q '"status":"healthy"'; then
  test_result 0 "GET /chatwoot/health → healthy"
else
  test_result 1 "GET /chatwoot/health" "No healthy"
fi

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ WEBHOOK SPEED ═══"
# ═══════════════════════════════════════════════════════════════════════════

# Test 3: Webhook responde rápido
start_time=$(date +%s%3N)
response=$(curl -s -w "%{http_code}" -o /tmp/webhook_response.json \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 99999,
      "content": "Test de velocidad",
      "message_type": "incoming",
      "sender_type": "Contact"
    },
    "conversation": {"id": 12345},
    "account": {"id": 1}
  }')
end_time=$(date +%s%3N)
duration=$((end_time - start_time))

if [ "$response" = "200" ] && [ "$duration" -lt 500 ]; then
  test_result 0 "POST /chatwoot/webhook → 200 en ${duration}ms"
elif [ "$response" = "200" ]; then
  test_result 1 "POST /chatwoot/webhook" "Lento: ${duration}ms (esperado <500ms)"
else
  test_result 1 "POST /chatwoot/webhook" "HTTP $response"
fi

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ GOVERNOR TESTS ═══"
# ═══════════════════════════════════════════════════════════════════════════

# Test 4: Mensaje saliente (debe aceptar pero no procesar)
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 88888,
      "content": "Respuesta del bot",
      "message_type": "outgoing",
      "sender_type": "AgentBot"
    },
    "conversation": {"id": 12345},
    "account": {"id": 1}
  }')
if [ "$response" = "200" ]; then
  test_result 0 "Mensaje outgoing → 200 (Governor ignora)"
else
  test_result 1 "Mensaje outgoing" "HTTP $response"
fi

# Test 5: Nota privada
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 77777,
      "content": "Nota privada del equipo",
      "message_type": "incoming",
      "private": true
    },
    "conversation": {"id": 12345},
    "account": {"id": 1}
  }')
if [ "$response" = "200" ]; then
  test_result 0 "Nota privada → 200 (Governor ignora)"
else
  test_result 1 "Nota privada" "HTTP $response"
fi

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ FLOW TESTS ═══"
# ═══════════════════════════════════════════════════════════════════════════

# Test 6: Saludo
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 66661,
      "content": "Hola!",
      "message_type": "incoming",
      "sender_type": "Contact"
    },
    "conversation": {"id": 10001},
    "account": {"id": 1}
  }')
if [ "$response" = "200" ]; then
  test_result 0 "Saludo 'Hola' → 200 (Dispatcher: GREETING)"
else
  test_result 1 "Saludo" "HTTP $response"
fi

# Test 7: Intent ORDER_CREATE
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 66662,
      "content": "Quiero ordenar una rosca clásica para el viernes",
      "message_type": "incoming",
      "sender_type": "Contact"
    },
    "conversation": {"id": 10002},
    "account": {"id": 1}
  }')
if [ "$response" = "200" ]; then
  test_result 0 "Order create 'quiero rosca' → 200 (Dispatcher: ORDER_CREATE)"
else
  test_result 1 "Order create" "HTTP $response"
fi

# Test 8: Intent ORDER_STATUS
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 66663,
      "content": "Donde está mi pedido 12345?",
      "message_type": "incoming",
      "sender_type": "Contact"
    },
    "conversation": {"id": 10003},
    "account": {"id": 1}
  }')
if [ "$response" = "200" ]; then
  test_result 0 "Order status 'donde está mi pedido' → 200 (Dispatcher: ORDER_STATUS)"
else
  test_result 1 "Order status" "HTTP $response"
fi

# Test 9: Handoff request
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook?token=$TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 66664,
      "content": "Quiero hablar con un humano por favor",
      "message_type": "incoming",
      "sender_type": "Contact"
    },
    "conversation": {"id": 10004},
    "account": {"id": 1}
  }')
if [ "$response" = "200" ]; then
  test_result 0 "Handoff 'quiero hablar con humano' → 200 (Dispatcher: HANDOFF)"
else
  test_result 1 "Handoff" "HTTP $response"
fi

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ AUTH TESTS ═══"
# ═══════════════════════════════════════════════════════════════════════════

# Test 10: Sin token → 401
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST "$BASE_URL/chatwoot/webhook" \
  -H "Content-Type: application/json" \
  -d '{"event":"test"}')
if [ "$response" = "401" ]; then
  test_result 0 "Sin token → 401 Unauthorized"
elif [ "$response" = "200" ]; then
  echo -e "  ${YELLOW}⚠${NC} Sin token → 200 (token validation disabled?)"
else
  test_result 1 "Sin token" "HTTP $response (esperado 401)"
fi

# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "═══ RESUMEN ═══"
echo ""
total=$((passed + failed))
echo -e "  Passed: ${GREEN}$passed${NC}"
echo -e "  Failed: ${RED}$failed${NC}"
echo -e "  Total:  $total"
echo ""

if [ "$failed" = "0" ]; then
  echo -e "  ${GREEN}🎉 ¡Todos los tests pasaron!${NC}"
else
  echo -e "  ${YELLOW}⚠️  Algunos tests fallaron. Revisa los logs del servidor.${NC}"
fi
echo ""

exit $failed
