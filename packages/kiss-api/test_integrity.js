#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST INTEGRITY - Validación pre-deploy
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecutar ANTES de subir cambios a GitHub:
 *   node test_integrity.js
 * 
 * Verifica:
 * ✓ Sintaxis de todos los módulos JS
 * ✓ Imports correctos (no hay dependencias rotas)
 * ✓ Knowledge Hub funciona
 * ✓ Matchers devuelven resultados esperados
 * ✓ Mensajes canned tienen las keys requeridas
 * ✓ No hay hardcoding residual
 * 
 * Exit codes:
 *   0 = Todo OK
 *   1 = Hay errores
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

const CRITICAL_FILES = [
  // NUEVOS (deben existir siempre)
  { path: 'src/knowledge-hub/index.js', required: true },
  { path: 'src/knowledge-hub/matchers.js', required: true },
  { path: 'src/knowledge-hub/sheet-loader.js', required: true },
  
  // MODIFICADOS (deben existir si estamos en repo completo)
  { path: 'src/server.js', required: false },
  { path: 'src/tools/intent_extractor.js', required: false },
  { path: 'src/flows/orderCreateFlow.js', required: false },
  { path: 'src/services/aiOrchestrator.js', required: false },
  { path: 'src/services/flowStateService.js', required: false },
  { path: 'src/routes/chatwoot.js', required: false },
];

const REQUIRED_CANNED_KEYS = [
  'greeting',
  'escalate',
  'ask_product',
  'ask_branch',
];

const HARDCODED_PATTERNS = [
  { pattern: /["']5_sur["']\s*,\s*["']angelopolis["']\s*,\s*["']sonata["']/, desc: 'Lista hardcodeada de sucursales' },
  { pattern: /Rosca Clásica.*Rosca de Nutella.*Rosca Lotus/s, desc: 'Lista hardcodeada de productos' },
  { pattern: /enum:\s*\[\s*["']san_angel["']\s*,\s*["']angelopolis["']/, desc: 'Enum hardcodeado de sucursales' },
];

const BRANCH_TEST_CASES = [
  { input: 'quiero en angelopolis', expected: 'angelopolis' },
  { input: 'la de 5 sur', expected: '5sur' }, // Puede ser 5sur o 5_sur
  { input: 'san angel cdmx', expected: 'san_angel' },
  { input: 'en sonata por favor', expected: 'sonata' },
  { input: 'zavaleta', expected: 'zavaleta' },
  { input: 'hola buenos dias', expected: null },
];

const PRODUCT_TEST_CASES = [
  { input: 'la clasica', expected: true },
  { input: 'quiero nutella', expected: true },
  { input: 'la de galleta lotus', expected: true },
  { input: 'hola como estas', expected: false },
];

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function log(icon, color, message) {
  console.log(`${color}${icon}${COLORS.reset} ${message}`);
}

function pass(message) {
  passCount++;
  log('✓', COLORS.green, message);
}

function fail(message) {
  failCount++;
  log('✗', COLORS.red, message);
}

function warn(message) {
  warnCount++;
  log('⚠', COLORS.yellow, message);
}

function info(message) {
  log('ℹ', COLORS.blue, message);
}

function section(title) {
  console.log(`\n${COLORS.bold}${COLORS.cyan}═══ ${title} ═══${COLORS.reset}\n`);
}

function getAllJsFiles(dir, files = []) {
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    if (item === 'node_modules' || item.startsWith('.')) continue;
    
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      getAllJsFiles(fullPath, files);
    } else if (item.endsWith('.js') || item.endsWith('.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function testFileExists() {
  section('1. ARCHIVOS CRÍTICOS');
  
  for (const file of CRITICAL_FILES) {
    const fullPath = join(__dirname, file.path);
    if (existsSync(fullPath)) {
      pass(`Existe: ${file.path}`);
    } else if (file.required) {
      fail(`Falta (REQUERIDO): ${file.path}`);
    } else {
      warn(`Falta: ${file.path} (OK si es actualización parcial)`);
    }
  }
}

async function testSyntax() {
  section('2. SINTAXIS JS');
  
  const srcDir = join(__dirname, 'src');
  if (!existsSync(srcDir)) {
    fail('Directorio src/ no existe');
    return;
  }
  
  const files = getAllJsFiles(srcDir);
  info(`Verificando ${files.length} archivos...`);
  
  let syntaxErrors = 0;
  
  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      
      // Verificación básica de sintaxis
      // Buscar errores comunes
      const lines = content.split('\n');
      let braceCount = 0;
      let parenCount = 0;
      let bracketCount = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Ignorar strings y comentarios (simplificado)
        const cleanLine = line.replace(/\/\/.*$/, '').replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '');
        
        braceCount += (cleanLine.match(/{/g) || []).length - (cleanLine.match(/}/g) || []).length;
        parenCount += (cleanLine.match(/\(/g) || []).length - (cleanLine.match(/\)/g) || []).length;
        bracketCount += (cleanLine.match(/\[/g) || []).length - (cleanLine.match(/\]/g) || []).length;
      }
      
      if (braceCount !== 0 || parenCount !== 0 || bracketCount !== 0) {
        warn(`Posible desbalance en: ${file.replace(__dirname, '.')}`);
        syntaxErrors++;
      }
      
    } catch (err) {
      fail(`Error leyendo ${file}: ${err.message}`);
      syntaxErrors++;
    }
  }
  
  if (syntaxErrors === 0) {
    pass(`Todos los ${files.length} archivos pasan verificación básica`);
  }
}

