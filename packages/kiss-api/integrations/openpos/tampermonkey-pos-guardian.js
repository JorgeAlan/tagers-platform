// ==UserScript==
// @name         Tagers POS Guardian - Beacon Sender (KISS v3)
// @namespace    https://tagers.com/
// @version      0.3.0
// @description  Captura cancelaciones y notas operativas desde OpenPOS y manda beacons a WordPress → KISS API (sin exponer llaves OpenAI). Identity-aware por rol/sucursal/dispositivo. Con detección real de DOM Angular.
// @match        *://*/pos/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const WP_BEACON_ENDPOINT = "/wp-json/tagers-kiss/v1/beacon";
  const IDENTITY_KEY = "TAGERS_POS_IDENTITY_V1";

  // ==== SELECTORES CANDIDATOS PARA OPENPOS (Angular) ====
  const OPENPOS_SELECTORS = {
    // Header / Sucursal
    storeLabel: [
      ".pos-header .store-name",
      "[data-testid='store-label']",
      ".mat-toolbar .location-name",
      "op-header .branch-name",
      ".header-info .sucursal",
      "[data-store]",
      ".store-name",
      ".tagers-store",
    ],

    // Botón cancelar venta
    cancelButton: [
      "button[aria-label*='Cancelar']",
      "button[aria-label*='cancelar']",
      "button.cancel-sale",
      ".mat-button.cancel",
      "[data-action='cancel-transaction']",
      "op-cart-actions button.danger",
      ".cart-footer button.mat-warn",
      "button.btn-cancel",
    ],

    // Modal de confirmación de cancelación
    cancelConfirmModal: [
      "mat-dialog-container.cancel-confirm",
      ".cdk-overlay-pane .confirm-cancel",
      "op-confirm-dialog",
      "[role='dialog'][aria-label*='cancelar']",
      "[role='dialog'][aria-label*='Cancelar']",
      "mat-dialog-container",
    ],

    // Botón confirmar dentro del modal
    confirmCancelButton: [
      "mat-dialog-actions button.mat-primary",
      ".confirm-cancel .btn-confirm",
      "[data-action='confirm-cancel']",
      "mat-dialog-actions button:not(.mat-button-secondary)",
      ".mat-dialog-actions button.confirm",
    ],

    // Order ID (si está visible en la UI)
    orderId: [
      ".cart-header .order-number",
      "[data-order-id]",
      ".receipt-preview .order-id",
      "op-cart .transaction-id",
      ".transaction-number",
    ],

    // Cart items (para extraer contexto)
    cartItems: [
      "op-cart-item",
      ".cart-item-row",
      ".mat-list-item.cart-product",
      ".cart-item",
    ],
  };

  // Estado para evitar duplicados de confirmación de cancelación
  let pendingCancelConfirm = null;
  let modalObserver = null;

  function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function safeParseJSON(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getIdentity() {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const obj = safeParseJSON(raw);
    if (!obj || typeof obj !== "object") return null;

    const role = String(obj.role || "").trim().toUpperCase();
    const location_id = String(obj.location_id || "").trim();
    const device_id = String(obj.device_id || "").trim();

    if (!role || !location_id || !device_id) return null;

    return {
      role,
      location_id,
      device_id,
      display_name: String(obj.display_name || "POS User").trim(),
      wp_token: String(obj.wp_token || "").trim(),
    };
  }

  function saveIdentity(identity) {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  }

  function promptIdentitySetup() {
    const role = window
      .prompt(
        "Configurar Tagers POS Identity\n\nROL (ej: CAJERO, RUNNER, GERENTE_SUCURSAL):",
        "CAJERO"
      )
      ?.trim()
      .toUpperCase();

    if (!role) return null;

    const location_id = window.prompt("SUCURSAL (location_id, ej: puebla-5-sur):", "puebla-5-sur")?.trim();
    if (!location_id) return null;

    const device_id = window.prompt("DISPOSITIVO (device_id, ej: POS-01):", "POS-01")?.trim();
    if (!device_id) return null;

    const display_name = window.prompt("Nombre visible (opcional):", "POS User")?.trim() || "POS User";
    const wp_token = window.prompt("WP Token (opcional, si POS no usa sesión):", "")?.trim() || "";

    const identity = { role, location_id, device_id, display_name, wp_token };
    saveIdentity(identity);

    console.log("[Tagers] Identity guardada", identity);
    return identity;
  }

  function ensureIdentity() {
    let id = getIdentity();
    if (id) return id;

    alert(
      "Tagers POS Guardian necesita identidad (rol/sucursal/dispositivo).\n\nPresiona Ctrl+Alt+I para configurarlo, o se abrirá configuración ahora."
    );

    id = promptIdentitySetup();
    return id;
  }

  // ====== FUNCIONES MEJORADAS PARA DOM REAL ======

  function findLocationIdFallbackFromDOM() {
    const selectors = OPENPOS_SELECTORS.storeLabel;

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      // Intentar data-attribute primero
      const dataStore =
        el.getAttribute("data-store") ||
        el.getAttribute("data-location-id") ||
        el.getAttribute("data-branch");
      if (dataStore) return dataStore.trim();

      // Fallback a textContent
      const text = (el.textContent || "").trim();
      if (text && text.length > 2 && text.length < 64) {
        // Normalizar: "Sucursal 5 Sur - Puebla" → "puebla-5-sur"
        return text
          .toLowerCase()
          .replace(/sucursal\s*/gi, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      }
    }

    // Último recurso: extraer de URL
    const urlMatch = window.location.pathname.match(/\/pos\/([a-z0-9-]+)/i);
    if (urlMatch) return urlMatch[1];

    return "unknown";
  }

  function findOrderIdFromDOM() {
    const selectors = OPENPOS_SELECTORS.orderId;

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;

      const dataId = el.getAttribute("data-order-id");
      if (dataId) return dataId.trim();

      const text = (el.textContent || "").trim();
      // Buscar patrón: #12345, ORD-12345, etc.
      const match = text.match(/(ORD-?\d+|#\d+|\d{5,})/i);
      if (match) return match[1].replace("#", "");
    }

    return null;
  }

  function extractCartContext() {
    const allSelectors = OPENPOS_SELECTORS.cartItems.join(", ");
    const items = document.querySelectorAll(allSelectors);
    if (!items.length) return null;

    const cart = [];
    items.forEach((el) => {
      const name =
        el.querySelector(".product-name, .item-name")?.textContent?.trim() ||
        el.querySelector("[data-product-name]")?.getAttribute("data-product-name");
      const qty =
        el.querySelector(".qty, .quantity")?.textContent?.trim() ||
        el.querySelector("[data-qty]")?.getAttribute("data-qty");
      const sku =
        el.getAttribute("data-sku") ||
        el.querySelector("[data-sku]")?.getAttribute("data-sku");

      if (name) {
        cart.push({ name, qty: parseInt(qty) || 1, sku: sku || null });
      }
    });

    return cart.length > 0 ? cart : null;
  }

  function isCancelButtonReal(el) {
    if (!el) return false;

    // Verificar contra selectores conocidos
    const cancelSelectors = OPENPOS_SELECTORS.cancelButton;
    for (const sel of cancelSelectors) {
      try {
        if (el.matches(sel) || el.closest(sel)) return true;
      } catch (e) {
        // Invalid selector, skip
      }
    }

    // Fallback a texto (más permisivo)
    const txt = (el.textContent || "").trim().toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();

    return (
      txt === "cancelar" ||
      txt === "cancelar venta" ||
      txt === "anular" ||
      ariaLabel.includes("cancelar")
    );
  }

  function isConfirmModalOpen() {
    const selectors = OPENPOS_SELECTORS.cancelConfirmModal;
    for (const sel of selectors) {
      try {
        if (document.querySelector(sel)) return true;
      } catch (e) {
        // Invalid selector
      }
    }
    return false;
  }

  function findConfirmButton() {
    const selectors = OPENPOS_SELECTORS.confirmCancelButton;
    for (const sel of selectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn) return btn;
      } catch (e) {
        // Invalid selector
      }
    }
    return null;
  }

  async function sendBeacon(beacon, identity) {
    const headers = { "Content-Type": "application/json" };

    if (identity?.wp_token) {
      headers["X-Tagers-Token"] = identity.wp_token;
      headers["X-Tagers-Channel"] = "pos";
    }

    const resp = await fetch(WP_BEACON_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(beacon),
    });

    if (!resp.ok) throw new Error("Beacon send failed: " + resp.status);
    return resp.json().catch(() => ({}));
  }

  function buildActor(identity) {
    return {
      role: identity.role,
      name: identity.display_name,
      device_id: identity.device_id,
      location_id: identity.location_id,
    };
  }

  async function handleRealCancelConfirm(context) {
    const identity = ensureIdentity();
    if (!identity) return;

    const reason = window.prompt("¿Por qué cancelaste esta venta? (1 frase)");
    if (!reason) return;

    const location_id = identity.location_id || findLocationIdFallbackFromDOM();

    const beacon = {
      beacon_id: uuidv4(),
      timestamp_iso: new Date().toISOString(),
      signal_source: "POS_CANCEL_TRANSACTION",
      location_id,
      actor: buildActor(identity),
      human_rlhf_payload: {
        ui_type: "popup_question",
        question: "¿Por qué cancelaste esta venta?",
        response_value: reason,
        response_type: "text",
      },
      machine_payload: {
        order_id: context.order_id,
        cart_snapshot: context.cart_context,
        cancel_confirmed_at: new Date().toISOString(),
      },
    };

    try {
      await sendBeacon(beacon, identity);
      console.log("[Tagers] Cancel beacon enviado", beacon.beacon_id);
    } catch (e) {
      console.warn("[Tagers] Error enviando beacon", e);
      alert("No se pudo enviar el beacon. Reintenta o avisa a Control Tower.");
    }
  }

  // Observer para detectar cuando se abre el modal de confirmación
  function initModalObserver() {
    const overlayContainer = document.querySelector(".cdk-overlay-container");
    if (!overlayContainer) {
      // Retry si Angular no ha inicializado
      setTimeout(initModalObserver, 500);
      return;
    }

    if (modalObserver) {
      modalObserver.disconnect();
    }

    modalObserver = new MutationObserver((mutations) => {
      if (!pendingCancelConfirm) return;

      // Buscar modal de confirmación
      if (isConfirmModalOpen()) {
        const confirmBtn = findConfirmButton();

        if (confirmBtn && !confirmBtn._tagersHandled) {
          confirmBtn._tagersHandled = true;
          confirmBtn.addEventListener(
            "click",
            () => {
              // ¡Cancelación REAL confirmada!
              handleRealCancelConfirm(pendingCancelConfirm);
              pendingCancelConfirm = null;
            },
            { once: true }
          );
        }
      }
    });

    modalObserver.observe(overlayContainer, { childList: true, subtree: true });
    console.log("[Tagers] Modal observer iniciado");
  }

  async function handleCancelClick(ev) {
    const btn = ev.target?.closest?.("button, a, [role='button'], mat-button, .mat-button");
    if (!btn || !isCancelButtonReal(btn)) return;

    // Capturar contexto ANTES de que el modal lo limpie
    pendingCancelConfirm = {
      order_id: findOrderIdFromDOM(),
      cart_context: extractCartContext(),
      timestamp: Date.now(),
    };

    console.log("[Tagers] Cancel button clicked, waiting for confirm...", pendingCancelConfirm);

    // Fallback: si no hay modal observer o no se detecta modal,
    // usar el comportamiento legacy después de un timeout
    setTimeout(() => {
      if (pendingCancelConfirm && pendingCancelConfirm.timestamp === pendingCancelConfirm?.timestamp) {
        // Si después de 5s no se ha procesado el confirm, usar fallback
        if (pendingCancelConfirm) {
          const ctx = pendingCancelConfirm;
          pendingCancelConfirm = null;
          
          // Solo si no se abrió modal
          if (!isConfirmModalOpen()) {
            handleRealCancelConfirm(ctx);
          }
        }
      }
    }, 5000);
  }

  // Captura global
  document.addEventListener("click", handleCancelClick, true);

  // Identity setup shortcut: Ctrl+Alt+I
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey && e.altKey && (e.key === "i" || e.key === "I"))) return;
    promptIdentitySetup();
  });

  // Shortcut manual para staff POS: Ctrl+Alt+N
  // Para CAJERO/RUNNER/GERENTE_SUCURSAL en POS (NO para Bruno).
  document.addEventListener("keydown", async (e) => {
    const isNoteN = e.ctrlKey && e.altKey && (e.key === "n" || e.key === "N");
    if (!isNoteN) return;

    const identity = ensureIdentity();
    if (!identity) return;

    const txt = window.prompt("Nota rápida (staff POS):");
    if (!txt) return;

    const location_id = identity.location_id || findLocationIdFallbackFromDOM();

    const beacon = {
      beacon_id: uuidv4(),
      timestamp_iso: new Date().toISOString(),
      signal_source: "POS_STAFF_NOTE",
      location_id,
      actor: buildActor(identity),
      human_rlhf_payload: {
        ui_type: "quick_note",
        question: "Nota operativa",
        response_value: txt,
        response_type: "text",
      },
    };

    try {
      await sendBeacon(beacon, identity);
      console.log("[Tagers] Beacon nota enviado", beacon.beacon_id);
    } catch (err) {
      console.warn("[Tagers] Error", err);
      alert("No se pudo enviar el beacon.");
    }
  });

  // Boot
  if (!getIdentity()) {
    console.log("[Tagers] Identity no configurada. Usa Ctrl+Alt+I para configurar rol/sucursal/dispositivo.");
  }

  // Init modal observer cuando Angular esté listo
  if (document.readyState === "complete") {
    initModalObserver();
  } else {
    window.addEventListener("load", initModalObserver);
  }

  // ====== TEST MANUAL (ejecutar en consola) ======
  // Para validar selectores en OpenPOS real:
  window.tagersTestSelectors = function () {
    console.log("=== Tagers Selector Test ===");
    console.log(
      "Store label:",
      document.querySelector(OPENPOS_SELECTORS.storeLabel.join(", "))?.textContent
    );
    console.log(
      "Cancel btn:",
      document.querySelector(OPENPOS_SELECTORS.cancelButton.join(", "))
    );
    console.log("Order ID:", findOrderIdFromDOM());
    console.log("Cart items:", extractCartContext());
    console.log("Location fallback:", findLocationIdFallbackFromDOM());
    console.log("=== End Test ===");
  };

  console.log("[Tagers] POS Guardian v0.3.0 loaded. Run tagersTestSelectors() to validate DOM selectors.");
})();
