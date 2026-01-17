# 📊 LUCA Google Sheets Template

Esta es la plantilla de Google Sheets para configurar LUCA sin hardcode.

**Sheet ID:** Usar el mismo que KISS (`GOOGLE_SHEET_ID`) o crear uno nuevo (`LUCA_CONFIG_SHEET_ID`)

---

## Pestañas Requeridas

Todas las pestañas deben tener el prefijo `LUCA_`

---

### 1. LUCA_BRANCHES (Sucursales)

| branch_id | name | city | lat | lon | type | daily_sales_baseline | avg_ticket | daily_transactions | peak_factor | open_hour | close_hour | school_density | enabled |
|-----------|------|------|-----|-----|------|---------------------|------------|-------------------|-------------|-----------|------------|----------------|---------|
| SUC-ANG | Angelópolis | Puebla | 19.027 | -98.226 | flagship | 85000 | 185 | 460 | 1.8 | 07:00 | 22:00 | high | TRUE |
| SUC-ZAV | Zavaleta | Puebla | 19.012 | -98.215 | standard | 55000 | 165 | 335 | 1.6 | 07:00 | 21:00 | medium | TRUE |
| SUC-POL | Polanco | CDMX | 19.433 | -99.197 | premium | 120000 | 220 | 545 | 2.0 | 07:00 | 23:00 | medium | TRUE |
| SUC-CON | Condesa | CDMX | 19.411 | -99.174 | trendy | 75000 | 195 | 385 | 1.7 | 07:30 | 22:00 | medium | TRUE |
| SUC-ROM | Roma | CDMX | 19.420 | -99.162 | trendy | 78000 | 190 | 410 | 1.7 | 07:30 | 22:00 | medium | TRUE |
| SUC-COY | Coyoacán | CDMX | 19.347 | -99.162 | family | 95000 | 175 | 545 | 1.9 | 07:00 | 21:30 | high | TRUE |

**Columnas:**
- `branch_id` - ID único de sucursal (usado en todo LUCA)
- `name` - Nombre de la sucursal
- `city` - Ciudad (Puebla o CDMX)
- `lat`, `lon` - Coordenadas para clima y eventos
- `type` - Tipo: flagship, standard, premium, trendy, family
- `daily_sales_baseline` - Ventas diarias promedio en MXN
- `avg_ticket` - Ticket promedio en MXN
- `daily_transactions` - Transacciones diarias promedio
- `peak_factor` - Multiplicador en hora pico (1.5 = +50%)
- `open_hour`, `close_hour` - Horario de operación
- `school_density` - Densidad de escuelas: high, medium, low
- `enabled` - TRUE para activar

---

### 2. LUCA_STAFFING (Personal por Turno)

| branch_id | shift | baristas | kitchen | floor | cashier | enabled |
|-----------|-------|----------|---------|-------|---------|---------|
| SUC-ANG | morning | 3 | 4 | 2 | 2 | TRUE |
| SUC-ANG | afternoon | 4 | 5 | 3 | 2 | TRUE |
| SUC-ANG | evening | 3 | 4 | 2 | 2 | TRUE |
| SUC-POL | morning | 4 | 5 | 3 | 2 | TRUE |
| SUC-POL | afternoon | 5 | 6 | 4 | 3 | TRUE |
| SUC-POL | evening | 4 | 5 | 3 | 2 | TRUE |

**Columnas:**
- `branch_id` - ID de sucursal (debe existir en LUCA_BRANCHES)
- `shift` - Turno: morning, afternoon, evening
- `baristas`, `kitchen`, `floor`, `cashier` - Número de empleados por rol

---

### 3. LUCA_THRESHOLDS (Umbrales de Detección)