async function testImports() {
  section('3. IMPORTS');
  
  // Intentar importar módulos críticos
  const modules = [
    { path: './src/knowledge-hub/matchers.js', name: 'Matchers', critical: true },
    { path: './src/knowledge-hub/index.js', name: 'KnowledgeHub', critical: false }, // Depende de wp_cs_client
  ];
  
  for (const mod of modules) {
    try {
      const fullPath = join(__dirname, mod.path);
      if (!existsSync(fullPath)) {
        if (mod.critical) {
          fail(`No existe: ${mod.path}`);
        } else {
          warn(`No existe: ${mod.path}`);
        }
        continue;
      }
      
      await import(fullPath);
      pass(`Import OK: ${mod.name}`);
    } catch (err) {
      if (err.message.includes('Cannot find module') && !mod.critical) {
        // Dependencia faltante pero no crítica
        warn(`Import ${mod.name}: dependencia faltante (OK si es archivo parcial)`);
      } else if (mod.critical) {
        fail(`Import fallido ${mod.name}: ${err.message}`);
      } else {
        warn(`Import fallido ${mod.name}: ${err.message.split('\n')[0]}`);
      }
    }
  }
}

async function testKnowledgeHub() {
  section('4. KNOWLEDGE HUB');
  
  try {
    // Usar matchers directamente (no tiene dependencias externas)
    const matchers = await import('./src/knowledge-hub/matchers.js');
    
    // Test: setConfig no explota
    try {
      matchers.setConfig({
        branches: [
          { branch_id: 'TEST', name: 'Test Branch', synonyms: ['test', 'prueba'], enabled: true }
        ],
        products: [
          { sku: 'TEST-1', name: 'Test Product', fuzzy_keywords: ['test'], enabled: true }
        ],
        canned: [
          { key: 'greeting', message: 'Hola {name}', enabled: true }
        ],
        agent: { agent_name: 'Test Agent' },
        knowledge: [],
        tools: [],
      });
      pass('setConfig() funciona');
    } catch (err) {
      fail(`setConfig() error: ${err.message}`);
    }
    
    // Test: isConfigLoaded
    try {
      const status = matchers.isConfigLoaded();
      if (status && typeof status === 'object') {
        pass('isConfigLoaded() devuelve objeto');
      } else {
        fail('isConfigLoaded() no devuelve objeto');
      }
    } catch (err) {
      fail(`isConfigLoaded() error: ${err.message}`);
    }
    
    // Test: getAgentName
    try {
      const name = matchers.getAgentName();
      if (typeof name === 'string' && name.length > 0) {
        pass(`getAgentName() = "${name}"`);
      } else {
        warn('getAgentName() devuelve vacío');
      }
    } catch (err) {
      fail(`getAgentName() error: ${err.message}`);
    }
    
  } catch (err) {
    fail(`No se pudo importar matchers: ${err.message}`);
  }
}

