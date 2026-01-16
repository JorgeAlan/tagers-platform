#!/usr/bin/env node
/**
 * Tagers KISS Suite — Staging E2E HITL Smoke
 *
 * Goal
 * ----
 * Validate the full HITL loop in staging:
 *  1) Simulate a Chatwoot webhook -> KISS (/chatwoot/webhook)
 *  2) KISS emits a HITL instruction to tablets (Socket.io)
 *  3) A staff (this script) responds with decision+comment
 *  4) KISS sends an outgoing message back to Chatwoot conversation
 *
 * Required env vars:
 *  - KISS_API_BASE_URL
 *  - CHATWOOT_BASE_URL
 *  - CHATWOOT_API_ACCESS_TOKEN
 *  - CHATWOOT_ACCOUNT_ID
 *  - CHATWOOT_CONVERSATION_ID  (display_id)
 *  - HITL_BRANCH_ID            (e.g. SONATA)
 *  - HITL_BRANCH_TOKEN         (tablet token for that branch)
 *
 * Optional env vars:
 *  - KISS_CHATWOOT_WEBHOOK_TOKEN (query param ?token=...)
 *  - TEST_MESSAGE
 *  - STAFF_DECISION              ENCONTRADO | NO_ENCONTRADO | INFO (default ENCONTRADO)
 *  - STAFF_COMMENT               (default: "Está en caja")
 *  - TIMEOUT_S                   (default: 70)
 *  - POLL_S                      (default: 2)
 */

import process from "process";
import { io } from "socket.io-client";

function env(name, def = "") {
  return (process.env[name] || def).trim();
}

function die(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function buildUrl(base, path) {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function httpJson(method, url, headers, body = null) {
  const opts = {
    method: method.toUpperCase(),
    headers: { ...(headers || {}) },
  };
  if (body !== null) {
    opts.headers["Content-Type"] = opts.headers["Content-Type"] || "application/json";
    opts.body = JSON.stringify(body);
  }

  let resp;
  try {
    resp = await fetch(url, opts);
  } catch (e) {
    die(`HTTP failed: ${method} ${url}: ${e}`);
  }

  const text = await resp.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text };
    }
  }

  return { status: resp.status, data };
}

function normalizeMessagesPayload(payload) {
  // Chatwoot sometimes returns {payload:[...]} or {payload:{messages:[...]}} or an array.
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.payload)) return payload.payload;
    if (payload.payload && typeof payload.payload === "object" && Array.isArray(payload.payload.messages)) return payload.payload.messages;
  }
  return [];
}

async function fetchChatwootMessages({ chatwootBase, token, accountId, conversationId }) {
  const url = buildUrl(chatwootBase, `/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`);
  const { status, data } = await httpJson("GET", url, {
    "api_access_token": token,
    "Accept": "application/json",
  });
  if (status < 200 || status >= 300) {
    die(`Chatwoot messages fetch failed: HTTP ${status} ${JSON.stringify(data)}`);
  }
  return normalizeMessagesPayload(data);
}

function pickNewOutgoing(before, after) {
  const beforeIds = new Set(before.map(m => String(m?.id || "")));
  const delta = after.filter(m => !beforeIds.has(String(m?.id || "")));
  return delta.filter(m => String(m?.message_type || "").toLowerCase() === "outgoing");
}

