<?php
/**
 * Plugin Name: Tagers KISS Unified
 * Plugin URI: https://tagers.com
 * Description: Sistema unificado de operaciones y servicio al cliente para Tagers
 * Version: 1.3.0
 * Author: Tagers Development Team
 * License: Proprietary
 * Text Domain: tagers-kiss
 * Requires PHP: 8.0
 * 
 * MODULOS INCLUIDOS:
 * - CS (Customer Service): Endpoints para bot Tania
 * - OPS (Operations): Endpoints para dashboards operativos
 * - Bridge: Reenvio de beacons a KISS API
 * - CEDIS: Produccion y manifiestos
 * - Runner: Entregas
 * 
 * ENDPOINTS:
 * /tagers-cs/v1/*      -> Customer Service (Bot Tania)
 * /tagers-ops/v1/*     -> Operations dashboards
 * /tagers-kiss/v1/*    -> Bridge (beacon forwarding)
 * /tagers-cedis/v1/*   -> CEDIS/Produccion
 * /tagers-runner/v1/*  -> Runner/Entregas
 */

if (!defined('ABSPATH')) exit;

define('TAGERS_KISS_VERSION', '1.3.0');
define('TAGERS_KISS_PLUGIN_DIR', plugin_dir_path(__FILE__));
define('TAGERS_KISS_PLUGIN_URL', plugin_dir_url(__FILE__));

// ACTIVATION HOOK - ANTES DE LA CLASE
register_activation_hook(__FILE__, 'tagers_kiss_activate');

function tagers_kiss_activate() {
    global $wpdb;
    $charset = $wpdb->get_charset_collate();
    
    $sql = "CREATE TABLE IF NOT EXISTS {$wpdb->prefix}tagers_kiss_log (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event VARCHAR(100) NOT NULL,
        module VARCHAR(50) NOT NULL,
        data LONGTEXT,
        ip VARCHAR(45),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_event (event),
        INDEX idx_module (module),
        INDEX idx_created (created_at)
    ) $charset;";
    
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
    
    $tokens = ['cs', 'ops', 'cedis', 'runner', 'bridge'];
    foreach ($tokens as $token) {
        $option_name = "tagers_token_{$token}";
        if (!get_option($option_name)) {
            update_option($option_name, "tagers_{$token}_" . wp_generate_password(16, false));
        }
    }
    
    foreach ($tokens as $mod) {
        if (get_option("tagers_module_{$mod}") === false) {
            update_option("tagers_module_{$mod}", true);
        }
    }
    
    update_option('tagers_kiss_db_version', '1.0.2');
    flush_rewrite_rules();
}

class Tagers_KISS_Unified {
    
    private static $instance = null;
    public $config = [];
    public $sucursales = [];
    public $productos_rosca = [];
    
    public static function instance() {
        if (is_null(self::$instance)) {
            self::$instance = new self();
        }
        return self::$instance;
    }
    
    private function __construct() {
        $this->load_config();
        $this->ensure_tokens();
        $this->load_shared_data();
        $this->init_hooks();
    }
    
    private function load_config() {
        $this->config = [
            'tokens' => [
                'cs'     => get_option('tagers_token_cs', ''),
                'ops'    => get_option('tagers_token_ops', ''),
                'cedis'  => get_option('tagers_token_cedis', ''),
                'runner' => get_option('tagers_token_runner', ''),
                'bridge' => get_option('tagers_token_bridge', ''),
            ],
            'kiss_api_url'    => get_option('tagers_kiss_api_url', ''),
            'kiss_api_secret' => get_option('tagers_kiss_api_secret', ''),
            'modules' => [
                'cs'     => get_option('tagers_module_cs', true),
                'ops'    => get_option('tagers_module_ops', true),
                'bridge' => get_option('tagers_module_bridge', true),
                'cedis'  => get_option('tagers_module_cedis', true),
                'runner' => get_option('tagers_module_runner', true),
            ],
        ];
    }

    /**
     * Ensure critical tokens exist and persist.
     *
     * Why: in some environments activation hooks may not run (mu-plugins) or
     * security layers may prevent options.php from persisting token fields.
     * This method self-heals missing/empty tokens so CS/Ops endpoints keep working.
     */
    private function ensure_tokens() {
        $keys = ['cs', 'ops', 'cedis', 'runner', 'bridge'];
        foreach ($keys as $k) {
            $opt = "tagers_token_{$k}";
            $v = (string) get_option($opt, '');
            if ($v === '') {
                $v = "tagers_{$k}_" . wp_generate_password(16, false);
                update_option($opt, $v);
            }

            if (!isset($this->config['tokens']) || !is_array($this->config['tokens'])) {
                $this->config['tokens'] = [];
            }
            $this->config['tokens'][$k] = $v;
        }
    }

    private function get_json_option($key, $default) {
        $raw = get_option($key, null);
        if ($raw === null || $raw === '') return $default;
        if (is_array($raw)) return $raw;
        $decoded = json_decode((string)$raw, true);
        return is_array($decoded) ? $decoded : $default;
    }

    private function get_assistant_config() {
        // Try to get from Ana Config Hub first
        $ana_config = tagers_ana_get_config();
        
        if (!empty($ana_config)) {
            $brand = $ana_config['brand'] ?? [];
            $persona = $ana_config['persona'] ?? [];
            
            return [
                'philosophy' => $brand['description'] ?? '',
                'tone' => $persona['tone'] ?? '',
                'do' => $persona['always_do'] ?? '',
                'dont' => $persona['do_not'] ?? '',
                'links' => [
                    'careers' => $brand['trabaja_url'] ?? 'https://tagers2.buk.mx/trabaja-con-nosotros',
                    'website' => $brand['website'] ?? 'https://tagers.com',
                    'whatsapp' => $brand['whatsapp_url'] ?? '',
                    'facturacion' => $brand['facturacion_url'] ?? '',
                ],
                'faqs' => $ana_config['faq'] ?? [],
                'routing' => [
                    'lead_branch_id' => 'HQ',
                ],
                'order' => [
                    'mode' => (string) get_option('tagers_cs_order_mode', 'checkout_link'),
                    'rosca_wc_product_map' => $this->get_json_option('tagers_rosca_wc_product_map_json', []),
                    'attribute_fecha' => (string) get_option('tagers_rosca_wc_attribute_fecha', 'pa_fecha-de-entrega'),
                    'attribute_sucursal' => (string) get_option('tagers_rosca_wc_attribute_sucursal', 'pa_sucursal-de-entrega'),
                ],
                'source' => 'ana_config_hub',
            ];
        }
        
        // Fallback to legacy WP options
        $links = $this->get_json_option('tagers_assistant_links_json', [
            'careers' => 'https://tagers2.buk.mx/trabaja-con-nosotros',
        ]);
        if (empty($links['careers'])) {
            $links['careers'] = 'https://tagers2.buk.mx/trabaja-con-nosotros';
        }

        $faqs = $this->get_json_option('tagers_assistant_faq_json', []);
        $routing = $this->get_json_option('tagers_assistant_lead_routing_json', [
            'lead_branch_id' => 'HQ',
        ]);
        $rosca_map = $this->get_json_option('tagers_rosca_wc_product_map_json', []);

        return [
            'philosophy' => (string) get_option('tagers_tania_philosophy', ''),
            'tone' => (string) get_option('tagers_tania_tone', ''),
            'do' => (string) get_option('tagers_tania_do', ''),
            'dont' => (string) get_option('tagers_tania_dont', ''),
            'links' => $links,
            'faqs' => $faqs,
            'routing' => $routing,
            'order' => [
                'mode' => (string) get_option('tagers_cs_order_mode', 'checkout_link'),
                'rosca_wc_product_map' => $rosca_map,
                'attribute_fecha' => (string) get_option('tagers_rosca_wc_attribute_fecha', 'pa_fecha-de-entrega'),
                'attribute_sucursal' => (string) get_option('tagers_rosca_wc_attribute_sucursal', 'pa_sucursal-de-entrega'),
            ],
            'source' => 'legacy_wp_options',
        ];
    }

    private function get_promo_public() {
        // Try Ana Config Hub first
        $promo = tagers_ana_get_active_promo();
        if ($promo) {
            return [
                'activa' => true,
                'nombre' => $promo['name'] ?? null,
                'mensaje' => $promo['ux_message'] ?? '',
                'ratio' => $promo['buy_qty'] ?? null,
                'regalo' => $promo['gift_product_name'] ?? null,
                'inicio' => $promo['start_at'] ?? null,
                'fin' => $promo['end_at'] ?? null,
                'source' => 'ana_config_hub',
            ];
        }

        // Fallback: Promo Suite if available
        if (function_exists('tagers_get_promo_config') && function_exists('tagers_is_promo_active')) {
            try {
                $cfg = tagers_get_promo_config();
                $active = tagers_is_promo_active();
                if (is_array($cfg) && $active) {
                    return [
                        'activa' => true,
                        'nombre' => $cfg['nombre_promo'] ?? null,
                        'mensaje' => $cfg['ux_mensaje'] ?? ($cfg['ux_nudge_titulo'] ?? ''),
                        'ratio' => $cfg['ratio'] ?? null,
                        'regalo' => $cfg['gift_id'] ?? null,
                        'inicio' => $cfg['inicio'] ?? null,
                        'fin' => $cfg['fin'] ?? null,
                        'source' => 'promo_suite',
                    ];
                }
            } catch (Exception $e) {
                // fallback below
            }
        }

        return null;
    }
    
    

// ------------------------------------------------------------------
// Helpers: Ops Core compatibility + date conversions
// ------------------------------------------------------------------
private function is_ops_core_active() {
    // Detect Tagers Ops Core plugin (or compatible environment)
    return class_exists('Tagers_Ops_Core') || defined('TAGERS_OPS_META_FECHA') || function_exists('tagers_ops_now_mx');
}

private function looks_like_iso_date($s) {
    return is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s);
}

private function iso_to_fecha_slug($iso) {
    $iso = is_string($iso) ? trim($iso) : '';
    if (!$this->looks_like_iso_date($iso)) return '';

    try {
        $dt = new DateTime($iso, new DateTimeZone('America/Mexico_City'));
    } catch (Exception $e) {
        return '';
    }

    $meses = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    $m = (int)$dt->format('n');
    $d = (int)$dt->format('j');
    $mes = $meses[$m] ?? '';
    if ($mes === '') return '';
    return $mes . '-' . str_pad((string)$d, 2, '0', STR_PAD_LEFT);
}

private function iso_to_fecha_human($iso) {
    $iso = is_string($iso) ? trim($iso) : '';
    if (!$this->looks_like_iso_date($iso)) return '';

    try {
        $dt = new DateTime($iso, new DateTimeZone('America/Mexico_City'));
    } catch (Exception $e) {
        return '';
    }

    $meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    $dias = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
    $m = (int)$dt->format('n');
    $d = (int)$dt->format('j');
    $w = (int)$dt->format('w');

    $mes = $meses[$m] ?? '';
    $dia = $dias[$w] ?? '';
    if ($mes === '' || $dia === '') return '';
    return $dia . ' ' . $d . ' de ' . $mes;
}