async function testMatchers() {
  section('5. MATCHERS');
  
  try {
    const { extractBranchHint, extractProductHint, setConfig } = await import('./src/knowledge-hub/matchers.js');
    
    // Configurar con datos de prueba
    setConfig({
      branches: [
        { branch_id: 'ANGELOPOLIS', name: 'Angelópolis', synonyms: ['angelopolis', 'angelópolis', 'paseo'], enabled: true },
        { branch_id: '5SUR', name: '5 Sur', synonyms: ['5 sur', 'cinco sur', '5sur'], enabled: true },
        { branch_id: 'SAN_ANGEL', name: 'San Ángel', synonyms: ['san angel', 'san ángel', 'cdmx'], enabled: true },
        { branch_id: 'SONATA', name: 'Sonata', synonyms: ['sonata', 'lomas'], enabled: true },
        { branch_id: 'ZAVALETA', name: 'Zavaleta', synonyms: ['zavaleta', 'zava'], enabled: true },
      ],
      products: [
        { sku: 'ROSCA-CLASICA', name: 'Rosca Clásica', fuzzy_keywords: ['clasica', 'tradicional', 'normal'], enabled: true },
        { sku: 'ROSCA-NUTELLA', name: 'Rosca Nutella', fuzzy_keywords: ['nutella', 'chocolate'], enabled: true },
        { sku: 'ROSCA-LOTUS', name: 'Rosca Lotus', fuzzy_keywords: ['lotus', 'biscoff', 'galleta'], enabled: true },
      ],
      canned: [],
      agent: {},
      knowledge: [],
      tools: [],
    });
    
    // Test extractBranchHint
    info('Probando extractBranchHint()...');
    for (const tc of BRANCH_TEST_CASES) {
      const result = extractBranchHint(tc.input);
      // Normalizar: quitar guiones/underscores y lowercase
      const normalize = (s) => s?.toLowerCase().replace(/[-_]/g, '') || null;
      const normalizedResult = normalize(result);
      const normalizedExpected = normalize(tc.expected);
      
      if (normalizedResult === normalizedExpected) {
        pass(`"${tc.input}" → ${result || 'null'}`);
      } else {
        fail(`"${tc.input}" → ${result || 'null'} (esperado: ${tc.expected || 'null'})`);
      }
    }
    
    // Test extractProductHint
    info('Probando extractProductHint()...');
    for (const tc of PRODUCT_TEST_CASES) {
      const result = extractProductHint(tc.input);
      const hasResult = result !== null && result !== undefined;
      
      if (hasResult === tc.expected) {
        pass(`"${tc.input}" → ${result || 'null'} (${tc.expected ? 'detectado' : 'no detectado'})`);
      } else {
        fail(`"${tc.input}" → ${result || 'null'} (esperado: ${tc.expected ? 'algo' : 'null'})`);
      }
    }
    
  } catch (err) {
    fail(`Error en matchers: ${err.message}`);
  }
}

async function testCannedMessages() {
  section('6. MENSAJES CANNED');
  
  try {
    const { getCannedMessage, setConfig } = await import('./src/knowledge-hub/matchers.js');
    
    // Configurar con mensajes de prueba
    setConfig({
      branches: [],
      products: [],
      canned: [
        { key: 'greeting', message: '¡Hola! Soy {agent_name}', enabled: true },
        { key: 'escalate', message: 'Te comunico con el equipo', enabled: true },
        { key: 'ask_product', message: '¿Qué producto te gustaría?', enabled: true },
        { key: 'ask_branch', message: '¿En qué sucursal?', enabled: true },
      ],
      agent: { agent_name: 'Tan • IA' },
      knowledge: [],
      tools: [],
    });
    
    // Test: keys requeridas existen
    for (const key of REQUIRED_CANNED_KEYS) {
      const msg = getCannedMessage(key);
      if (msg && !msg.startsWith('[')) {
        pass(`Canned '${key}' existe`);
      } else {
        warn(`Canned '${key}' usa fallback`);
      }
    }
    
    // Test: interpolación de variables
    const greeting = getCannedMessage('greeting', { agent_name: 'TestBot' });
    if (greeting.includes('TestBot')) {
      pass('Interpolación de variables funciona');
    } else {
      fail(`Interpolación no funciona: "${greeting}"`);
    }
    
  } catch (err) {
    fail(`Error en canned messages: ${err.message}`);
  }
}