| detector_id | metric | threshold | severity | description | enabled |
|-------------|--------|-----------|----------|-------------|---------|
| fraud | discount_anomaly | 15 | HIGH | % descuento anormal | TRUE |
| fraud | time_concentration | 0.4 | MEDIUM | Concentración horaria | TRUE |
| fraud | cash_preference | 0.7 | MEDIUM | % preferencia efectivo | TRUE |
| fraud | sweethearting_score | 0.6 | HIGH | Score mínimo para alerta | TRUE |
| forense | sales_drop | -10 | HIGH | % caída de ventas | TRUE |
| forense | discount_rate_change | 15 | MEDIUM | % cambio tasa descuento | TRUE |
| forense | refund_rate_change | 5 | MEDIUM | % cambio tasa devolución | TRUE |
| churn | health_score | 0.5 | MEDIUM | Score mínimo saludable | TRUE |
| churn | signals_count | 2 | HIGH | # señales para actuar | TRUE |
| inventory | stock_days | 3 | MEDIUM | Días mínimos de stock | TRUE |
| inventory | waste_percent | 5 | HIGH | % máximo de merma | TRUE |

**Columnas:**
- `detector_id` - ID del detector: fraud, forense, churn, inventory, staffing
- `metric` - Nombre de la métrica
- `threshold` - Valor umbral (número o porcentaje)
- `severity` - Severidad: LOW, MEDIUM, HIGH, CRITICAL
- `description` - Descripción para humanos

---

### 4. LUCA_WEATHER (Impacto del Clima)

| condition | dine_in | delivery | takeaway | beverages_cold | beverages_hot | bakery | enabled |
|-----------|---------|----------|----------|----------------|---------------|--------|---------|
| clear | 0 | 0 | 0 | 0 | 0 | 0 | TRUE |
| partly_cloudy | 0 | 0 | 0 | 0 | 0 | 0 | TRUE |
| cloudy | -0.05 | 0.05 | 0 | 0 | 0.05 | 0 | TRUE |
| light_rain | -0.10 | 0.10 | -0.05 | 0 | 0.05 | 0 | TRUE |
| rain | -0.20 | 0.15 | -0.10 | 0 | 0.10 | 0.05 | TRUE |
| heavy_rain | -0.35 | 0.25 | -0.20 | 0 | 0.15 | 0.10 | TRUE |
| thunderstorm | -0.40 | -0.20 | -0.30 | 0 | 0.10 | 0 | TRUE |
| drizzle | -0.05 | 0.05 | -0.05 | 0 | 0.05 | 0 | TRUE |
| extreme_heat | -0.10 | 0.20 | -0.05 | 0.30 | -0.20 | -0.10 | TRUE |
| cold | 0.05 | -0.05 | 0 | -0.15 | 0.25 | 0.15 | TRUE |

**Columnas:**
- `condition` - Condición climática
- `dine_in`, `delivery`, `takeaway` - Impacto por canal (-0.20 = -20%)
- `beverages_cold`, `beverages_hot`, `bakery` - Impacto por categoría

---

### 5. LUCA_HOLIDAYS (Feriados y Temporadas)

| date | name | type | sales_impact | category_impact | notes | enabled |
|------|------|------|--------------|-----------------|-------|---------|
| 01-01 | Año Nuevo | national | 0.5 | | Cerrado medio día | TRUE |
| 01-06 | Día de Reyes | commercial | 2.0 | rosca:3.0 | TEMPORADA ROSCA | TRUE |
| 02-14 | San Valentín | commercial | 1.5 | postres:2.0 | | TRUE |
| 02-24 | Día de la Bandera | national | 1.0 | | | TRUE |
| 03-21 | Natalicio Benito Juárez | national | 0.9 | | Puente común | TRUE |
| 05-01 | Día del Trabajo | national | 0.5 | | Cerrado | TRUE |
| 05-05 | Batalla de Puebla | regional | 1.1 | | Solo Puebla | TRUE |
| 05-10 | Día de las Madres | commercial | 1.8 | pasteles:2.5 | Segundo pico del año | TRUE |
| 09-15 | Grito de Independencia | national | 1.5 | | Noche mexicana | TRUE |
| 09-16 | Día de la Independencia | national | 1.2 | | | TRUE |
| 10-31 | Halloween | commercial | 1.3 | postres:1.5 | | TRUE |
| 11-01 | Día de Todos los Santos | cultural | 1.4 | pan_muerto:2.5 | PAN DE MUERTO | TRUE |
| 11-02 | Día de Muertos | cultural | 1.5 | pan_muerto:2.5 | PAN DE MUERTO | TRUE |
| 11-20 | Revolución Mexicana | national | 0.9 | | Puente común | TRUE |
| 12-12 | Día de la Virgen | religious | 1.1 | | | TRUE |
| 12-24 | Nochebuena | family | 0.8 | | Cierre temprano | TRUE |
| 12-25 | Navidad | national | 0.5 | | Cerrado | TRUE |
| 12-31 | Fin de Año | family | 0.7 | | Cierre temprano | TRUE |