private function load_shared_data() {
        // Try Ana Config Hub first
        $ana_config = tagers_ana_get_config();
        
        if (!empty($ana_config['branches'])) {
            $this->sucursales = [];
            foreach ($ana_config['branches'] as $branch) {
                if (empty($branch['enabled'])) continue;
                $slug = strtolower(str_replace('_', '-', $branch['city'] . '-' . $branch['short_name']));
                $this->sucursales[$slug] = [
                    'slug' => $slug,
                    'nombre' => $branch['name'],
                    'ciudad' => $branch['city'],
                    'direccion' => $branch['address'],
                    'telefono' => $branch['phone_display'] ?? $branch['phone'],
                    'horario' => '', // Calculated from branch_hours if needed
                    'aliases' => [$branch['short_name'], strtolower($branch['short_name']), $branch['zone'] ?? ''],
                    'coords' => ['lat' => $branch['lat'] ?? 0, 'lng' => $branch['lng'] ?? 0],
                    'branch_id' => $branch['branch_id'],
                    'reservation_provider' => 'TAGERS',
                    'reservation_url' => $branch['reservation_url'] ?? '',
                    'google_maps_url' => $branch['google_maps_url'] ?? '',
                    'amenities' => [
                        'kids_area' => $branch['kids_area'] ?? false,
                        'pet_friendly' => $branch['pet_friendly'] ?? false,
                        'terrace' => $branch['terrace'] ?? false,
                        'private_room' => $branch['private_room'] ?? false,
                    ],
                ];
            }
        } else {
            // Fallback to hardcoded (legacy)
            $this->sucursales = $this->get_legacy_sucursales();
        }
        
        if (!empty($ana_config['roscas'])) {
            $this->productos_rosca = [];
            foreach ($ana_config['roscas'] as $rosca) {
                if (empty($rosca['enabled'])) continue;
                $key = strtolower(str_replace(' ', '-', $rosca['name']));
                $key = sanitize_title($rosca['sku'] ?? $key);
                $this->productos_rosca[$key] = [
                    'key' => $key,
                    'nombre' => $rosca['name'],
                    'nombre_corto' => $rosca['type'] ?? $rosca['name'],
                    'precio' => $rosca['price'],
                    'descripcion' => $rosca['description'] ?? '',
                    'aliases' => [strtolower($rosca['type'] ?? ''), strtolower($rosca['name'])],
                    'product_id' => $rosca['product_id'] ?? null,
                    'sku' => $rosca['sku'] ?? null,
                ];
            }
        } else {
            // Fallback to hardcoded (legacy)
            $this->productos_rosca = $this->get_legacy_productos_rosca();
        }
    }
    
    private function get_legacy_sucursales() {
        return [
            'puebla-5-sur' => [
                'slug' => 'puebla-5-sur',
                'nombre' => 'Puebla - 5 Sur',
                'ciudad' => 'Puebla',
                'direccion' => 'C. 5 Sur 4910, Residencial Boulevares, 72440 Puebla',
                'telefono' => '222-211-0329',
                'horario' => 'L-Mi 8-22h, Ju-Sa 8-23h, Do 8-21h',
                'aliases' => ['5 sur', 'cinco sur', '5sur', 'zona dorada', 'boulevares'],
                'coords' => ['lat' => 19.0234, 'lng' => -98.2062],
                'branch_id' => '5_SUR',
                'reservation_provider' => 'TAGERS',
                'reservation_url' => 'https://tagers.com/reserva/5sur',
                'amenities' => ['nanny' => true, 'changing_table' => true, 'valet' => false],
            ],
            'puebla-zavaleta' => [
                'slug' => 'puebla-zavaleta',
                'nombre' => 'Puebla - Zavaleta',
                'ciudad' => 'Puebla',
                'direccion' => 'Calz Zavaleta 912-2, Santa Cruz Buenavista Norte, 72150 Puebla',
                'telefono' => '222-375-4278',
                'horario' => 'Do-Mi 8-21h, Ju-Sa 8-23h',
                'aliases' => ['zavaleta', 'zava', 'cholula', 'buena vista'],
                'coords' => ['lat' => 19.0156, 'lng' => -98.2234],
                'branch_id' => 'ZAVALETA',
                'reservation_provider' => 'TAGERS',
                'reservation_url' => 'https://tagers.com/reserva/zavaleta',
                'amenities' => ['nanny' => true, 'changing_table' => true, 'valet' => false],
            ],
            'puebla-sonata' => [
                'slug' => 'puebla-sonata',
                'nombre' => 'Puebla - Sonata',
                'ciudad' => 'Puebla',
                'direccion' => 'Plaza Escala, Paseo Opera 4 PB L 1-A, Lomas de Angelopolis',
                'telefono' => null,
                'horario' => 'L-Mi 8-22h, Ju-Sa 8-23h, Do 8-21h',
                'aliases' => ['sonata', 'escala', 'lomas', 'cascatta'],
                'coords' => ['lat' => 19.0012, 'lng' => -98.2567],
                'branch_id' => 'SONATA',
                'reservation_provider' => 'TAGERS',
                'reservation_url' => 'https://tagers.com/reserva/sonata',
                'amenities' => ['nanny' => true, 'changing_table' => true, 'valet' => true],
            ],
            'puebla-angelopolis' => [
                'slug' => 'puebla-angelopolis',
                'nombre' => 'Puebla - Angelopolis',
                'ciudad' => 'Puebla',
                'direccion' => 'Osa Mayor 4929-Local 111, Atlixcayotl, 72193 Puebla',
                'telefono' => null,
                'horario' => 'L-Mi 8-22h, Ju-Sa 8-23h, Do 8-21h',
                'aliases' => ['angelopolis', 'paseo', 'osa mayor', 'rueda'],
                'coords' => ['lat' => 19.0278, 'lng' => -98.2345],
                'branch_id' => 'ANGELOPOLIS',
                'reservation_provider' => 'TAGERS',
                'reservation_url' => 'https://tagers.com/reserva/angelopolis',
                'amenities' => ['nanny' => true, 'changing_table' => true, 'valet' => true],
            ],
            'cdmx-san-angel' => [
                'slug' => 'cdmx-san-angel',
                'nombre' => 'CDMX - San Angel',
                'ciudad' => 'CDMX',
                'direccion' => 'Av. de la Paz 40, San Angel, Alvaro Obregon, 01000 CDMX',
                'telefono' => null,
                'horario' => 'L-Do 8-21h',
                'aliases' => ['san angel', 'cdmx', 'ciudad de mexico', 'df', 'la paz'],
                'coords' => ['lat' => 19.3456, 'lng' => -99.1892],
                'branch_id' => 'SAN_ANGEL',
                'reservation_provider' => 'TAGERS',
                'reservation_url' => 'https://tagers.com/reserva/sanangel',
                'amenities' => ['nanny' => false, 'changing_table' => true, 'valet' => false],
            ],
        ];
    }
    
    private function get_legacy_productos_rosca() {
        return [
            'clasica' => [
                'key' => 'clasica',
                'nombre' => 'Rosca de Reyes Clasica',
                'nombre_corto' => 'Clasica',
                'precio' => 529,
                'descripcion' => 'Costra de vainilla o chocolate, ate, cerezas, crumble de almendras',
                'aliases' => ['clasica', 'tradicional', 'normal', 'sencilla', 'original'],
            ],
            'dulce-de-leche' => [
                'key' => 'dulce-de-leche',
                'nombre' => 'Rosca de Reyes Dulce de Leche',
                'nombre_corto' => 'Dulce de Leche',
                'precio' => 695,
                'descripcion' => 'Rellena de dulce de leche con nuez',
                'aliases' => ['dulce de leche', 'cajeta', 'caramelo', 'dulcedeleche'],
            ],
            'lotus' => [
                'key' => 'lotus',
                'nombre' => 'Rosca de Reyes Lotus',
                'nombre_corto' => 'Lotus',
                'precio' => 695,
                'descripcion' => 'Rellena de crema Lotus Biscoff con queso crema',
                'aliases' => ['lotus', 'lotos', 'galleta', 'biscoff', 'speculoos'],
            ],
            'nutella' => [
                'key' => 'nutella',
                'nombre' => 'Rosca de Reyes Nutella',
                'nombre_corto' => 'Nutella',
                'precio' => 735,
                'descripcion' => 'Rellena de Nutella',
                'aliases' => ['nutella', 'nutela', 'avellana', 'chocolate avellana'],
            ],
            'reina' => [
                'key' => 'reina',
                'nombre' => 'Rosca de Reyes Reina',
                'nombre_corto' => 'Reina',
                'precio' => 735,
                'descripcion' => 'Rellena de nata y miel - Nuestra favorita premium',
                'aliases' => ['reina', 'reyna', 'nata', 'miel', 'premium'],
            ],
            'explosion' => [
                'key' => 'explosion',
                'nombre' => 'Rosca de Reyes Explosion de Chocolate',
                'nombre_corto' => 'Explosion de Chocolate',
                'precio' => 915,
                'descripcion' => 'Para los verdaderos amantes del chocolate',
                'aliases' => ['explosion', 'chocolate', 'mega chocolate', 'choco'],
            ],
        ];
    }
    
    private function init_hooks() {
        add_action('rest_api_init', [$this, 'register_routes']);
        add_action('admin_menu', [$this, 'admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        // Token saving via admin-post (more reliable than options.php in hardened environments)
        add_action('admin_post_tagers_kiss_save_tokens', [$this, 'handle_save_tokens']);
    }
    
    public function register_routes() {
        if ($this->config['modules']['cs']) $this->register_cs_routes();
        if ($this->config['modules']['ops']) $this->register_ops_routes();
        if ($this->config['modules']['bridge']) $this->register_bridge_routes();
        if ($this->config['modules']['cedis']) $this->register_cedis_routes();
        if ($this->config['modules']['runner']) $this->register_runner_routes();
    }
    
    // ====================== CS MODULE ======================
    
    private function register_cs_routes() {
        $ns = 'tagers-cs/v1';
        
        register_rest_route($ns, '/info-completa', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_info_completa'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);

        register_rest_route($ns, '/assistant-config', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_assistant_config'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);

        register_rest_route($ns, '/product-search', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_product_search'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
        
        register_rest_route($ns, '/reservation-link', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_reservation_link'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
register_rest_route($ns, '/consulta-disponibilidad', [
            'methods' => 'POST',
            'callback' => [$this, 'cs_consulta_disponibilidad'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
        register_rest_route($ns, '/generar-link-compra', [
            'methods' => 'POST',
            'callback' => [$this, 'cs_generar_link_compra'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);

        register_rest_route($ns, '/crear-pedido', [
            'methods' => 'POST',
            'callback' => [$this, 'cs_crear_pedido'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
        register_rest_route($ns, '/buscar-pedido', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_buscar_pedido'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
        register_rest_route($ns, '/cambiar-entrega', [
            'methods' => 'POST',
            'callback' => [$this, 'cs_cambiar_entrega'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
        register_rest_route($ns, '/cliente-historial', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_cliente_historial'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);
        
        register_rest_route($ns, '/analyze-crisis', [
            'methods' => 'POST',
            'callback' => [$this, 'cs_analyze_crisis'],
            'permission_callback' => [$this, 'verify_cs_token'],
        ]);

        // Staging / QA (requires tagers_allow_test_endpoints)
        register_rest_route($ns, '/test/ping', [
            'methods' => 'GET',
            'callback' => [$this, 'cs_test_ping'],
            'permission_callback' => [$this, 'verify_cs_test_mode'],
        ]);

        register_rest_route($ns, '/test/void-order', [
            'methods' => 'POST',
            'callback' => [$this, 'cs_test_void_order'],
            'permission_callback' => [$this, 'verify_cs_test_mode'],
        ]);
    }
    
    public function verify_cs_token($request) {
        $token = $request->get_header('X-Tagers-CS-Token');
        if (empty($token) || $token !== $this->config['tokens']['cs']) {
            $this->log('auth_failed', 'cs', ['ip' => $_SERVER['REMOTE_ADDR'] ?? '']);
            return new WP_Error('unauthorized', 'Token CS invalido', ['status' => 403]);
        }
        return true;
    }

    public function verify_cs_test_mode($request) {
        $ok = $this->verify_cs_token($request);
        if ($ok !== true) return $ok;

        $enabled = (bool) get_option('tagers_allow_test_endpoints', false);
        if (!$enabled) {
            return new WP_Error('disabled', 'Test endpoints deshabilitados (tagers_allow_test_endpoints = false).', ['status' => 403]);
        }
        return true;
    }

    public function cs_test_ping($request) {
        return [
            'success' => true,
            'version' => TAGERS_KISS_VERSION,
            'test_endpoints' => true,
        ];
    }

    public function cs_test_void_order($request) {
        $params = $request->get_json_params();
        $order_id = absint($params['order_id'] ?? 0);
        $trash = !empty($params['trash']);

        if (!$order_id) {
            return new WP_Error('missing_order_id', 'Se requiere order_id', ['status' => 400]);
        }
        if (!function_exists('wc_get_order')) {
            return new WP_Error('no_wc', 'WooCommerce no disponible', ['status' => 500]);
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return new WP_Error('not_found', 'Pedido no encontrado', ['status' => 404]);
        }

        // Guardrail: only allow test orders
        $is_test = (bool) $order->get_meta('_tagers_test_order');
        if (!$is_test) {
            return new WP_Error('forbidden', 'Solo se pueden cancelar órdenes marcadas como test (_tagers_test_order).', ['status' => 403]);
        }

        try {
            $order->update_status('cancelled', 'Cancelado por staging test (Tagers CS)');
            $order->add_order_note('Staging test: void-order ejecutado.');
            $order->save();

            if ($trash && function_exists('wp_trash_post')) {
                wp_trash_post($order_id);
            }
        } catch (Exception $e) {
            return new WP_Error('void_failed', 'No se pudo cancelar el pedido: ' . $e->getMessage(), ['status' => 500]);
        }

        return [
            'success' => true,
            'order_id' => $order_id,
            'status' => $order->get_status(),
            'trashed' => $trash ? true : false,
            'mensaje' => 'Pedido cancelado (staging test).',
        ];
    }

    public function cs_info_completa($request) {
        $tz = new DateTimeZone('America/Mexico_City');
        $now = new DateTime('now', $tz);

        $assistant = $this->get_assistant_config();

        // Productos (incluye key y, si es posible, mapping a WooCommerce product_id)
        $productos = [];
        foreach ($this->productos_rosca as $k => $p) {
            $item = $p;
            $item['key'] = $k;
            $item['wc_product_id'] = $this->resolve_rosca_wc_product_id($k, $p, $assistant);
            $productos[] = $item;
        }
        
        return [
            'success' => true,
            'version' => TAGERS_KISS_VERSION,
            'hora_mx' => $now->format('Y-m-d H:i:s'),
            'fecha_actual' => $now->format('Y-m-d'),
            'fechas_disponibles' => $this->get_fechas_disponibles(),
            'assistant' => $assistant,
            'productos' => $productos,
            'promo' => $this->get_promo_public(),
            'sucursales' => array_map(function($s) {
                return [
                    'slug' => $s['slug'],
                    'nombre' => $s['nombre'],
                    'ciudad' => $s['ciudad'],
                    'direccion' => $s['direccion'],
                    'telefono' => $s['telefono'],
                    'horario' => $s['horario'],
                    'coords' => $s['coords'] ?? null,
                    'branch_id' => $s['branch_id'] ?? null,
                    'reservation_provider' => $s['reservation_provider'] ?? null,
                    'opentable_url' => $s['opentable_url'] ?? null,
                    'amenities' => $s['amenities'] ?? null,
                ];
            }, array_values($this->sucursales)),
        ];
    }

    public function cs_assistant_config($request) {
        return [
            'success' => true,
            'version' => TAGERS_KISS_VERSION,
            'assistant' => $this->get_assistant_config(),
            'promo' => $this->get_promo_public(),
        ];
    }

    private function resolve_rosca_wc_product_id($key, $product, $assistant = null) {
        // Allow explicit mapping via admin option (recommended)
        $assistant = is_array($assistant) ? $assistant : $this->get_assistant_config();
        $map = $assistant['order']['rosca_wc_product_map'] ?? [];

        if (is_array($map) && isset($map[$key]) && absint($map[$key]) > 0) {
            return absint($map[$key]);
        }

        // Best-effort auto-discovery (falls back to 0 if not found)
        if (!function_exists('wc_get_products')) return 0;

        $needle = $product['nombre_corto'] ?? ($product['nombre'] ?? '');
        $needle = sanitize_text_field($needle);
        if (empty($needle)) return 0;

        $candidates = wc_get_products([
            'limit' => 5,
            'status' => 'publish',
            's' => $needle,
        ]);

        if (!is_array($candidates) || empty($candidates)) return 0;

        // Prefer variable products (roscas suelen ser variables)
        foreach ($candidates as $p) {
            if ($p && method_exists($p, 'is_type') && $p->is_type('variable')) {
                return absint($p->get_id());
            }
        }
        // Otherwise first match
        $p0 = $candidates[0];
        return $p0 ? absint($p0->get_id()) : 0;
    }

    public function cs_product_search($request) {
        if (!function_exists('wc_get_products')) {
            return new WP_Error('woocommerce_missing', 'WooCommerce no está disponible', ['status' => 400]);
        }

        $q = sanitize_text_field($request->get_param('q') ?? '');
        $limit = absint($request->get_param('limit') ?? 5);
        if ($limit <= 0) $limit = 5;
        if ($limit > 20) $limit = 20;

        if (empty($q)) {
            return [
                'success' => false,
                'mensaje' => 'Falta parámetro q',
                'items' => [],
            ];
        }

        $items = [];
        $products = wc_get_products([
            'limit' => $limit,
            'status' => 'publish',
            's' => $q,
        ]);

        foreach (($products ?: []) as $p) {
            if (!$p) continue;
            $attrs = null;
            if (method_exists($p, 'get_variation_attributes') && $p->is_type('variable')) {
                $attrs = $p->get_variation_attributes();
            }
            $items[] = [
                'id' => absint($p->get_id()),
                'name' => $p->get_name(),
                'type' => $p->get_type(),
                'price' => $p->get_price(),
                'permalink' => method_exists($p, 'get_permalink') ? $p->get_permalink() : null,
                'variation_attributes' => $attrs,
            ];
        }

        return [
            'success' => true,
            'query' => $q,
            'count' => count($items),
            'items' => $items,
        ];
    }
    
    
    public function cs_reservation_link($request) {
        $sucursal_q = sanitize_text_field($request->get_param('sucursal') ?? $request->get_param('branch') ?? $request->get_param('branch_slug') ?? '');

        $this->log('reservation_link', 'cs', ['sucursal_q' => $sucursal_q]);

        if (empty($sucursal_q)) {
            $nombres = implode(', ', array_column($this->sucursales, 'nombre'));
            return [
                'success' => false,
                'mensaje' => 'Necesito la sucursal para darte el link de OpenTable. Opciones: ' . $nombres,
            ];
        }

        $sucursal = $this->find_sucursal($sucursal_q);
        if (!$sucursal) {
            $nombres = implode(', ', array_column($this->sucursales, 'nombre'));
            return [
                'success' => false,
                'mensaje' => "No reconozco esa sucursal. Opciones: $nombres.",
            ];
        }

        if (empty($sucursal['opentable_url'])) {
            return [
                'success' => false,
                'sucursal' => [
                    'slug' => $sucursal['slug'],
                    'nombre' => $sucursal['nombre'],
                    'branch_id' => $sucursal['branch_id'] ?? null,
                ],
                'mensaje' => 'No tengo el enlace de OpenTable configurado para esta sucursal. Pide al equipo que lo agregue en el plugin.',
            ];
        }

        return [
            'success' => true,
            'sucursal' => [
                'slug' => $sucursal['slug'],
                'nombre' => $sucursal['nombre'],
                'branch_id' => $sucursal['branch_id'] ?? null,
            ],
            'reservation_provider' => $sucursal['reservation_provider'] ?? 'OPENTABLE',
            'opentable_url' => $sucursal['opentable_url'],
            'mensaje' => 'Aqui puedes reservar directamente en OpenTable para esta sucursal.',
        ];
    }

    public function cs_consulta_disponibilidad($request) {
        $params = $request->get_json_params();

        $producto_q = sanitize_text_field($params['producto'] ?? '');
        $producto_id = absint($params['producto_id'] ?? 0);
        $producto_key = sanitize_text_field($params['producto_key'] ?? '');

        $fecha_q = sanitize_text_field($params['fecha'] ?? '');
        $sucursal_q = sanitize_text_field($params['sucursal'] ?? '');
        $cantidad = max(1, (int)($params['cantidad'] ?? 1));

        $this->log('consulta_disponibilidad', 'cs', [
            'producto_q' => $producto_q,
            'producto_id' => $producto_id,
            'producto_key' => $producto_key,
            'fecha_q' => $fecha_q,
            'sucursal_q' => $sucursal_q,
            'cantidad' => $cantidad,
        ]);

        $assistant = $this->get_assistant_config();

        // 1) Resolve producto (por key, nombre, o producto_id directo)
        $producto = null;
        $resolved_key = null;

        if (!empty($producto_key) && isset($this->productos_rosca[$producto_key])) {
            $producto = $this->productos_rosca[$producto_key];
            $resolved_key = $producto_key;
        }

        if (!$producto && !empty($producto_q)) {
            $producto = $this->find_producto($producto_q);
            if ($producto && isset($producto['key'])) {
                $resolved_key = $producto['key'];
            }
        }

        // 2) Parse fecha y sucursal
        $fecha = $this->parse_fecha($fecha_q);
        if (!$fecha) {
            return [
                'success' => false,
                'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
                'fecha_valida' => false,
                'disponible' => false,
                'mensaje' => 'No entendí la fecha. Ejemplo: "enero 6", "mañana" o "enero-06".',
            ];
        }

        $sucursal = $this->find_sucursal($sucursal_q);
        if (!$sucursal) {
            $nombres = implode(', ', array_column($this->sucursales, 'nombre'));
            return [
                'success' => false,
                'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
                'sucursal_valida' => false,
                'disponible' => false,
                'mensaje' => "No reconozco esa sucursal. Opciones: $nombres.",
            ];
        }

        // 3) Resolve WooCommerce product_id
        $wc_product_id = 0;
        if ($producto_id > 0) {
            $wc_product_id = $producto_id;
        } elseif ($producto && $resolved_key) {
            $wc_product_id = $this->resolve_rosca_wc_product_id($resolved_key, $producto, $assistant);
        }

        // If still unknown, try best-effort search by query
        if ($wc_product_id <= 0 && function_exists('wc_get_products') && !empty($producto_q)) {
            $candidates = wc_get_products([
                'limit' => 5,
                'status' => 'publish',
                's' => $producto_q,
            ]);
            foreach (($candidates ?: []) as $p) {
                if ($p && method_exists($p, 'is_type') && $p->is_type('variable')) {
                    $wc_product_id = absint($p->get_id());
                    break;
                }
            }
            if ($wc_product_id <= 0 && !empty($candidates)) {
                $wc_product_id = absint($candidates[0]->get_id());
            }
        }

        if ($wc_product_id <= 0) {
            $sabores = implode(', ', array_column($this->productos_rosca, 'nombre_corto'));
            return [
                'success' => false,
                'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
                'producto_encontrado' => false,
                'disponible' => false,
                'mensaje' => "No pude resolver el producto en WooCommerce. Si es Rosca, prueba con: $sabores.",
            ];
        }

        // 4) Validación de fechas (Cerebro Maestro si existe; fallback a reglas simples)
        $fecha_slug = $fecha['slug'];
        if (function_exists('tagers_validar_fecha_master')) {
            if (!tagers_validar_fecha_master($fecha_slug, 'web', $wc_product_id)) {
                return [
                    'success' => true,
                    'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
                    'producto_encontrado' => (bool)$producto,
                    'fecha_valida' => true,
                    'sucursal_valida' => true,
                    'disponible' => false,
                    'razon' => 'fecha_no_disponible',
                    'fecha' => $fecha,
                    'sucursal' => $sucursal,
                    'mensaje' => 'Esa fecha no está disponible para compra en línea en este momento. ¿Te comparto otras fechas o prefieres pasar a sucursal?',
                ];
            }
        } else {
            $cerebro = $this->verificar_cerebro($fecha);
            if (!$cerebro['permite']) {
                return [
                    'success' => true,
                    'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
                    'producto_encontrado' => (bool)$producto,
                    'fecha_valida' => true,
                    'sucursal_valida' => true,
                    'disponible' => false,
                    'razon' => 'fecha_no_disponible',
                    'fecha' => $fecha,
                    'sucursal' => $sucursal,
                    'mensaje' => $cerebro['mensaje'],
                ];
            }
        }

        // 5) Stock / variación
        $stock = $this->verificar_stock_wc($wc_product_id, $fecha, $sucursal, $cantidad, $assistant);
        if (!$stock['disponible']) {
            return [
                'success' => true,
                'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
                'producto_encontrado' => (bool)$producto,
                'fecha_valida' => true,
                'sucursal_valida' => true,
                'disponible' => false,
                'razon' => 'sin_stock',
                'producto' => $producto,
                'fecha' => $fecha,
                'sucursal' => $sucursal,
                'mensaje' => $stock['mensaje'] ?? 'No hay stock para esa combinación.',
            ];
        }

        // 6) Totales
        $precio_unit = $producto['precio'] ?? ($stock['precio_unitario'] ?? 0);
        $total = $precio_unit ? ($precio_unit * $cantidad) : null;

        return [
            'success' => true,
            'consulta' => compact('producto_q', 'producto_id', 'producto_key', 'fecha_q', 'sucursal_q', 'cantidad'),
            'producto_encontrado' => (bool)$producto,
            'fecha_valida' => true,
            'sucursal_valida' => true,
            'disponible' => true,
            'product_id' => $wc_product_id,
            'variation_id' => $stock['variation_id'] ?? null,
            'stock_disponible' => $stock['cantidad'] ?? null,
            'producto' => array_merge((array)($producto ?: []), [
                'key' => $resolved_key,
                'wc_product_id' => $wc_product_id,
            ]),
            'fecha' => $fecha,
            'sucursal' => $sucursal,
            'resumen' => [
                'producto' => $producto['nombre'] ?? 'Producto',
                'cantidad' => $cantidad,
                'precio_unitario' => $precio_unit,
                'total' => $total,
                'total_display' => $total ? ('$' . number_format($total, 0) . ' MXN') : null,
                'fecha' => $fecha['nombre'],
                'fecha_iso' => $fecha['fecha_iso'],
                'sucursal' => $sucursal['nombre'],
            ],
            'puede_crear_pedido' => true,
            'mensaje' => '¡Listo! Hay disponibilidad para esa fecha y sucursal.',
        ];
    }
    
    public function cs_generar_link_compra($request) {
        $params = $request->get_json_params();
        $items = $params['items'] ?? [];
        if (empty($items)) return new WP_Error('no_items', 'Se requiere al menos un item', ['status' => 400]);
        
        $cart_params = [];
        $total = 0;
        foreach ($items as $item) {
            $product_id = absint($item['producto_id'] ?? ($item['product_id'] ?? 0));
            $variation_id = absint($item['variation_id'] ?? 0);
            $cantidad = max(1, (int)($item['cantidad'] ?? ($item['quantity'] ?? 1)));
            if ($variation_id) {
                $cart_params[] = "add-to-cart=$product_id&variation_id=$variation_id&quantity=$cantidad";
                $prod = function_exists('wc_get_product') ? wc_get_product($variation_id) : null;
            } elseif ($product_id) {
                $cart_params[] = "add-to-cart=$product_id&quantity=$cantidad";
                $prod = function_exists('wc_get_product') ? wc_get_product($product_id) : null;
            }
            if ($prod) $total += $prod->get_price() * $cantidad;
        }
        
        $checkout_url = !empty($cart_params) ? site_url('/?' . implode('&', $cart_params)) : (function_exists('wc_get_checkout_url') ? wc_get_checkout_url() : site_url('/checkout'));
        $this->log('link_generado', 'cs', ['items' => count($items), 'total' => $total]);
        return ['success' => true, 'checkout_url' => $checkout_url, 'total' => $total, 'total_display' => '$' . number_format($total, 0) . ' MXN', 'mensaje' => 'Link de compra generado.'];
    }

    public function cs_crear_pedido($request) {
        // Guardrail: enable only when configured
        $assistant = $this->get_assistant_config();
        $mode = $assistant['order']['mode'] ?? 'checkout_link';
        if ($mode !== 'draft_order') {
            return [
                'success' => false,
                'mensaje' => 'La creación automática de pedidos está desactivada (order.mode != draft_order). Usa /generar-link-compra.',
            ];
        }

        if (!function_exists('wc_create_order')) {
            return new WP_Error('woocommerce_missing', 'WooCommerce no está disponible', ['status' => 400]);
        }

        $params = $request->get_json_params();
        $items = $params['items'] ?? [];
        $customer = is_array($params['customer'] ?? null) ? $params['customer'] : [];
        $meta = is_array($params['meta'] ?? null) ? $params['meta'] : [];
        $is_test_order = !empty($meta['is_test']) || !empty($meta['test_order']) || !empty($meta['_tagers_test_order']);

        if (empty($items) || !is_array($items)) {
            return new WP_Error('no_items', 'Se requiere al menos un item', ['status' => 400]);
        }

        // Create order
        $order = wc_create_order();
        if (!$order) {
            return new WP_Error('order_create_failed', 'No se pudo crear el pedido', ['status' => 500]);
        }

        // Mark test orders (staging only)
        if ($is_test_order && (bool) get_option('tagers_allow_test_endpoints', false)) {
            $order->update_meta_data('_tagers_test_order', 1);
            $order->add_order_note('Staging test order (auto).');
        }

        // Customer info
        $name = sanitize_text_field($customer['name'] ?? '');
        $phone = sanitize_text_field($customer['phone'] ?? '');
        $email = sanitize_email($customer['email'] ?? '');

        if (!empty($name)) {
            $parts = preg_split('/\s+/', trim($name));
            $first = array_shift($parts);
            $last = implode(' ', $parts);
            $order->set_billing_first_name($first);
            $order->set_billing_last_name($last);
        }
        if (!empty($phone)) $order->set_billing_phone($phone);
        if (!empty($email)) $order->set_billing_email($email);

        // Meta delivery fields (optional)
        // NOTE: accept multiple key names for backwards compatibility.
        $fecha_iso = sanitize_text_field($meta['fecha_iso'] ?? ($meta['fecha_entrega'] ?? ($meta['fecha'] ?? '')));
        $sucursal_nombre = sanitize_text_field($meta['sucursal_nombre'] ?? ($meta['sucursal'] ?? ''));
        $sucursal_slug = sanitize_text_field($meta['sucursal_slug'] ?? '');

        // If only slug was provided, try to fill the human-readable name.
        if (empty($sucursal_nombre) && !empty($sucursal_slug)) {
            $s = $this->sucursales[$sucursal_slug] ?? null;
            if (!$s) {
                foreach ($this->sucursales as $ss) {
                    if (($ss['slug'] ?? '') === $sucursal_slug) { $s = $ss; break; }
                }
            }
            if (is_array($s) && !empty($s['nombre'])) {
                $sucursal_nombre = sanitize_text_field($s['nombre']);
            }
        }

        // If only name was provided, try to resolve slug.
        if (empty($sucursal_slug) && !empty($sucursal_nombre)) {
            $s = $this->find_sucursal($sucursal_nombre);
            if (is_array($s) && !empty($s['slug'])) {
                $sucursal_slug = sanitize_text_field($s['slug']);
            }
        }

        
// Delivery meta (canonical + compatibility)
$fecha_slug  = sanitize_text_field($meta['fecha_slug'] ?? ($meta['fecha_entrega_slug'] ?? ''));
$fecha_human = sanitize_text_field($meta['fecha_nombre'] ?? ($meta['fecha_human'] ?? ($meta['fecha_h'] ?? '')));

if (empty($fecha_slug) && !empty($fecha_iso)) {
    $fecha_slug = $this->iso_to_fecha_slug($fecha_iso);
}
if (empty($fecha_human) && !empty($fecha_iso)) {
    $fecha_human = $this->iso_to_fecha_human($fecha_iso);
}

// Always store ISO separately (prevents collisions with Ops Core which uses _tagers_fecha_entrega as slug)
if (!empty($fecha_iso))   $order->update_meta_data('_tagers_fecha_entrega_iso', $fecha_iso);
if (!empty($fecha_slug))  $order->update_meta_data('_tagers_fecha_entrega_slug', $fecha_slug);
if (!empty($fecha_human)) $order->update_meta_data('_tagers_fecha_entrega_h', $fecha_human);

// Always store branch keys (safe)
if (!empty($sucursal_nombre)) $order->update_meta_data('_tagers_sucursal', $sucursal_nombre);
if (!empty($sucursal_slug))   $order->update_meta_data('_tagers_sucursal_slug', $sucursal_slug);
if (!empty($sucursal_slug))   $order->update_meta_data('_tagers_sucursal_entrega', $sucursal_slug);
if (!empty($sucursal_nombre)) $order->update_meta_data('_tagers_sucursal_entrega_h', $sucursal_nombre);

// Canonical _tagers_fecha_entrega depends on Ops Core presence:
if ($this->is_ops_core_active()) {
    if (!empty($fecha_slug)) $order->update_meta_data('_tagers_fecha_entrega', $fecha_slug);
} else {
    if (!empty($fecha_iso)) $order->update_meta_data('_tagers_fecha_entrega', $fecha_iso);
}
// Add items
        foreach ($items as $item) {
            $product_id = absint($item['producto_id'] ?? ($item['product_id'] ?? 0));
            $variation_id = absint($item['variation_id'] ?? 0);
            $qty = max(1, (int)($item['cantidad'] ?? ($item['quantity'] ?? 1)));

            if ($variation_id > 0) {
                $prod = wc_get_product($variation_id);
            } else {
                $prod = wc_get_product($product_id);
            }
            if (!$prod) {
                return new WP_Error('invalid_product', 'Producto inválido en items', ['status' => 400]);
            }
            if ($prod->managing_stock()) {
                $stock = $prod->get_stock_quantity();
                if (is_numeric($stock) && $stock < $qty) {
                    return [
                        'success' => false,
                        'mensaje' => "Sin stock suficiente para {$prod->get_name()}. Disponibles: " . (string)$stock,
                    ];
                }
            }
            $order->add_product($prod, $qty);
        }

        // Totals + status
        $order->calculate_totals();
        $order->update_status('pending', 'Creado por Bot CS (KISS)');
        $order->save();

        $payment_url = method_exists($order, 'get_checkout_payment_url') ? $order->get_checkout_payment_url() : null;

        return [
            'success' => true,
            'order_id' => $order->get_id(),
            'status' => $order->get_status(),
            'total' => $order->get_total(),
            'total_display' => $order->get_formatted_order_total(),
            'payment_url' => $payment_url,
            'mensaje' => 'Pedido creado. Comparte el link de pago al cliente.',
        ];
    }
    
    public function cs_buscar_pedido($request) {
        $phone = sanitize_text_field($request->get_param('phone') ?? '');
        $order_id = absint($request->get_param('order_id') ?? 0);
        if (empty($phone) && !$order_id) return new WP_Error('missing_params', 'Se requiere phone u order_id', ['status' => 400]);
        if (!function_exists('wc_get_orders')) {
            return [
                'success' => false,
                'encontrado' => false,
                'orders' => [],
                'pedidos' => [],
                'total_encontrados' => 0,
                'mensaje' => 'WooCommerce no disponible',
            ];
        }
        
        if ($order_id) {
            $order = wc_get_order($order_id);
            if (!$order) {
                return [
                    'success' => false,
                    'encontrado' => false,
                    'orders' => [],
                    'pedidos' => [],
                    'total_encontrados' => 0,
                    'mensaje' => 'Pedido no encontrado',
                ];
            }

            $o = $this->format_order($order);
            return array_merge($o, [
                // Standardized envelope for KISS API
                'success' => true,
                'encontrado' => true,
                'orders' => [$o],
                'pedidos' => [$o],
                'total_encontrados' => 1,
                'mensaje' => 'OK',
            ]);
        }
        
        $phone_clean = preg_replace('/[^0-9]/', '', $phone);
        $orders = wc_get_orders(['meta_query' => [['key' => '_billing_phone', 'value' => substr($phone_clean, -10), 'compare' => 'LIKE']], 'limit' => 5, 'orderby' => 'date', 'order' => 'DESC']);
        if (empty($orders)) {
            return [
                'success' => false,
                'encontrado' => false,
                'orders' => [],
                'pedidos' => [],
                'total_encontrados' => 0,
                'mensaje' => 'No encontre pedidos con ese telefono',
            ];
        }

        $formatted = array_map([$this, 'format_order'], $orders);
        return [
            'success' => true,
            'encontrado' => true,
            'orders' => $formatted,
            // Backwards compatible keys
            'pedidos' => $formatted,
            'total_encontrados' => count($orders),
            'mensaje' => 'OK',
        ];
    }
    
    public function cs_cambiar_entrega($request) {
        $params = $request->get_json_params();
        $order_id = absint($params['order_id'] ?? 0);
        $nueva_fecha_q = sanitize_text_field($params['nueva_fecha'] ?? '');
        $nueva_sucursal_q = sanitize_text_field($params['nueva_sucursal'] ?? '');

        if (!$order_id) {
            return new WP_Error('missing_order_id', 'Se requiere order_id', ['status' => 400]);
        }
        if (!function_exists('wc_get_order') || !function_exists('wc_get_product')) {
            return new WP_Error('no_wc', 'WooCommerce no disponible', ['status' => 500]);
        }

        $order = wc_get_order($order_id);
        if (!$order) {
            return new WP_Error('not_found', 'Pedido no encontrado', ['status' => 404]);
        }
        if (!in_array($order->get_status(), ['pending', 'processing', 'on-hold'])) {
            return ['success' => false, 'mensaje' => 'Este pedido ya no se puede modificar.'];
        }

        $assistant = $this->get_assistant_config();
        $attr_fecha_cfg = $assistant['order']['attribute_fecha'] ?? 'pa_fecha-de-entrega';
        $attr_suc_cfg = $assistant['order']['attribute_sucursal'] ?? 'pa_sucursal-de-entrega';

        $fecha_keys = array_unique([
            $attr_fecha_cfg,
            preg_replace('/^pa_/', '', $attr_fecha_cfg),
            'pa_fecha-de-entrega',
            'fecha-de-entrega',
        ]);
        $suc_keys = array_unique([
            $attr_suc_cfg,
            preg_replace('/^pa_/', '', $attr_suc_cfg),
            'pa_sucursal-de-entrega',
            'sucursal-de-entrega',
        ]);

        $cambios = [];

        $fecha_obj = null;
        if (!empty($nueva_fecha_q)) {
            $fecha_obj = $this->parse_fecha($nueva_fecha_q);
            if (!$fecha_obj) {
                return ['success' => false, 'mensaje' => 'No entendí la nueva fecha. Ejemplo: "enero 7" o "enero-07".'];
            }
        }

        $suc_obj = null;
        if (!empty($nueva_sucursal_q)) {
            $suc_obj = $this->find_sucursal($nueva_sucursal_q);
            if (!$suc_obj) {
                $nombres = implode(', ', array_column($this->sucursales, 'nombre'));
                return ['success' => false, 'mensaje' => "No reconozco esa sucursal. Opciones: $nombres."];
            }
        }

        if (!$fecha_obj && !$suc_obj) {
            return ['success' => false, 'mensaje' => 'No se especificaron cambios.'];
        }

        // Plan item replacements (only for items that use fecha/sucursal attributes)
        $plan = [];
        foreach ($order->get_items() as $item_id => $item) {
            /** @var WC_Order_Item_Product $item */
            $qty = $item->get_quantity();
            if ($qty <= 0) continue;

            $variation_id = absint($item->get_variation_id());
            $parent_id = absint($item->get_product_id());

            $prod_for_attrs = $variation_id > 0 ? wc_get_product($variation_id) : wc_get_product($parent_id);
            if (!$prod_for_attrs || !method_exists($prod_for_attrs, 'get_attributes')) continue;

            $attrs = $prod_for_attrs->get_attributes();
            if (!is_array($attrs)) $attrs = [];

            $cur_fecha = null;
            foreach ($fecha_keys as $k) { if (isset($attrs[$k]) && $attrs[$k] !== '') { $cur_fecha = (string)$attrs[$k]; break; } }
            $cur_suc = null;
            foreach ($suc_keys as $k) { if (isset($attrs[$k]) && $attrs[$k] !== '') { $cur_suc = (string)$attrs[$k]; break; } }

            // Not a delivery-aware item
            if (!$cur_fecha || !$cur_suc) continue;

            $target_fecha_slug = $fecha_obj ? $fecha_obj['slug'] : sanitize_title($cur_fecha);
            $target_suc_slug = $suc_obj ? $suc_obj['slug'] : sanitize_title($cur_suc);

            // Cerebro Maestro validation if available
            if (function_exists('tagers_validar_fecha_master')) {
                if (!tagers_validar_fecha_master($target_fecha_slug, 'web', $parent_id)) {
                    return [
                        'success' => false,
                        'mensaje' => 'La nueva fecha no está disponible para compra en línea. Elige otra fecha o pasa a sucursal.',
                    ];
                }
            } else {
                // Fallback to simple rules
                if ($fecha_obj) {
                    $cerebro = $this->verificar_cerebro($fecha_obj);
                    if (!$cerebro['permite']) {
                        return ['success' => false, 'mensaje' => $cerebro['mensaje']];
                    }
                }
            }

            // Find matching variation in the same parent product
            $stock = $this->verificar_stock_wc(
                $parent_id,
                ['slug' => $target_fecha_slug],
                ['slug' => $target_suc_slug],
                $qty,
                $assistant
            );

            if (!$stock['disponible'] || empty($stock['variation_id'])) {
                return [
                    'success' => false,
                    'mensaje' => 'No hay disponibilidad para el cambio (fecha/sucursal) en uno de los productos del pedido.',
                    'detalle' => [
                        'item' => $item->get_name(),
                        'fecha' => $target_fecha_slug,
                        'sucursal' => $target_suc_slug,
                    ],
                ];
            }

            $new_var_id = absint($stock['variation_id']);
            if ($variation_id === $new_var_id) continue; // already correct

            // Preserve important meta flags (gift, etc.)
            $preserve_meta = [];
            foreach ($item->get_meta_data() as $md) {
                $k = $md->key;
                if (in_array($k, ['_es_regalo_auto', '_tagers_promo_applied'], true)) {
                    $preserve_meta[$k] = $md->value;
                }
            }

            $plan[] = [
                'old_item_id' => $item_id,
                'parent_id' => $parent_id,
                'new_variation_id' => $new_var_id,
                'qty' => $qty,
                'preserve_meta' => $preserve_meta,
                'name' => $item->get_name(),
            ];
        }

        // Apply item changes
        if (!empty($plan)) {
            foreach ($plan as $chg) {
                $order->remove_item($chg['old_item_id']);
                $new_prod = wc_get_product($chg['new_variation_id']);
                if (!$new_prod) {
                    return new WP_Error('variation_not_found', 'No se pudo cargar la nueva variación', ['status' => 500]);
                }
                $new_item_id = $order->add_product($new_prod, $chg['qty']);
                if ($new_item_id && !empty($chg['preserve_meta'])) {
                    foreach ($chg['preserve_meta'] as $mk => $mv) {
                        wc_add_order_item_meta($new_item_id, $mk, $mv, true);
                    }
                }
            }
            $order->calculate_totals();
            $cambios[] = 'Actualicé las variaciones de entrega en los productos.';
        }

        
// Update order meta (delivery summary)
if ($fecha_obj) {
    $order->update_meta_data('_tagers_fecha_entrega_iso', $fecha_obj['fecha_iso']);
    $order->update_meta_data('_tagers_fecha_entrega_slug', $fecha_obj['slug']);
    $order->update_meta_data('_tagers_fecha_entrega_h', $fecha_obj['nombre']);

    // Canonical key depends on Ops Core presence
    if ($this->is_ops_core_active()) {
        $order->update_meta_data('_tagers_fecha_entrega', $fecha_obj['slug']);
    } else {
        $order->update_meta_data('_tagers_fecha_entrega', $fecha_obj['fecha_iso']);
    }

    $cambios[] = 'Fecha: ' . $fecha_obj['nombre'];
}
if ($suc_obj) {
    // Legacy CS keys
    $order->update_meta_data('_tagers_sucursal', $suc_obj['nombre']);
    $order->update_meta_data('_tagers_sucursal_slug', $suc_obj['slug']);

    // Ops Core-compatible keys (do not collide)
    $order->update_meta_data('_tagers_sucursal_entrega', $suc_obj['slug']);
    $order->update_meta_data('_tagers_sucursal_entrega_h', $suc_obj['nombre']);

    $cambios[] = 'Sucursal: ' . $suc_obj['nombre'];
}
$order->add_order_note('Cambio vía Bot CS: ' . implode(', ', $cambios));
        $order->save();

        $this->log('cambio_entrega', 'cs', ['order_id' => $order_id, 'cambios' => $cambios, 'items_cambiados' => count($plan)]);

        return [
            'success' => true,
            'order_id' => $order_id,
            'cambios' => $cambios,
            // Preferred (KISS API) shape
            'changed_items' => array_map(function($p) {
                return [
                    'name' => $p['name'] ?? null,
                    'qty' => $p['qty'] ?? null,
                    'new_variation_id' => $p['new_variation_id'] ?? null,
                ];
            }, $plan),
            // Backwards-compatible count
            'items_cambiados' => count($plan),
            'mensaje' => 'Listo, actualicé tu pedido: ' . implode(', ', $cambios),
        ];
    }
    
    public function cs_cliente_historial($request) {
        $phone = sanitize_text_field($request->get_param('phone') ?? '');
        if (empty($phone)) return ['es_cliente_nuevo' => true];
        if (!function_exists('wc_get_orders')) return ['es_cliente_nuevo' => true];
        
        $phone_clean = preg_replace('/[^0-9]/', '', $phone);
        $orders = wc_get_orders(['meta_query' => [['key' => '_billing_phone', 'value' => substr($phone_clean, -10), 'compare' => 'LIKE']], 'limit' => 20, 'status' => ['completed', 'processing']]);
        if (empty($orders)) return ['es_cliente_nuevo' => true, 'mensaje_bienvenida' => 'Bienvenido a Tagers!'];
        
        $total_pedidos = count($orders); $total_gastado = 0; $productos = []; $nombre = '';
        foreach ($orders as $order) {
            $total_gastado += $order->get_total();
            if (!$nombre) $nombre = $order->get_billing_first_name();
            foreach ($order->get_items() as $item) { $pn = $item->get_name(); $productos[$pn] = ($productos[$pn] ?? 0) + $item->get_quantity(); }
        }
        arsort($productos);
        
        return ['es_cliente_nuevo' => false, 'nombre' => $nombre, 'estadisticas' => ['total_pedidos' => $total_pedidos, 'total_gastado' => $total_gastado, 'total_gastado_display' => '$' . number_format($total_gastado, 0) . ' MXN'], 'preferencias' => ['producto_favorito' => key($productos), 'productos' => $productos], 'mensaje_bienvenida' => "Hola $nombre! Que gusto verte de nuevo."];
    }
    
    public function cs_analyze_crisis($request) {
        $params = $request->get_json_params();
        $message = strtolower($params['message'] ?? '');
        $patterns = ['COMPLAINT' => ['queja', 'reclamo', 'mal servicio', 'tardaron', 'espere', 'grosero', 'pesimo', 'horrible'], 'REFUND' => ['reembolso', 'devolucion', 'devolver', 'cobro doble', 'me cobraron'], 'LOST_ITEM' => ['perdi', 'deje', 'olvide', 'se me quedo'], 'HEALTH' => ['enferme', 'intoxicacion', 'pelo en', 'cabello', 'insecto']];
        $detected = [];
        foreach ($patterns as $type => $kws) { foreach ($kws as $kw) { if (strpos($message, $kw) !== false) { $detected[$type] = true; break; } } }
        if (empty($detected)) return ['is_crisis' => false, 'types' => [], 'severity' => 'none'];
        $severity = (isset($detected['HEALTH']) || isset($detected['REFUND'])) ? 'high' : 'medium';
        return ['is_crisis' => true, 'types' => array_keys($detected), 'severity' => $severity, 'recommended_action' => 'escalate_to_human'];
    }
    
    // ====================== OPS MODULE ======================
    
    private function register_ops_routes() {
        $ns = 'tagers-ops/v1';
        register_rest_route($ns, '/production-summary', ['methods' => 'GET', 'callback' => [$this, 'ops_production_summary'], 'permission_callback' => [$this, 'verify_ops_token']]);
        register_rest_route($ns, '/orders-by-date', ['methods' => 'GET', 'callback' => [$this, 'ops_orders_by_date'], 'permission_callback' => [$this, 'verify_ops_token']]);
        register_rest_route($ns, '/inventory-status', ['methods' => 'GET', 'callback' => [$this, 'ops_inventory_status'], 'permission_callback' => [$this, 'verify_ops_token']]);
    }
    
    public function verify_ops_token($request) {
        $token = $request->get_header('X-Tagers-Ops-Token');
        if (empty($token) || $token !== $this->config['tokens']['ops']) return new WP_Error('unauthorized', 'Token OPS invalido', ['status' => 403]);
        return true;
    }
    
    public function ops_production_summary($request) {
        $date = sanitize_text_field($request->get_param('date') ?? date('Y-m-d'));
        if (!function_exists('wc_get_orders')) return ['fecha' => $date, 'total_pedidos' => 0];
        
        
$orders = wc_get_orders([
    'limit' => -1,
    'status' => ['processing', 'on-hold'],
    
'meta_query' => [
    'relation' => 'AND',
    [
        'relation' => 'OR',
        ['key' => '_tagers_fecha_entrega_iso', 'value' => $date, 'compare' => 'LIKE'],
        ['key' => '_tagers_fecha_entrega', 'value' => $date, 'compare' => 'LIKE'],
    ],
]]);
$by_product = []; $by_sucursal = []; $total_items = 0;
        foreach ($orders as $order) {
            $sucursal = $order->get_meta('_tagers_sucursal') ?: 'Sin asignar';
            foreach ($order->get_items() as $item) {
                $name = $item->get_name(); $qty = $item->get_quantity();
                $by_product[$name] = ($by_product[$name] ?? 0) + $qty;
                if (!isset($by_sucursal[$sucursal])) $by_sucursal[$sucursal] = [];
                $by_sucursal[$sucursal][$name] = ($by_sucursal[$sucursal][$name] ?? 0) + $qty;
                $total_items += $qty;
            }
        }
        return ['fecha' => $date, 'total_pedidos' => count($orders), 'total_items' => $total_items, 'por_producto' => $by_product, 'por_sucursal' => $by_sucursal];
    }
    
    public function ops_orders_by_date($request) {
        $date = sanitize_text_field($request->get_param('date') ?? date('Y-m-d'));
        $sucursal = sanitize_text_field($request->get_param('sucursal') ?? '');
        if (!function_exists('wc_get_orders')) return ['fecha' => $date, 'pedidos' => []];
        
        
$args = [
    'limit' => 100,
    'status' => ['processing', 'on-hold', 'completed'],
    'meta_query' => [
        'relation' => 'OR',
        ['key' => '_tagers_fecha_entrega_iso', 'value' => $date, 'compare' => 'LIKE'],
        ['key' => '_tagers_fecha_entrega', 'value' => $date, 'compare' => 'LIKE'],
    ]
];
        if ($sucursal) $args['meta_query'][] = ['key' => '_tagers_sucursal', 'value' => $sucursal, 'compare' => 'LIKE'];
        $orders = wc_get_orders($args);
        return ['fecha' => $date, 'sucursal_filtro' => $sucursal ?: 'todas', 'pedidos' => array_map([$this, 'format_order_ops'], $orders)];
    }
    
    public function ops_inventory_status($request) {
        return ['timestamp' => current_time('mysql'), 'productos' => [], 'alertas' => []];
    }
    
    // ====================== BRIDGE MODULE ======================
    
    private function register_bridge_routes() {
        register_rest_route('tagers-kiss/v1', '/beacon', ['methods' => 'POST', 'callback' => [$this, 'bridge_receive_beacon'], 'permission_callback' => [$this, 'verify_bridge_token']]);
        register_rest_route('tagers-kiss/v1', '/health', ['methods' => 'GET', 'callback' => [$this, 'bridge_health'], 'permission_callback' => '__return_true']);
    }
    
    public function verify_bridge_token($request) {
        $token = $request->get_header('X-Tagers-Token');
        if (empty($token) || $token !== $this->config['tokens']['bridge']) return new WP_Error('unauthorized', 'Token Bridge invalido', ['status' => 403]);
        return true;
    }
    
    public function bridge_receive_beacon($request) {
        $beacon = $request->get_json_params();
        if (empty($beacon['beacon_type'])) return new WP_Error('invalid_beacon', 'beacon_type requerido', ['status' => 400]);
        
        $this->log('beacon_received', 'bridge', ['type' => $beacon['beacon_type'], 'source' => $beacon['source'] ?? 'unknown']);
        
        $api_url = $this->config['kiss_api_url'];
        $secret = $this->config['kiss_api_secret'];
        if (empty($api_url)) return ['success' => true, 'forwarded' => false, 'reason' => 'KISS API URL not configured', 'stored_locally' => true];
        
        $timestamp = time();
        $body_json = wp_json_encode($beacon);
        $signature = hash_hmac('sha256', "$timestamp.$body_json", $secret);
        
        $response = wp_remote_post("$api_url/kiss/ingest", ['headers' => ['Content-Type' => 'application/json', 'X-Tagers-Timestamp' => $timestamp, 'X-Tagers-Signature' => $signature], 'body' => $body_json, 'timeout' => 10]);
        if (is_wp_error($response)) { $this->log('beacon_forward_error', 'bridge', ['error' => $response->get_error_message()]); return ['success' => true, 'forwarded' => false, 'error' => $response->get_error_message()]; }
        $code = wp_remote_retrieve_response_code($response);
        return ['success' => true, 'forwarded' => $code >= 200 && $code < 300, 'kiss_response_code' => $code];
    }
    
    public function bridge_health($request) {
        return ['status' => 'ok', 'version' => TAGERS_KISS_VERSION, 'kiss_api_configured' => !empty($this->config['kiss_api_url']), 'modules' => $this->config['modules']];
    }
    
    // ====================== CEDIS MODULE ======================
    
    private function register_cedis_routes() {
        register_rest_route('tagers-cedis/v1', '/production-orders', ['methods' => 'GET', 'callback' => [$this, 'cedis_production_orders'], 'permission_callback' => [$this, 'verify_cedis_token']]);
    }
    
    public function verify_cedis_token($request) {
        $token = $request->get_header('X-Tagers-CEDIS-Token');
        if (empty($token) || $token !== $this->config['tokens']['cedis']) return new WP_Error('unauthorized', 'Token CEDIS invalido', ['status' => 403]);
        return true;
    }
    
    public function cedis_production_orders($request) { return ['orders' => [], 'message' => 'CEDIS module placeholder']; }
    
    // ====================== RUNNER MODULE ======================
    
    private function register_runner_routes() {
        register_rest_route('tagers-runner/v1', '/deliveries', ['methods' => 'GET', 'callback' => [$this, 'runner_deliveries'], 'permission_callback' => [$this, 'verify_runner_token']]);
    }
    
    public function verify_runner_token($request) {
        $token = $request->get_header('X-Tagers-Runner-Token');
        if (empty($token) || $token !== $this->config['tokens']['runner']) return new WP_Error('unauthorized', 'Token Runner invalido', ['status' => 403]);
        return true;
    }
    
    public function runner_deliveries($request) { return ['deliveries' => [], 'message' => 'Runner module placeholder']; }
    
    // ====================== HELPERS ======================
    
    public function find_producto($query) {
        $query = strtolower(trim($query));
        foreach ($this->productos_rosca as $k => $prod) {
            // Match by key directly (e.g. "tradicional")
            if ($k && strpos($query, $k) !== false) {
                return array_merge($prod, ['key' => $k]);
            }
            foreach ($prod['aliases'] as $alias) {
                if (strpos($query, $alias) !== false) {
                    return array_merge($prod, ['key' => $k]);
                }
            }
        }
        return null;
    }
    
    public function find_sucursal($query) {
        $query = strtolower(trim($query));
        // Normalize common separators so inputs like "SAN_ANGEL" or "5_SUR" match aliases.
        $query_norm = str_replace(['_', '-'], ' ', $query);
        $query_norm = preg_replace('/\s+/', ' ', $query_norm);

        foreach ($this->sucursales as $suc) {
            $branch_id = strtolower($suc['branch_id'] ?? '');
            $slug = strtolower($suc['slug'] ?? '');
            if ($branch_id && ($query === $branch_id || $query_norm === str_replace('_', ' ', $branch_id))) {
                return $suc;
            }
            if ($slug && ($query === $slug || $query_norm === str_replace('-', ' ', $slug))) {
                return $suc;
            }

            foreach (($suc['aliases'] ?? []) as $alias) {
                $a = strtolower(trim($alias));
                if ($a && (strpos($query, $a) !== false || strpos($query_norm, $a) !== false)) {
                    return $suc;
                }
            }
        }
        return null;
    }
    
    public function parse_fecha($query) {
        $query = strtolower(trim($query));
        // Allow slugs like "enero-06" by normalizing separators.
        $query = str_replace(['-', '_'], ' ', $query);
        $query = preg_replace('/\s+/', ' ', $query);
        $tz = new DateTimeZone('America/Mexico_City');
        $now = new DateTime('now', $tz);
        $meses = ['enero' => 1, 'febrero' => 2, 'marzo' => 3, 'abril' => 4, 'mayo' => 5, 'junio' => 6, 'julio' => 7, 'agosto' => 8, 'septiembre' => 9, 'octubre' => 10, 'noviembre' => 11, 'diciembre' => 12];
        $meses_nombres = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        $dias_nombres = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
        
        $fecha = null;
        if (preg_match('/\b(hoy|ahora|ahorita)\b/', $query)) { $fecha = clone $now; }
        elseif (preg_match('/\b(manana)\b/', $query) && !preg_match('/pasado/', $query)) { $fecha = clone $now; $fecha->modify('+1 day'); }
        elseif (preg_match('/\b(pasado\s*manana)\b/', $query)) { $fecha = clone $now; $fecha->modify('+2 days'); }
        else {
            foreach ($meses as $mes_nombre => $mes_num) {
                if (preg_match("/(\d{1,2})\s*(?:de\s*)?$mes_nombre/", $query, $m) || preg_match("/$mes_nombre\s*(\d{1,2})/", $query, $m)) {
                    $dia = (int)$m[1]; $year = (int)$now->format('Y'); $mes_actual = (int)$now->format('n');
                    if ($mes_num < $mes_actual || ($mes_num == $mes_actual && $dia < (int)$now->format('j'))) $year++;
                    try { $fecha = new DateTime("$year-$mes_num-$dia", $tz); } catch (Exception $e) { return null; }
                    break;
                }
            }
        }
        if (!$fecha) return null;
        
        $mes_num = (int)$fecha->format('n'); $dia_num = (int)$fecha->format('j'); $dia_semana = (int)$fecha->format('w');
        return ['slug' => strtolower($meses_nombres[$mes_num]) . '-' . str_pad($dia_num, 2, '0', STR_PAD_LEFT), 'nombre' => $dias_nombres[$dia_semana] . ' ' . $dia_num . ' de ' . $meses_nombres[$mes_num], 'fecha_iso' => $fecha->format('Y-m-d'), 'fecha_obj' => $fecha];
    }
    
    public function verificar_cerebro($fecha) {
        $tz = new DateTimeZone('America/Mexico_City');
        $now = new DateTime('now', $tz);
        $fecha_obj = $fecha['fecha_obj'];
        $diff = $now->diff($fecha_obj);
        $dias = $diff->invert ? -$diff->days : $diff->days;
        $mes_dia = $fecha_obj->format('m-d');
        
        if ($mes_dia === '12-25') return ['permite' => false, 'mensaje' => 'El 25 de diciembre estamos cerrados.'];
        if ($dias <= 0) {
            if ($mes_dia === '12-24') return ['permite' => true, 'mensaje' => null, 'nota' => 'venta_sucursal'];
            return ['permite' => false, 'mensaje' => 'Para hoy no hay pedidos en linea, pero puedes pasar a cualquier sucursal.'];
        }
        if ($dias === 1) return ['permite' => false, 'mensaje' => 'Para manana ya cerramos pedidos en linea. Prueba en sucursal o elige otra fecha.'];
        return ['permite' => true, 'mensaje' => null];
    }
    
    public function verificar_stock_wc($product_or_id, $fecha, $sucursal, $cantidad, $assistant = null) {
        // Returns: disponible, variation_id (if variable), cantidad (stock qty if known), precio_unitario (best-effort)
        if (!function_exists('wc_get_product')) {
            return ['disponible' => true, 'variation_id' => null, 'cantidad' => 50];
        }

        $assistant = is_array($assistant) ? $assistant : $this->get_assistant_config();
        $attr_fecha_cfg = $assistant['order']['attribute_fecha'] ?? 'pa_fecha-de-entrega';
        $attr_suc_cfg = $assistant['order']['attribute_sucursal'] ?? 'pa_sucursal-de-entrega';

        // Normalize potential keys for variation attributes
        $fecha_keys = array_unique([
            $attr_fecha_cfg,
            preg_replace('/^pa_/', '', $attr_fecha_cfg),
            'pa_fecha-de-entrega',
            'fecha-de-entrega',
        ]);
        $suc_keys = array_unique([
            $attr_suc_cfg,
            preg_replace('/^pa_/', '', $attr_suc_cfg),
            'pa_sucursal-de-entrega',
            'sucursal-de-entrega',
        ]);

        $wc_product_id = 0;
        if (is_numeric($product_or_id)) {
            $wc_product_id = absint($product_or_id);
        } elseif (is_array($product_or_id) && function_exists('wc_get_products')) {
            // Backward compatible: resolve by name
            $needle = sanitize_text_field($product_or_id['nombre_corto'] ?? ($product_or_id['nombre'] ?? ''));
            if (!empty($needle)) {
                $candidates = wc_get_products([
                    'status' => 'publish',
                    'limit' => 5,
                    's' => $needle,
                ]);
                foreach (($candidates ?: []) as $p) {
                    if ($p && method_exists($p, 'is_type') && $p->is_type('variable')) {
                        $wc_product_id = absint($p->get_id());
                        break;
                    }
                }
                if ($wc_product_id <= 0 && !empty($candidates)) {
                    $wc_product_id = absint($candidates[0]->get_id());
                }
            }
        }

        if ($wc_product_id <= 0) {
            return ['disponible' => false, 'mensaje' => 'Producto WooCommerce no encontrado', 'cantidad' => 0];
        }

        $wc_prod = wc_get_product($wc_product_id);
        if (!$wc_prod) {
            return ['disponible' => false, 'mensaje' => 'Producto WooCommerce no encontrado', 'cantidad' => 0];
        }

        // Simple products
        if (!$wc_prod->is_type('variable')) {
            if ($wc_prod->managing_stock()) {
                $stock = $wc_prod->get_stock_quantity();
                if (is_numeric($stock) && $stock < $cantidad) {
                    return ['disponible' => false, 'mensaje' => "Solo quedan $stock.", 'cantidad' => $stock, 'variation_id' => null];
                }
                return ['disponible' => true, 'variation_id' => null, 'cantidad' => $stock, 'precio_unitario' => $wc_prod->get_price()];
            }
            return ['disponible' => true, 'variation_id' => null, 'cantidad' => null, 'precio_unitario' => $wc_prod->get_price()];
        }

        // Variable products: locate matching variation by attributes
        $fecha_slug = sanitize_title($fecha['slug'] ?? '');
        $suc_slug = sanitize_title($sucursal['slug'] ?? '');

        if (empty($fecha_slug) || empty($suc_slug)) {
            return ['disponible' => false, 'mensaje' => 'Falta fecha o sucursal para validar variación', 'cantidad' => 0];
        }

        foreach ($wc_prod->get_children() as $vid) {
            $child = wc_get_product($vid);
            if (!$child) continue;

            // Skip non-purchasable variations
            if (method_exists($child, 'is_purchasable') && !$child->is_purchasable()) continue;
            if (method_exists($child, 'is_in_stock') && !$child->is_in_stock()) continue;

            $attrs = $child->get_attributes();
            $v_fecha = null;
            foreach ($fecha_keys as $k) {
                if (isset($attrs[$k]) && $attrs[$k] !== '') { $v_fecha = (string)$attrs[$k]; break; }
            }
            $v_suc = null;
            foreach ($suc_keys as $k) {
                if (isset($attrs[$k]) && $attrs[$k] !== '') { $v_suc = (string)$attrs[$k]; break; }
            }

            if (!$v_fecha || !$v_suc) continue;
            if (sanitize_title($v_fecha) !== $fecha_slug) continue;
            if (sanitize_title($v_suc) !== $suc_slug) continue;

            // Stock
            if ($child->managing_stock()) {
                $stock = $child->get_stock_quantity();
                if (is_numeric($stock) && $stock < $cantidad) {
                    return ['disponible' => false, 'mensaje' => "Solo quedan $stock.", 'cantidad' => $stock, 'variation_id' => absint($vid)];
                }
                return ['disponible' => true, 'variation_id' => absint($vid), 'cantidad' => $stock, 'precio_unitario' => $child->get_price()];
            }
            return ['disponible' => true, 'variation_id' => absint($vid), 'cantidad' => null, 'precio_unitario' => $child->get_price()];
        }

        return ['disponible' => false, 'mensaje' => 'No encontré esa combinación de fecha y sucursal en WooCommerce.', 'cantidad' => 0];
    }
    
    public function get_fechas_disponibles() {
        $tz = new DateTimeZone('America/Mexico_City');
        $now = new DateTime('now', $tz);
        $fechas = [];
        $meses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        $dias = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];
        for ($i = 2; $i <= 14; $i++) {
            $fecha = clone $now; $fecha->modify("+$i days");
            if ($fecha->format('m-d') === '12-25') continue;
            $m = (int)$fecha->format('n'); $d = (int)$fecha->format('j'); $w = (int)$fecha->format('w');
            $fechas[] = ['slug' => strtolower($meses[$m]) . '-' . str_pad($d, 2, '0', STR_PAD_LEFT), 'nombre' => $dias[$w] . ' ' . $d . ' de ' . $meses[$m], 'fecha_iso' => $fecha->format('Y-m-d')];
        }
        return $fechas;
    }
    
    private function format_order($order) {
        $items = [];
        try {
            foreach ($order->get_items() as $it) {
                $items[] = [
                    // English keys (used by KISS API)
                    'name' => $it->get_name(),
                    'quantity' => $it->get_quantity(),
                    // Spanish aliases (backwards compatible)
                    'nombre' => $it->get_name(),
                    'cantidad' => $it->get_quantity(),
                ];
            }
        } catch (Exception $e) {
            $items = [];
        }

        $created = null;
        try {
            $dt = $order->get_date_created();
            $created = $dt ? $dt->date('Y-m-d H:i:s') : null;
        } catch (Exception $e) {
            $created = null;
        }

// Delivery meta (compat): Ops Core uses _tagers_fecha_entrega as slug, CS legacy uses it as ISO.
$fecha_iso = $order->get_meta('_tagers_fecha_entrega_iso');
$fecha_raw = $order->get_meta('_tagers_fecha_entrega');
$fecha_slug = $order->get_meta('_tagers_fecha_entrega_slug');
$fecha_h = $order->get_meta('_tagers_fecha_entrega_h');

if (empty($fecha_iso) && is_string($fecha_raw) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha_raw)) {
    $fecha_iso = $fecha_raw;
}
if (empty($fecha_slug) && is_string($fecha_raw) && $fecha_raw !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $fecha_raw)) {
    $fecha_slug = $fecha_raw;
}

$suc_h = $order->get_meta('_tagers_sucursal_entrega_h');
$suc_slug = $order->get_meta('_tagers_sucursal_entrega');
$legacy_suc = $order->get_meta('_tagers_sucursal');
$legacy_suc_slug = $order->get_meta('_tagers_sucursal_slug');

if (empty($suc_h)) $suc_h = $legacy_suc;
if (empty($suc_slug)) $suc_slug = $legacy_suc_slug;

$entrega_fecha = $fecha_iso ?: ($fecha_h ?: ($fecha_slug ?: $fecha_raw));
$entrega_suc = $suc_h ?: ($suc_slug ?: $legacy_suc);

$id = $order->get_id();
return [

            // Standard envelope-ish flags
            'success' => true,
            'encontrado' => true,
            // Preferred identifier
            'id' => $id,
            // Backwards-compatible identifier
            'order_id' => $id,
            'status' => $order->get_status(),
            'status_label' => wc_get_order_status_name($order->get_status()),
            'total' => $order->get_total(),
            'total_display' => $order->get_formatted_order_total(),
            'date_created' => $created,
            'items' => $items,
            
'entrega' => [
    'fecha' => $entrega_fecha,
    'sucursal' => $entrega_suc,
    'fecha_iso' => $fecha_iso ?: null,
    'fecha_slug' => $fecha_slug ?: null,
    'fecha_h' => $fecha_h ?: null,
    'sucursal_slug' => $suc_slug ?: null,
    'sucursal_h' => $suc_h ?: null,
],
'puede_modificar' => in_array($order->get_status(), ['pending', 'processing', 'on-hold']),
        ];
    }
    
    private function format_order_ops($order) {
        $items = [];
        foreach ($order->get_items() as $item) $items[] = ['nombre' => $item->get_name(), 'cantidad' => $item->get_quantity()];
        return ['order_id' => $order->get_id(), 'cliente' => $order->get_billing_first_name() . ' ' . $order->get_billing_last_name(), 'telefono' => $order->get_billing_phone(), 'status' => $order->get_status(), 'items' => $items, 'entrega' => ['fecha' => ($order->get_meta('_tagers_fecha_entrega_iso') ?: $order->get_meta('_tagers_fecha_entrega')),'sucursal' => ($order->get_meta('_tagers_sucursal_entrega_h') ?: $order->get_meta('_tagers_sucursal')),'fecha_iso' => ($order->get_meta('_tagers_fecha_entrega_iso') ?: null),'sucursal_slug' => ($order->get_meta('_tagers_sucursal_entrega') ?: $order->get_meta('_tagers_sucursal_slug'))]];
    }
    
    // ====================== LOGGING ======================
    
    public function log($event, $module, $data = []) {
        global $wpdb;
        $table = $wpdb->prefix . 'tagers_kiss_log';
        $wpdb->insert($table, ['event' => $event, 'module' => $module, 'data' => wp_json_encode($data), 'ip' => $_SERVER['REMOTE_ADDR'] ?? '', 'created_at' => current_time('mysql')]);
        if (defined('WP_DEBUG') && WP_DEBUG) error_log("[TAGERS-KISS][$module] $event: " . wp_json_encode($data));
    }
    
    // ====================== ADMIN ======================
    
    public function admin_menu() {
        add_menu_page('Tagers KISS', 'Tagers KISS', 'manage_options', 'tagers-kiss', [$this, 'admin_page'], 'dashicons-food', 30);
    }
    
    public function register_settings() {
        foreach (['cs', 'ops', 'cedis', 'runner', 'bridge'] as $t) register_setting('tagers_kiss', "tagers_token_$t");
        register_setting('tagers_kiss', 'tagers_kiss_api_url');
        register_setting('tagers_kiss', 'tagers_kiss_api_secret');
        register_setting('tagers_kiss', 'tagers_promo_activa');
        register_setting('tagers_kiss', 'tagers_promo_mensaje');
        register_setting('tagers_kiss', 'tagers_promo_ratio');
        register_setting('tagers_kiss', 'tagers_promo_regalo');

        // Assistant (Tania) configurable inputs (Marketing / CS)
        register_setting('tagers_kiss', 'tagers_tania_philosophy');
        register_setting('tagers_kiss', 'tagers_tania_tone');
        register_setting('tagers_kiss', 'tagers_tania_do');
        register_setting('tagers_kiss', 'tagers_tania_dont');
        register_setting('tagers_kiss', 'tagers_assistant_links_json');
        register_setting('tagers_kiss', 'tagers_assistant_faq_json');
        register_setting('tagers_kiss', 'tagers_assistant_lead_routing_json');
        register_setting('tagers_kiss', 'tagers_cs_order_mode');
        register_setting('tagers_kiss', 'tagers_rosca_wc_product_map_json');
        register_setting('tagers_kiss', 'tagers_rosca_wc_attribute_fecha');
        register_setting('tagers_kiss', 'tagers_rosca_wc_attribute_sucursal');

        // Staging / QA
        register_setting('tagers_kiss', 'tagers_allow_test_endpoints');

        foreach (['cs', 'ops', 'bridge', 'cedis', 'runner'] as $m) register_setting('tagers_kiss', "tagers_module_$m");
    }

    /**
     * Save tokens reliably.
     *
     * We intentionally avoid options.php for tokens because some hardened
     * environments/security plugins strip or block fields that look like secrets.
     */
    public function handle_save_tokens() {
        if (!current_user_can('manage_options')) {
            wp_die('No autorizado.');
        }

        check_admin_referer('tagers_kiss_save_tokens');

        $keys = ['cs', 'ops', 'cedis', 'runner', 'bridge'];
        $regen_all = !empty($_POST['tagers_regen_all_tokens']);

        foreach ($keys as $k) {
            $opt = "tagers_token_{$k}";
            $current = (string) get_option($opt, '');

            if ($regen_all) {
                $new = "tagers_{$k}_" . wp_generate_password(16, false);
                update_option($opt, $new);
                continue;
            }

            $incoming = null;
            if (isset($_POST[$opt])) {
                $incoming = sanitize_text_field(wp_unslash($_POST[$opt]));
            }

            // Do not allow accidental wipe.
            $new = is_string($incoming) ? $incoming : $current;
            if ($new === '') {
                // If empty submission, keep current if present; otherwise generate.
                $new = $current !== '' ? $current : ("tagers_{$k}_" . wp_generate_password(16, false));
            }

            update_option($opt, $new);
        }

        // Reload cached config for the request.
        $this->load_config();
        $this->ensure_tokens();

        $url = add_query_arg([
            'page' => 'tagers-kiss',
            'tab' => 'tokens',
            'tokens-updated' => '1',
        ], admin_url('admin.php'));

        wp_safe_redirect($url);
        exit;
    }
    
    public function admin_page() {
        if (!current_user_can('manage_options')) return;
        $tab = isset($_GET['tab']) ? sanitize_text_field($_GET['tab']) : 'general';
        ?>
        <div class="wrap">
            <h1>Tagers KISS Unified v<?php echo esc_html(TAGERS_KISS_VERSION); ?></h1>
            <nav class="nav-tab-wrapper">
                <a href="?page=tagers-kiss&tab=general" class="nav-tab <?php echo $tab === 'general' ? 'nav-tab-active' : ''; ?>">General</a>
                <a href="?page=tagers-kiss&tab=tokens" class="nav-tab <?php echo $tab === 'tokens' ? 'nav-tab-active' : ''; ?>">Tokens</a>
                <a href="?page=tagers-kiss&tab=woocommerce" class="nav-tab <?php echo $tab === 'woocommerce' ? 'nav-tab-active' : ''; ?>">WooCommerce</a>
                <a href="?page=tagers-kiss&tab=endpoints" class="nav-tab <?php echo $tab === 'endpoints' ? 'nav-tab-active' : ''; ?>">Endpoints</a>
                <a href="?page=tagers-kiss&tab=logs" class="nav-tab <?php echo $tab === 'logs' ? 'nav-tab-active' : ''; ?>">Logs</a>
            </nav>
            <?php $is_tokens_tab = ($tab === 'tokens'); ?>
            <form method="post" action="<?php echo esc_url($is_tokens_tab ? admin_url('admin-post.php') : 'options.php'); ?>">
                <?php if ($is_tokens_tab): ?>
                    <?php wp_nonce_field('tagers_kiss_save_tokens'); ?>
                    <input type="hidden" name="action" value="tagers_kiss_save_tokens">
                <?php else: ?>
                    <?php settings_fields('tagers_kiss'); ?>
                <?php endif; ?>
                <?php if ($tab === 'general'): ?>
                    <h2>Modulos</h2>
                    <table class="form-table">
                        <?php foreach (['cs' => 'Customer Service', 'ops' => 'Operations', 'bridge' => 'Bridge', 'cedis' => 'CEDIS', 'runner' => 'Runner'] as $k => $l): ?>
                        <tr><th><?php echo $l; ?></th><td><input type="checkbox" name="tagers_module_<?php echo $k; ?>" value="1" <?php checked(get_option("tagers_module_$k", true)); ?>></td></tr>
                        <?php endforeach; ?>
                    </table>
                    <h2>KISS API</h2>
                    <table class="form-table">
                        <tr><th>URL</th><td><input type="url" name="tagers_kiss_api_url" value="<?php echo esc_attr(get_option('tagers_kiss_api_url')); ?>" class="regular-text"></td></tr>
                        <tr><th>HMAC Secret</th><td><input type="password" name="tagers_kiss_api_secret" value="<?php echo esc_attr(get_option('tagers_kiss_api_secret')); ?>" class="regular-text"></td></tr>
                    </table>
                <?php elseif ($tab === 'tokens'): ?>
                    <h2>Tokens</h2>
                    <?php if (!empty($_GET['tokens-updated'])): ?>
                        <div class="notice notice-success is-dismissible"><p>Tokens guardados.</p></div>
                    <?php endif; ?>

                    <p class="description">Tokens de autenticación para endpoints REST. Mantener privados.</p>
                    <p>
                        <button type="submit" name="tagers_regen_all_tokens" value="1" class="button"
                            onclick="return confirm('Esto regenerará TODOS los tokens y puede romper integraciones hasta que actualices KISS API/clients. ¿Continuar?');">
                            Regenerar todos los tokens (server-side)
                        </button>
                    </p>
                    <table class="form-table">
                        <?php foreach (['cs' => 'CS', 'ops' => 'OPS', 'cedis' => 'CEDIS', 'runner' => 'Runner', 'bridge' => 'Bridge'] as $k => $l): ?>
                        <tr>
                            <th><?php echo $l; ?></th>
                            <td>
                                <input type="text" name="tagers_token_<?php echo $k; ?>" value="<?php echo esc_attr(get_option("tagers_token_$k", '')); ?>" class="regular-text code" autocomplete="off">
                                <p class="description">Header: X-Tagers-<?php echo strtoupper($k); ?>-Token</p>
                            </td>
                        </tr>
                        <?php endforeach; ?>
                    </table>
                <?php elseif ($tab === 'woocommerce'): ?>
                    <h2>WooCommerce — Mapeo de Productos</h2>
                    <p class="description">Configuración para integración con WooCommerce. La configuración de productos y temporadas viene de <a href="<?php echo admin_url('tools.php?page=tagers-ana-config'); ?>">Ana Config Hub</a>.</p>

                    <h3>Pedidos</h3>
                    <table class="form-table">
                        <tr>
                            <th>Modo de creación</th>
                            <td>
                                <?php $mode = get_option('tagers_cs_order_mode', 'checkout_link'); ?>
                                <select name="tagers_cs_order_mode">
                                    <option value="checkout_link" <?php selected($mode, 'checkout_link'); ?>>Checkout link (add-to-cart)</option>
                                    <option value="draft_order" <?php selected($mode, 'draft_order'); ?>>Draft order + Payment URL</option>
                                </select>
                            </td>
                        </tr>
                        <tr>
                            <th>Mapa Roscas → product_id (JSON)</th>
                            <td>
                                <textarea name="tagers_rosca_wc_product_map_json" rows="4" class="large-text code"><?php echo esc_textarea(get_option('tagers_rosca_wc_product_map_json', '{}')); ?></textarea>
                                <p class="description">Ej: {"ROSCA-CLASICA":27422,"ROSCA-NUTELLA":27447}</p>
                            </td>
                        </tr>
                        <tr>
                            <th>Atributo fecha</th>
                            <td><input type="text" name="tagers_rosca_wc_attribute_fecha" value="<?php echo esc_attr(get_option('tagers_rosca_wc_attribute_fecha', 'pa_fecha-de-entrega')); ?>" class="regular-text code"></td>
                        </tr>
                        <tr>
                            <th>Atributo sucursal</th>
                            <td><input type="text" name="tagers_rosca_wc_attribute_sucursal" value="<?php echo esc_attr(get_option('tagers_rosca_wc_attribute_sucursal', 'pa_sucursal-de-entrega')); ?>" class="regular-text code"></td>
                        </tr>
                    </table>

                    <h3>Staging / QA</h3>
                    <table class="form-table">
                        <tr>
                            <th>Enable Test Endpoints</th>
                            <td>
                                <label>
                                    <input type="checkbox" name="tagers_allow_test_endpoints" value="1" <?php checked(get_option('tagers_allow_test_endpoints')); ?>>
                                    Habilitar endpoints <code>/test/*</code> (solo staging)
                                </label>
                            </td>
                        </tr>
                    </table>
                <?php elseif ($tab === 'endpoints'): ?>
                    <h2>Endpoints</h2>
                    <h3>CS (tagers-cs/v1)</h3>
                    <ul><li>GET /info-completa</li><li>GET /assistant-config</li><li>GET /product-search</li><li>POST /consulta-disponibilidad</li><li>POST /generar-link-compra</li><li>POST /crear-pedido</li><li>GET /buscar-pedido</li><li>POST /cambiar-entrega</li><li>GET /cliente-historial</li><li>POST /analyze-crisis</li><li>GET /test/ping</li><li>POST /test/void-order</li></ul>
                    <h3>OPS (tagers-ops/v1)</h3>
                    <ul><li>GET /production-summary</li><li>GET /orders-by-date</li><li>GET /inventory-status</li></ul>
                    <h3>Bridge (tagers-kiss/v1)</h3>
                    <ul><li>POST /beacon</li><li>GET /health</li></ul>
                    <h3>CEDIS (tagers-cedis/v1)</h3>
                    <ul><li>GET /production-orders</li></ul>
                    <h3>Runner (tagers-runner/v1)</h3>
                    <ul><li>GET /deliveries</li></ul>
                <?php elseif ($tab === 'logs'): ?>
                    <h2>Logs</h2>
                    <?php global $wpdb; $logs = $wpdb->get_results("SELECT * FROM {$wpdb->prefix}tagers_kiss_log ORDER BY id DESC LIMIT 50"); ?>
                    <table class="widefat"><thead><tr><th>ID</th><th>Module</th><th>Event</th><th>Data</th><th>IP</th><th>Date</th></tr></thead><tbody>
                    <?php if ($logs): foreach ($logs as $log): ?>
                        <tr><td><?php echo $log->id; ?></td><td><?php echo esc_html($log->module); ?></td><td><?php echo esc_html($log->event); ?></td><td><code style="font-size:10px"><?php echo esc_html(substr($log->data, 0, 80)); ?></code></td><td><?php echo esc_html($log->ip); ?></td><td><?php echo esc_html($log->created_at); ?></td></tr>
                    <?php endforeach; else: ?><tr><td colspan="6">No logs</td></tr><?php endif; ?>
                    </tbody></table>
                <?php endif; ?>
                <?php if (!in_array($tab, ['endpoints', 'logs'])): submit_button(); endif; ?>
            </form>
        </div>
        <?php
    }
}

function tagers_kiss() { return Tagers_KISS_Unified::instance(); }
add_action('plugins_loaded', 'tagers_kiss');

function tagers_find_sucursal($q) { return tagers_kiss()->find_sucursal($q); }
function tagers_find_producto($q) { return tagers_kiss()->find_producto($q); }
function tagers_get_sucursales() { return tagers_kiss()->sucursales; }
function tagers_get_productos_rosca() { return tagers_kiss()->productos_rosca; }

// ============================================================
// Cerebro Maestro v25 (fallback)
// ------------------------------------------------------------
// Si el proyecto ya lo define en Theme / mu-plugin, este bloque no se ejecuta.
// Se usa principalmente para validar disponibilidad de fechas en endpoints CS.
// ============================================================

if (!function_exists('tagers_validar_fecha_master')) {
    /**
     * Valida una fecha (slug) según reglas del "Cerebro".
     * @param string $valor_fecha Slug del atributo, ej: "enero-06"
     * @param string $contexto "web" o "pos"
     * @param int|null $product_id Producto WC para aplicar reglas por categoría
     * @return bool
     */
    function tagers_validar_fecha_master($valor_fecha, $contexto = 'web', $product_id = null) {
        // Cache en memoria por request
        static $cache = [];
        $key = $valor_fecha . '|' . $contexto . '|' . intval($product_id);
        if (isset($cache[$key])) return $cache[$key];

        // Parse fecha from slug (mes-dia)
        $parts = explode('-', sanitize_title($valor_fecha));
        if (count($parts) < 2) {
            $cache[$key] = false;
            return false;
        }
        $mes_str = $parts[0];
        $dia = intval($parts[1]);
        $mes_map = [
            'enero' => 1, 'febrero' => 2, 'marzo' => 3, 'abril' => 4, 'mayo' => 5, 'junio' => 6,
            'julio' => 7, 'agosto' => 8, 'septiembre' => 9, 'octubre' => 10, 'noviembre' => 11, 'diciembre' => 12,
        ];
        $mes = $mes_map[$mes_str] ?? 0;
        if ($mes < 1 || $mes > 12 || $dia < 1 || $dia > 31) {
            $cache[$key] = false;
            return false;
        }

        // Build date (assumes current year, rolls forward if needed)
        $tz = new DateTimeZone('America/Mexico_City');
        $today = new DateTime('today', $tz);
        $year = intval($today->format('Y'));
        $candidate = new DateTime(sprintf('%04d-%02d-%02d', $year, $mes, $dia), $tz);
        if ($candidate < $today) {
            $candidate = new DateTime(sprintf('%04d-%02d-%02d', $year + 1, $mes, $dia), $tz);
        }

        // Días restantes
        $diff = $today->diff($candidate);
        $dias_restantes = $diff->invert ? -$diff->days : $diff->days;

        // Categoría special: postres (solo D+2 mínimo)
        if (!empty($product_id) && function_exists('has_term')) {
            if (has_term('postres', 'product_cat', $product_id)) {
                $cache[$key] = ($dias_restantes >= 2);
                return $cache[$key];
            }
        }

        // Regla base: D+2 en adelante OK
        if ($dias_restantes >= 2) {
            $cache[$key] = true;
            return true;
        }

        // Día 0 (mismo día) tiene reglas especiales por temporada (Rosca)
        if ($dias_restantes === 0) {
            $dia_num = intval($candidate->format('j'));
            $mes_num = intval($candidate->format('n'));

            // Enero: 2-4 y 7-11 WEB+POS; 5-6 solo POS
            if ($mes_num === 1) {
                if (in_array($dia_num, [2, 3, 4, 7, 8, 9, 10, 11], true)) {
                    $cache[$key] = true;
                    return true;
                }
                if (in_array($dia_num, [5, 6], true)) {
                    $cache[$key] = ($contexto === 'pos');
                    return $cache[$key];
                }
            }

            // Diciembre: 24-31 solo POS
            if ($mes_num === 12 && $dia_num >= 24 && $dia_num <= 31) {
                $cache[$key] = ($contexto === 'pos');
                return $cache[$key];
            }

            // Otros: mismo día solo POS
            $cache[$key] = ($contexto === 'pos');
            return $cache[$key];
        }

        // D+1 (mañana) cerrado por defecto en web (y pos configurable)
        $cache[$key] = false;
        return false;
    }
}

// ============================================================
// Ana Studio - Config Hub Receiver v1.0
// ------------------------------------------------------------
// Recibe configuración centralizada desde el Config Hub (Railway)
// Endpoint: POST /tagers-ops/v1/update-config
// ============================================================

add_action('rest_api_init', function() {
    register_rest_route('tagers-ops/v1', '/update-config', [
        'methods' => 'POST',
        'callback' => 'tagers_ana_config_receiver',
        'permission_callback' => 'tagers_ana_config_verify_secret',
    ]);
});

/**
 * Verifica el secreto de sincronización
 */
function tagers_ana_config_verify_secret($request) {
    $secret = defined('TAGERS_CONFIG_SYNC_SECRET') ? TAGERS_CONFIG_SYNC_SECRET : '';
    if (empty($secret)) {
        return new WP_Error('config_error', 'TAGERS_CONFIG_SYNC_SECRET not defined in wp-config.php', ['status' => 500]);
    }
    
    $header_secret = $request->get_header('X-Tagers-Sync-Secret');
    if (empty($header_secret) || !hash_equals($secret, $header_secret)) {
        return new WP_Error('unauthorized', 'Invalid sync secret', ['status' => 401]);
    }
    
    return true;
}

/**
 * Recibe y almacena la configuración del Config Hub
 */
function tagers_ana_config_receiver($request) {
    $body = $request->get_json_params();
    
    if (empty($body) || !is_array($body)) {
        return new WP_Error('invalid_payload', 'Empty or invalid JSON payload', ['status' => 400]);
    }
    
    $version = $body['version'] ?? 0;
    $hash = $body['hash'] ?? '';
    
    // Guardar config completa (sin autoload para no sobrecargar)
    update_option('tagers_ana_config', $body, false);
    update_option('tagers_ana_config_version', $version);
    update_option('tagers_ana_config_hash', $hash);
    update_option('tagers_ana_config_updated_at', current_time('mysql'));
    
    // Extraer y guardar partes específicas con autoload para acceso rápido
    if (!empty($body['brand'])) {
        update_option('tagers_brand_config', $body['brand'], true);
    }
    
    if (!empty($body['branches'])) {
        update_option('tagers_branches_config', $body['branches'], true);
    }
    
    if (!empty($body['seasons'])) {
        update_option('tagers_seasons_config', $body['seasons'], true);
    }
    
    if (!empty($body['promos'])) {
        update_option('tagers_promos_config', $body['promos'], true);
    }
    
    if (!empty($body['push_rules'])) {
        update_option('tagers_push_rules_config', $body['push_rules'], true);
    }
    
    if (!empty($body['roscas'])) {
        update_option('tagers_roscas_config', $body['roscas'], true);
    }
    
    // Log
    global $wpdb;
    $table = $wpdb->prefix . 'tagers_kiss_log';
    $wpdb->insert($table, [
        'event' => 'config_sync',
        'module' => 'ana_config',
        'data' => json_encode(['version' => $version, 'hash' => substr($hash, 0, 16)]),
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'created_at' => current_time('mysql'),
    ]);
    
    return [
        'success' => true,
        'version' => $version,
        'message' => 'Config updated successfully',
    ];
}

// ============================================================
// Ana Config - Helper Functions
// ============================================================

/**
 * Obtiene la configuración completa de Ana
 */
function tagers_ana_get_config() {
    return get_option('tagers_ana_config', []);
}

/**
 * Obtiene información de una sucursal por ID
 */
function tagers_ana_get_branch($branch_id) {
    $branches = get_option('tagers_branches_config', []);
    foreach ($branches as $branch) {
        if (($branch['id'] ?? '') === $branch_id) {
            return $branch;
        }
    }
    return null;
}

/**
 * Obtiene la temporada activa actual
 */
function tagers_ana_get_active_season() {
    $seasons = get_option('tagers_seasons_config', []);
    $now = new DateTime('now', new DateTimeZone('America/Mexico_City'));
    
    foreach ($seasons as $season) {
        if (empty($season['enabled'])) continue;
        
        // Soporta ambos formatos: start_date/end_date y start_at/end_at
        $start_str = $season['start_at'] ?? $season['start_date'] ?? '2000-01-01';
        $end_str = $season['end_at'] ?? $season['end_date'] ?? '2000-01-01';
        
        $start = new DateTime($start_str);
        $end = new DateTime($end_str);
        $end->setTime(23, 59, 59); // Incluir todo el día final
        
        if ($now >= $start && $now <= $end) {
            return $season;
        }
    }
    return null;
}

/**
 * Obtiene la promo activa actual
 */
function tagers_ana_get_active_promo() {
    $promos = get_option('tagers_promos_config', []);
    $now = new DateTime('now', new DateTimeZone('America/Mexico_City'));
    
    foreach ($promos as $promo) {
        if (empty($promo['enabled'])) continue;
        
        $start = new DateTime($promo['start_at'] ?? '2000-01-01');
        $end = new DateTime($promo['end_at'] ?? '2000-01-01');
        
        if ($now >= $start && $now <= $end) {
            return $promo;
        }
    }
    return null;
}

/**
 * Obtiene las reglas de push para una fecha específica
 */
function tagers_ana_get_push_rules_for_date($date_str) {
    $rules = get_option('tagers_push_rules_config', []);
    $target = new DateTime($date_str, new DateTimeZone('America/Mexico_City'));
    $matching = [];
    
    foreach ($rules as $rule) {
        if (empty($rule['enabled'])) continue;
        
        $start = new DateTime($rule['start_date'] ?? '2000-01-01');
        $end = new DateTime($rule['end_date'] ?? '2000-01-01');
        
        if ($target >= $start && $target <= $end) {
            $matching[] = $rule;
        }
    }
    
    return $matching;
}

/**
 * Obtiene config de temporada para Cerebro Maestro
 * Integración con tagers_validar_fecha_master
 */
function tagers_get_season_config_from_ana() {
    $season = tagers_ana_get_active_season();
    if (!$season) {
        // Fallback a valores por defecto
        return [
            'end_date' => '2025-01-17',
            'min_lead_days' => 2,
            'enabled' => false,
        ];
    }
    
    return [
        'end_date' => $season['end_date'] ?? '2025-01-17',
        'min_lead_days' => $season['min_lead_days'] ?? 2,
        'enabled' => true,
        'name' => $season['name'] ?? '',
    ];
}

/**
 * Obtiene config de promo para Suite Promo
 */
function tagers_get_promo_config_from_ana() {
    $promo = tagers_ana_get_active_promo();
    if (!$promo) {
        return [
            'activo' => false,
        ];
    }
    
    return [
        'activo' => true,
        'nombre' => $promo['name'] ?? '',
        'mensaje' => $promo['message'] ?? '',
        'compra' => $promo['condition'] ?? '',
        'regalo' => $promo['reward'] ?? '',
        'fecha_inicio' => $promo['start_at'] ?? '',
        'fecha_fin' => $promo['end_at'] ?? '',
    ];
}

// ============================================================
// Ana Config - Admin Page (under Tools menu)
// ============================================================

add_action('admin_menu', function() {
    add_submenu_page(
        'tools.php',
        'Ana Config',
        'Ana Config',
        'manage_options',
        'tagers-ana-config',
        'tagers_ana_config_admin_page'
    );
});

function tagers_ana_config_admin_page() {
    $config = tagers_ana_get_config();
    $version = get_option('tagers_ana_config_version', 0);
    $hash = get_option('tagers_ana_config_hash', '');
    $updated = get_option('tagers_ana_config_updated_at', 'Never');
    $active_season = tagers_ana_get_active_season();
    $active_promo = tagers_ana_get_active_promo();
    ?>
    <div class="wrap">
        <h1>🤖 Ana Studio - Config Hub</h1>
        
        <div class="card" style="max-width: 600px; padding: 15px; margin-bottom: 20px;">
            <h3 style="margin-top: 0;">Estado de Configuración</h3>
            <table class="form-table">
                <tr>
                    <th>Versión:</th>
                    <td><strong><?php echo esc_html($version); ?></strong></td>
                </tr>
                <tr>
                    <th>Hash:</th>
                    <td><code><?php echo esc_html(substr($hash, 0, 16)); ?>...</code></td>
                </tr>
                <tr>
                    <th>Última actualización:</th>
                    <td><?php echo esc_html($updated); ?></td>
                </tr>
                <tr>
                    <th>Temporada activa:</th>
                    <td>
                        <?php if ($active_season): ?>
                            <span style="color: green;">✅ <?php echo esc_html($active_season['name'] ?? 'Sin nombre'); ?></span>
                            <br><small>Hasta: <?php echo esc_html($active_season['end_at'] ?? $active_season['end_date'] ?? 'N/A'); ?></small>
                        <?php else: ?>
                            <span style="color: gray;">❌ Ninguna</span>
                        <?php endif; ?>
                    </td>
                </tr>
                <tr>
                    <th>Promo activa:</th>
                    <td>
                        <?php if ($active_promo): ?>
                            <span style="color: green;">✅ <?php echo esc_html($active_promo['name'] ?? 'Sin nombre'); ?></span>
                            <br><small>Hasta: <?php echo esc_html($active_promo['end_at'] ?? 'N/A'); ?></small>
                        <?php else: ?>
                            <span style="color: gray;">❌ Ninguna</span>
                        <?php endif; ?>
                    </td>
                </tr>
            </table>
        </div>
        
        <h3>Configuración Completa (JSON)</h3>
        <textarea readonly style="width: 100%; height: 400px; font-family: monospace; font-size: 12px;"><?php 
            echo esc_textarea(json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); 
        ?></textarea>
        
        <p class="description">
            Esta configuración se sincroniza automáticamente desde Google Sheets via Config Hub.
            <br>Para editar, modifica el <a href="https://docs.google.com/spreadsheets" target="_blank">Google Sheet</a> de Ana Studio.
        </p>
    </div>
    <?php
}
