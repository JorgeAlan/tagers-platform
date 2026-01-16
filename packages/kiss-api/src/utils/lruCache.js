/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LRU CACHE - Least Recently Used Cache con límite de tamaño
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Implementación simple de LRU usando Map (que mantiene orden de inserción).
 * Cuando se alcanza el límite, elimina los elementos menos usados.
 * 
 * Uso principal: conversationMemory para evitar memory leaks
 * 
 * @version 1.0.0
 */

/**
 * @template K, V
 */
export class LRUCache {
  /**
   * @param {number} maxSize - Número máximo de entries
   * @param {Object} options
   * @param {number} [options.ttlMs] - TTL en milisegundos (opcional)
   * @param {Function} [options.onEvict] - Callback cuando se elimina un entry
   */
  constructor(maxSize, options = {}) {
    this.maxSize = maxSize;
    this.ttlMs = options.ttlMs || null;
    this.onEvict = options.onEvict || null;
    
    /** @type {Map<K, {value: V, lastAccess: number, createdAt: number}>} */
    this.cache = new Map();
    
    // Stats
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
    };
  }
  
  /**
   * Obtiene un valor
   * @param {K} key
   * @returns {V|undefined}
   */
  get(key) {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }
    
    // Verificar TTL
    if (this.ttlMs && Date.now() - entry.createdAt > this.ttlMs) {
      this.delete(key);
      this.stats.misses++;
      return undefined;
    }
    
    // Actualizar acceso (mover al final = más reciente)
    entry.lastAccess = Date.now();
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    this.stats.hits++;
    return entry.value;
  }
  
  /**
   * Establece un valor
   * @param {K} key
   * @param {V} value
   * @returns {this}
   */
  set(key, value) {
    const now = Date.now();
    
    // Si ya existe, actualizar
    if (this.cache.has(key)) {
      const entry = this.cache.get(key);
      entry.value = value;
      entry.lastAccess = now;
      // Mover al final
      this.cache.delete(key);
      this.cache.set(key, entry);
      return this;
    }
    
    // Evictar si está lleno
    if (this.cache.size >= this.maxSize) {
      this._evictOldest();
    }
    
    // Insertar nuevo
    this.cache.set(key, {
      value,
      lastAccess: now,
      createdAt: now,
    });
    
    return this;
  }
  
  /**
   * Verifica si existe una key
   * @param {K} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    // Verificar TTL
    if (this.ttlMs && Date.now() - entry.createdAt > this.ttlMs) {
      this.delete(key);
      return false;
    }
    
    return true;
  }
  
  /**
   * Elimina una key
   * @param {K} key
   * @returns {boolean}
   */
  delete(key) {
    const entry = this.cache.get(key);
    if (entry && this.onEvict) {
      this.onEvict(key, entry.value);
    }
    return this.cache.delete(key);
  }
  
  /**
   * Limpia todo el cache
   */
  clear() {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value);
      }
    }
    this.cache.clear();
  }
  
  /**
   * Obtiene el tamaño actual
   */
  get size() {
    return this.cache.size;
  }
  
  /**
   * Obtiene todas las keys
   */
  keys() {
    return this.cache.keys();
  }
  
  /**
   * Obtiene estadísticas
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1)
      : "0.0";
    
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      hitRate: `${hitRate}%`,
    };
  }
  
  /**
   * Evicta el elemento más viejo (LRU)
   * @private
   */
  _evictOldest() {
    // Map mantiene orden de inserción, el primero es el más viejo
    const oldestKey = this.cache.keys().next().value;
    
    if (oldestKey !== undefined) {
      const entry = this.cache.get(oldestKey);
      if (this.onEvict) {
        this.onEvict(oldestKey, entry?.value);
      }
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
  
  /**
   * Limpia entries expirados (si hay TTL)
   */
  cleanup() {
    if (!this.ttlMs) return 0;
    
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }
}

export default LRUCache;