**Columnas:**
- `date` - Fecha en formato MM-DD
- `name` - Nombre del feriado
- `type` - Tipo: national, commercial, cultural, religious, regional, family
- `sales_impact` - Multiplicador de ventas (1.0 = normal, 2.0 = doble)
- `category_impact` - Impacto por categoría (formato: categoria:factor)
- `notes` - Notas adicionales

---

### 6. LUCA_SEASONS (Temporadas Especiales)

| season_id | name | start_date | end_date | sales_impact | category_impact | enabled |
|-----------|------|------------|----------|--------------|-----------------|---------|
| rosca | Temporada de Rosca | 01-02 | 01-06 | 2.0 | rosca:3.0 | TRUE |
| pan_muerto | Pan de Muerto | 10-15 | 11-02 | 1.5 | pan_muerto:2.5 | TRUE |
| navidad | Temporada Navideña | 12-01 | 12-23 | 1.2 | pasteles:1.5 | TRUE |
| verano | Vacaciones Verano | 07-15 | 08-20 | 0.85 | bebidas_frias:1.3 | TRUE |
| semana_santa | Semana Santa | variable | variable | 0.75 | | TRUE |

**Columnas:**
- `season_id` - ID de temporada
- `name` - Nombre
- `start_date`, `end_date` - Fechas en formato MM-DD (o "variable")
- `sales_impact` - Multiplicador
- `category_impact` - Impacto por categoría

---

### 7. LUCA_FRAUD (Patrones de Fraude)

| pattern_id | name | weight_time | weight_discount | weight_employee | weight_sequence | weight_amount | min_score | enabled |
|------------|------|-------------|-----------------|-----------------|-----------------|---------------|-----------|---------|
| orphan_tickets | Tickets Huérfanos | 0.20 | 0.10 | 0.30 | 0.15 | 0.25 | 0.5 | TRUE |
| sweethearting | Descuentos a Conocidos | 0.15 | 0.25 | 0.20 | 0.15 | 0.15 | 0.6 | TRUE |
| price_anomaly | Anomalía de Precio | 0.10 | 0.30 | 0.20 | 0.10 | 0.30 | 0.5 | TRUE |
| time_concentration | Concentración Horaria | 0.40 | 0.10 | 0.20 | 0.20 | 0.10 | 0.5 | TRUE |
| cash_preference | Preferencia Efectivo | 0.15 | 0.15 | 0.25 | 0.15 | 0.30 | 0.6 | TRUE |
| collusion | Posible Colusión | 0.20 | 0.15 | 0.30 | 0.20 | 0.15 | 0.7 | TRUE |
| void_pattern | Patrón de Cancelaciones | 0.25 | 0.10 | 0.25 | 0.25 | 0.15 | 0.6 | TRUE |
| refund_anomaly | Anomalía Devoluciones | 0.20 | 0.15 | 0.25 | 0.20 | 0.20 | 0.6 | TRUE |

**Columnas:**
- `pattern_id` - ID del patrón
- `name` - Nombre descriptivo
- `weight_*` - Pesos para calcular score (deben sumar ~1.0)
- `min_score` - Score mínimo para generar alerta

---

### 8. LUCA_CAPACITY (Capacidades por Rol)

