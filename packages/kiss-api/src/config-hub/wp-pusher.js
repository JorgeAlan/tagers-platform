/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - WP PUSHER v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Envía configuración validada a WordPress
 */

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envía configuración a WordPress
 * 
 * @param {Object} config - Configuración validada
 * @returns {Promise<boolean>} true si éxito
 */
export async function pushToWordPress(config, options = {}) {
  const wpUrl = process.env.WP_BASE_URL;
  // Compat: en Railway ya tenemos TAGERS_CONFIG_SYNC_SECRET.
  // WP_CONFIG_SYNC_SECRET queda como alias legacy.
  const syncSecret = process.env.TAGERS_CONFIG_SYNC_SECRET || process.env.WP_CONFIG_SYNC_SECRET;
  const hash = options?.hash || config?.hash || config?.config_hash;
  
  if (!wpUrl) {
    console.warn('[WP-PUSHER] WP_BASE_URL not configured, skipping push');
    return false;
  }
  
  if (!syncSecret) {
    console.warn('[WP-PUSHER] TAGERS_CONFIG_SYNC_SECRET/WP_CONFIG_SYNC_SECRET not configured, skipping push');
    return false;
  }
  
  const endpoint = `${wpUrl}/wp-json/tagers-ops/v1/update-config`;
  
  console.log(`[WP-PUSHER] Pushing to ${endpoint}...`);
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tagers-Sync-Secret': syncSecret,
      },
      // IMPORTANTE: el plugin de WP espera el config "flattened" a nivel raíz
      // para poder extraer brand/branches/assistant/etc. (no anidar en {config:{...}}).
      body: JSON.stringify({
        ...config,
        hash: hash || '',
        timestamp: new Date().toISOString(),
        source: 'config-hub',
      }),
      // Timeout de 30 segundos
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log(`[WP-PUSHER] Success - version ${result.version || config.version}`);
      return true;
    } else {
      throw new Error(result.error || 'Unknown error');
    }
    
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('WordPress request timeout (30s)');
    }
    throw error;
  }
}

/**
 * Verifica conexión con WordPress
 */
export async function testWordPressConnection() {
  const wpUrl = process.env.WP_BASE_URL;
  
  if (!wpUrl) {
    return { success: false, error: 'WP_BASE_URL not configured' };
  }
  
  try {
    const response = await fetch(`${wpUrl}/wp-json`, {
      signal: AbortSignal.timeout(10000),
    });
    
    if (response.ok) {
      return { success: true, url: wpUrl };
    } else {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default { pushToWordPress, testWordPressConnection };