async function main() {
  const kissBase = env("KISS_API_BASE_URL");
  const chatwootBase = env("CHATWOOT_BASE_URL");
  const cwToken = env("CHATWOOT_API_ACCESS_TOKEN");
  const accountId = env("CHATWOOT_ACCOUNT_ID");
  const conversationId = env("CHATWOOT_CONVERSATION_ID");

  const branchId = env("HITL_BRANCH_ID").toUpperCase();
  const branchToken = env("HITL_BRANCH_TOKEN");

  if (!kissBase) die("KISS_API_BASE_URL is required");
  if (!chatwootBase) die("CHATWOOT_BASE_URL is required");
  if (!cwToken) die("CHATWOOT_API_ACCESS_TOKEN is required");
  if (!accountId) die("CHATWOOT_ACCOUNT_ID is required");
  if (!conversationId) die("CHATWOOT_CONVERSATION_ID is required (display_id)");
  if (!branchId) die("HITL_BRANCH_ID is required");
  if (!branchToken) die("HITL_BRANCH_TOKEN is required");

  const webhookToken = env("KISS_CHATWOOT_WEBHOOK_TOKEN");
  const testMessage = env("TEST_MESSAGE", "Olvidé mis lentes rojos en Tagers Sonata, ¿me ayudas a buscarlos?");

  const decision = env("STAFF_DECISION", "ENCONTRADO").toUpperCase();
  const comment = env("STAFF_COMMENT", "Está en caja");

  const timeoutS = parseInt(env("TIMEOUT_S", "70"), 10);
  const pollS = parseFloat(env("POLL_S", "2"));

  // Baseline messages
  const beforeMsgs = await fetchChatwootMessages({ chatwootBase, token: cwToken, accountId, conversationId });
  console.log(`Baseline messages fetched: ${beforeMsgs.length}`);

  // Socket connection (tablet simulation)
  const socket = io(kissBase, {
    transports: ["websocket", "polling"],
    auth: {
      token: branchToken,
      branch_id: branchId,
      role: "QA_BOT",
      device_id: "staging_hitl_smoke",
      name: "Staging HITL Smoke",
    },
  });

  const connected = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("SOCKET_TIMEOUT")), 15000);
    socket.on("connect", () => {
      clearTimeout(t);
      resolve(true);
    });
    socket.on("connect_error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });

  try {
    await connected;
  } catch (e) {
    die(`Socket connect failed: ${e?.message || e}`);
  }

  console.log(`Socket connected. branch=${branchId}`);

  // Wait for a HITL request for the same conversation
  let instructionId = null;
  const gotInstruction = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error("NO_HITL_REQUEST")), timeoutS * 1000);

    socket.on("hitl_request", (instruction) => {
      try {
        const meta = instruction?.actions?.[0]?.params?.meta || {};
        const chat = meta?.chatwoot || {};
        const conv = chat?.conversation_id;

        // Accept the first instruction that matches this conversation id.
        if (String(conv) === String(conversationId)) {
          instructionId = instruction?.instruction_id || null;
          clearTimeout(deadline);
          resolve(instruction);
        }
      } catch {
        // ignore
      }
    });
  });

  // Trigger webhook to create HITL instruction
  let webhookUrl = buildUrl(kissBase, "/chatwoot/webhook");
  if (webhookToken) {
    webhookUrl += `?token=${encodeURIComponent(webhookToken)}`;
  }

  const payload = {
    event: "message_created",
    message: {
      content: testMessage,
      message_type: "incoming",
      sender_type: "Contact",
      sender: {
        name: "Staging Tester",
        phone_number: "+520000000000",
        type: "Contact",
      },
    },
    conversation: {
      id: parseInt(conversationId, 10),
      account_id: parseInt(accountId, 10),
    },
    account: { id: parseInt(accountId, 10) },
  };

  const { status: whStatus, data: whData } = await httpJson("POST", webhookUrl, { "Accept": "application/json" }, payload);
  if (whStatus < 200 || whStatus >= 300) {
    die(`KISS webhook call failed: HTTP ${whStatus} ${JSON.stringify(whData)}`);
  }
  console.log(`KISS webhook accepted: HTTP ${whStatus}`);
  console.log(`Sent test message: ${testMessage}`);

  let instruction;
  try {
    instruction = await gotInstruction;
  } catch (e) {
    socket.disconnect();
    die(`Timeout waiting for hitl_request: ${e?.message || e}`);
  }

  if (!instructionId) {
    socket.disconnect();
    die("Received hitl_request but missing instruction_id");
  }

  console.log(`Received HITL instruction: ${instructionId}`);

  // Respond as staff (tablet)
  const ack = await new Promise((resolve) => {
    socket.emit(
      "hitl_response",
      { instruction_id: instructionId, decision, comment },
      (a) => resolve(a)
    );
  });

  if (!ack || ack.ok !== true) {
    socket.disconnect();
    die(`hitl_response not acknowledged: ${JSON.stringify(ack)}`);
  }
  console.log(`Sent staff response: decision=${decision} comment="${comment}"`);

  // Poll Chatwoot for outgoing message
  const started = Date.now();
  let outgoing = [];

  while ((Date.now() - started) / 1000 < timeoutS) {
    await new Promise((r) => setTimeout(r, pollS * 1000));
    const afterMsgs = await fetchChatwootMessages({ chatwootBase, token: cwToken, accountId, conversationId });
    outgoing = pickNewOutgoing(beforeMsgs, afterMsgs);
    if (outgoing.length) {
      break;
    }
  }

  socket.disconnect();

  if (!outgoing.length) {
    die(`Timeout: no outgoing message detected within ${timeoutS}s`);
  }

  const joined = outgoing.map(m => String(m?.content || "")).join("\n").toLowerCase();
  if (comment && !joined.includes(comment.toLowerCase())) {
    console.log("WARN: outgoing message does not include staff comment (this can be normal depending on prompt).\n");
  }

  console.log("\n=== New outgoing messages ===");
  for (const m of outgoing) {
    console.log(`- id=${m?.id} created_at=${m?.created_at} content=\n${String(m?.content || "").trim()}\n`);
  }

  console.log("PASS: HITL E2E smoke");
}

main().catch((e) => die(e?.message || String(e)));