| role | drinks_per_hour | dishes_per_hour | customers_per_hour | transactions_per_hour | cost_per_hour | enabled |
|------|-----------------|-----------------|--------------------|-----------------------|---------------|---------|
| barista | 30 | | | | 85 | TRUE |
| kitchen | | 12 | | | 80 | TRUE |
| floor | | | 20 | | 70 | TRUE |
| cashier | | | | 45 | 75 | TRUE |
| manager | | | 30 | 20 | 120 | TRUE |

**Columnas:**
- `role` - Nombre del rol
- `*_per_hour` - Capacidad por hora (solo el relevante)
- `cost_per_hour` - Costo por hora en MXN

---

### 9. LUCA_ROI (Valores de Referencia)

| key | value | unit | description | enabled |
|-----|-------|------|-------------|---------|
| customer_lifetime_value | 5000 | MXN | CLV promedio | TRUE |
| employee_turnover_cost | 15000 | MXN | Costo de rotación | TRUE |
| avg_margin | 0.35 | ratio | Margen promedio | TRUE |
| hourly_employee_cost | 150 | MXN | Costo promedio/hora | TRUE |
| openai_monthly_cost | 5000 | MXN | Costo API mensual | TRUE |
| infrastructure_monthly | 3000 | MXN | Railway, Redis, etc | TRUE |
| maintenance_monthly | 2000 | MXN | Tiempo mantenimiento | TRUE |
| fraud_recovery_rate | 0.30 | ratio | % fraude recuperable | TRUE |
| churn_recovery_rate | 0.20 | ratio | % churn recuperable | TRUE |

**Columnas:**
- `key` - Clave única
- `value` - Valor numérico
- `unit` - Unidad (MXN, ratio, percent, etc)
- `description` - Descripción

---

### 10. LUCA_AUTONOMY (Niveles de Autonomía)

| level | name | max_impact_mxn | requires_approval | auto_execute | notify_always | description | enabled |
|-------|------|----------------|-------------------|--------------|---------------|-------------|---------|
| 0 | Solo Observar | 0 | TRUE | FALSE | TRUE | Solo reporta | TRUE |
| 1 | Notificar | 0 | TRUE | FALSE | TRUE | Notifica y sugiere | TRUE |
| 2 | Proponer | 5000 | TRUE | FALSE | TRUE | Crea acciones pendientes | TRUE |
| 3 | Auto-Aprobar Bajo | 5000 | FALSE | TRUE | TRUE | Ejecuta <$5K auto | TRUE |
| 4 | Auto-Aprobar Medio | 20000 | FALSE | TRUE | TRUE | Ejecuta <$20K auto | TRUE |
| 5 | Autónomo Total | 999999 | FALSE | TRUE | FALSE | Ejecuta todo, notifica post | TRUE |

**Columnas:**
- `level` - Nivel numérico (0-5)
- `name` - Nombre del nivel
- `max_impact_mxn` - Impacto máximo para auto-ejecutar
- `requires_approval` - Si requiere aprobación humana
- `auto_execute` - Si puede ejecutar automáticamente
- `notify_always` - Si siempre notifica

---

### 11. LUCA_DAY_PATTERNS (Patrones por Día)

| day_of_week | day_name | sales_factor | peak_hours | enabled |
|-------------|----------|--------------|------------|---------|
| 0 | Domingo | 1.15 | 10:00-14:00 | TRUE |
| 1 | Lunes | 0.85 | 08:00-10:00,13:00-15:00 | TRUE |
| 2 | Martes | 0.90 | 08:00-10:00,13:00-15:00 | TRUE |
| 3 | Miércoles | 0.95 | 08:00-10:00,13:00-15:00 | TRUE |
| 4 | Jueves | 1.00 | 08:00-10:00,13:00-15:00 | TRUE |
| 5 | Viernes | 1.10 | 08:00-10:00,13:00-15:00,19:00-21:00 | TRUE |
| 6 | Sábado | 1.20 | 09:00-14:00,19:00-21:00 | TRUE |