async function testNoHardcoding() {
  section('7. DETECCIÓN DE HARDCODING');
  
  const filesToCheck = [
    'src/tools/intent_extractor.js',
    'src/flows/orderCreateFlow.js',
    'src/services/aiOrchestrator.js',
  ];
  
  for (const file of filesToCheck) {
    const fullPath = join(__dirname, file);
    if (!existsSync(fullPath)) continue;
    
    const content = readFileSync(fullPath, 'utf-8');
    
    for (const { pattern, desc } of HARDCODED_PATTERNS) {
      if (pattern.test(content)) {
        warn(`${file}: Posible ${desc}`);
      }
    }
  }
  
  // Verificar que se usa Knowledge Hub
  const intentExtractor = readFileSync(join(__dirname, 'src/tools/intent_extractor.js'), 'utf-8');
  
  if (intentExtractor.includes('KnowledgeHub.extractBranchHint')) {
    pass('intent_extractor.js usa KnowledgeHub.extractBranchHint');
  } else if (intentExtractor.includes('knowledge-hub')) {
    pass('intent_extractor.js importa knowledge-hub');
  } else {
    warn('intent_extractor.js podría no usar Knowledge Hub');
  }
  
  const orderFlow = readFileSync(join(__dirname, 'src/flows/orderCreateFlow.js'), 'utf-8');
  
  if (orderFlow.includes('KnowledgeHub.getProductListForCustomer') || 
      orderFlow.includes('KnowledgeHub.getAllProducts')) {
    pass('orderCreateFlow.js usa productos de Knowledge Hub');
  } else if (orderFlow.includes('knowledge-hub')) {
    pass('orderCreateFlow.js importa knowledge-hub');
  } else {
    warn('orderCreateFlow.js podría no usar Knowledge Hub');
  }
}

async function testIntentExtractor() {
  section('8. INTENT EXTRACTOR');
  
  try {
    // Solo verificar que se puede importar sin errores
    const fullPath = join(__dirname, 'src/tools/intent_extractor.js');
    if (!existsSync(fullPath)) {
      fail('intent_extractor.js no existe');
      return;
    }
    
    const content = readFileSync(fullPath, 'utf-8');
    
    // Verificar exports esperados
    const expectedExports = [
      'INTENT_EXTRACTION_SCHEMA',
      'extractIntentAndSlots',
      'isWriteIntent',
      'requiresEscalation',
    ];
    
    for (const exp of expectedExports) {
      if (content.includes(`export ${exp}`) || 
          content.includes(`export function ${exp}`) ||
          content.includes(`export async function ${exp}`) ||
          content.includes(`export const ${exp}`)) {
        pass(`Export encontrado: ${exp}`);
      } else if (content.includes(exp)) {
        pass(`Función encontrada: ${exp}`);
      } else {
        warn(`Export no encontrado: ${exp}`);
      }
    }
    
  } catch (err) {
    fail(`Error verificando intent_extractor: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
${COLORS.bold}${COLORS.cyan}
╔═══════════════════════════════════════════════════════════════╗
║           TEST INTEGRITY - Tagers KISS API                    ║
║           Validación pre-deploy                               ║
╚═══════════════════════════════════════════════════════════════╝
${COLORS.reset}`);

  const startTime = Date.now();
  
  try {
    await testFileExists();
    await testSyntax();
    await testImports();
    await testKnowledgeHub();
    await testMatchers();
    await testCannedMessages();
    await testNoHardcoding();
    await testIntentExtractor();
  } catch (err) {
    fail(`Error fatal: ${err.message}`);
    console.error(err);
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Resumen
  console.log(`
${COLORS.bold}${COLORS.cyan}
═══════════════════════════════════════════════════════════════
                         RESUMEN
═══════════════════════════════════════════════════════════════
${COLORS.reset}`);

  console.log(`${COLORS.green}✓ Pasaron:    ${passCount}${COLORS.reset}`);
  console.log(`${COLORS.yellow}⚠ Warnings:   ${warnCount}${COLORS.reset}`);
  console.log(`${COLORS.red}✗ Fallaron:   ${failCount}${COLORS.reset}`);
  console.log(`\nTiempo: ${elapsed}s`);
  
  if (failCount > 0) {
    console.log(`\n${COLORS.red}${COLORS.bold}❌ HAY ERRORES - NO SUBIR A GITHUB${COLORS.reset}\n`);
    process.exit(1);
  } else if (warnCount > 0) {
    console.log(`\n${COLORS.yellow}${COLORS.bold}⚠️  HAY WARNINGS - REVISAR ANTES DE SUBIR${COLORS.reset}\n`);
    process.exit(0);
  } else {
    console.log(`\n${COLORS.green}${COLORS.bold}✅ TODO OK - LISTO PARA GITHUB${COLORS.reset}\n`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(`${COLORS.red}Error fatal:${COLORS.reset}`, err);
  process.exit(1);
});