---

### 12. LUCA_HOUR_PATTERNS (Patrones por Hora)

| hour | pattern_factor | description | enabled |
|------|----------------|-------------|---------|
| 7 | 0.6 | Apertura | TRUE |
| 8 | 1.2 | Desayuno pico | TRUE |
| 9 | 1.4 | Desayuno pico | TRUE |
| 10 | 1.0 | Media mañana | TRUE |
| 11 | 0.8 | Pre-comida | TRUE |
| 12 | 1.0 | Comida inicio | TRUE |
| 13 | 1.5 | Comida pico | TRUE |
| 14 | 1.4 | Comida pico | TRUE |
| 15 | 0.7 | Valle | TRUE |
| 16 | 0.5 | Valle | TRUE |
| 17 | 0.6 | Pre-cena | TRUE |
| 18 | 0.9 | Cena inicio | TRUE |
| 19 | 1.2 | Cena | TRUE |
| 20 | 1.1 | Cena | TRUE |
| 21 | 0.8 | Cierre | TRUE |
| 22 | 0.5 | Cierre | TRUE |

---

## Variables de Entorno

```bash
# Opción 1: Usar el mismo Sheet que KISS
GOOGLE_SHEET_ID=tu_sheet_id

# Opción 2: Sheet separado para LUCA
LUCA_CONFIG_SHEET_ID=tu_luca_sheet_id

# Autenticación (ya deberías tenerlas)
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

---

## Uso en Código

```javascript
import { lucaConfigHub } from './config/LucaConfigHub.js';

// Inicializar (en server.js)
lucaConfigHub.startPeriodicRefresh();

// Usar en cualquier parte
const branch = lucaConfigHub.getBranch('SUC-POL');
const threshold = lucaConfigHub.getThreshold('fraud', 'discount_anomaly');
const weatherImpact = lucaConfigHub.getWeatherImpact('rain');
const clv = lucaConfigHub.getRoiValue('customer_lifetime_value');
```

---

## API Endpoints

```bash
# Health
GET /api/luca/config/health

# Refresh manual
POST /api/luca/config/refresh

# Branches
GET /api/luca/config/branches
GET /api/luca/config/branches/SUC-POL

# Thresholds
GET /api/luca/config/thresholds
GET /api/luca/config/thresholds?detector=fraud
GET /api/luca/config/thresholds/fraud/discount_anomaly

# Weather
GET /api/luca/config/weather
GET /api/luca/config/weather/rain

# Holidays
GET /api/luca/config/holidays
GET /api/luca/config/holidays/01-06

# Raw sheets
GET /api/luca/config/sheets
GET /api/luca/config/sheets/branches
```

---

## Notas Importantes

1. **Todas las pestañas deben tener el prefijo `LUCA_`**
2. **La columna `enabled` permite desactivar filas sin borrarlas**
3. **Los tipos se convierten automáticamente** (números, booleanos)
4. **El cache se refresca cada 5 minutos**
5. **Si falla el Sheet, se usan valores por defecto**
6. **Los cambios en el Sheet se reflejan sin deploy**

---

## Migración desde Hardcode

Una vez creado el Sheet con estas pestañas, el código de LUCA usará automáticamente los valores del Sheet en lugar de los hardcodeados.

Archivos a actualizar (ya no tendrán hardcode):
- `twin/BranchTwin.js` → Usa `lucaConfigHub.getBranch()`
- `twin/CapacityModel.js` → Usa `lucaConfigHub.getRoleCapacity()`
- `integrations/weather/WeatherImpact.js` → Usa `lucaConfigHub.getWeatherImpact()`
- `integrations/calendar/MexicoHolidays.js` → Usa `lucaConfigHub.getAllHolidays()`
- `metrics/ROICalculator.js` → Usa `lucaConfigHub.getRoiValue()`
- `autonomy/AutonomyLevels.js` → Usa `lucaConfigHub.getAutonomyLevel()`
