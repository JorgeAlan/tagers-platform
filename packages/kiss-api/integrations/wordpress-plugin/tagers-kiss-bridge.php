<?php
/**
 * Plugin Name: Tagers KISS Bridge (Beacon Sender)
 * Description: Envía beacons (WooCommerce/OpenPOS/otros) a KISS Production API de forma segura (HMAC) y con tokens por canal.
 * Version: 0.2.0
 * Author: Tagers Ops
 */

if ( ! defined('ABSPATH') ) exit;

define('TAGERS_KISS_OPTION_URL', 'tagers_kiss_api_url');
define('TAGERS_KISS_OPTION_SECRET', 'tagers_kiss_shared_secret');

// Tokens separados por canal (opcional pero recomendado)
define('TAGERS_KISS_OPTION_TOKEN_POS',    'tagers_kiss_pos_token');
define('TAGERS_KISS_OPTION_TOKEN_RADAR',  'tagers_kiss_radar_token');
define('TAGERS_KISS_OPTION_TOKEN_KITCHEN','tagers_kiss_kitchen_token');
define('TAGERS_KISS_OPTION_TOKEN_QA',     'tagers_kiss_qa_token');

function tagers_kiss_get_api_url() {
    $url = get_option(TAGERS_KISS_OPTION_URL, '');
    return rtrim((string)$url, '/');
}

function tagers_kiss_get_secret() {
    return (string) get_option(TAGERS_KISS_OPTION_SECRET, '');
}

function tagers_kiss_get_channel_token($channel) {
    $c = strtolower(trim((string)$channel));
    if ($c === '') $c = 'pos';

    switch ($c) {
        case 'radar':
            return (string) get_option(TAGERS_KISS_OPTION_TOKEN_RADAR, '');
        case 'kitchen':
            return (string) get_option(TAGERS_KISS_OPTION_TOKEN_KITCHEN, '');
        case 'qa':
            return (string) get_option(TAGERS_KISS_OPTION_TOKEN_QA, '');
        case 'pos':
        default:
            return (string) get_option(TAGERS_KISS_OPTION_TOKEN_POS, '');
    }
}

function tagers_kiss_send_beacon(array $beacon) {
    $base = tagers_kiss_get_api_url();
    if (empty($base)) return new WP_Error('tagers_kiss_no_url', 'KISS API URL not configured');

    $secret = tagers_kiss_get_secret();
    $ts = time();
    $raw = wp_json_encode($beacon);

    $headers = array(
        'Content-Type' => 'application/json; charset=utf-8',
    );

    // Optional HMAC auth (recommended)
    if (!empty($secret)) {
        $sig = hash_hmac('sha256', $ts . '.' . $raw, $secret);
        $headers['X-Tagers-Timestamp'] = (string)$ts;
        $headers['X-Tagers-Signature'] = $sig;
    }

    return wp_remote_post($base . '/kiss/ingest', array(
        'headers' => $headers,
        'body'    => $raw,
        'timeout' => 3,
    ));
}

/**
 * 1) WooCommerce hook example
 */
add_action('woocommerce_order_status_cancelled', function($order_id){
    $order = wc_get_order($order_id);
    if (!$order) return;

    $beacon = array(
        'beacon_id' => wp_generate_uuid4(),
        'timestamp_iso' => gmdate('c'),
        'signal_source' => 'WC_ORDER_CANCELLED',
        'location_id' => get_option('tagers_store_location_id', 'unknown'),
        'actor' => array(
            'role' => 'SYSTEM',
            'name' => 'WooCommerce'
        ),
        'machine_payload' => array(
            'order_id' => (string)$order_id,
            'status' => 'cancelled',
            'total' => (float)$order->get_total()
        )
    );

    tagers_kiss_send_beacon($beacon);
}, 10, 1);

/**
 * 2) REST endpoint for OpenPOS/Tampermonkey → WordPress → KISS
 * POST /wp-json/tagers-kiss/v1/beacon
 *
 * Auth options:
 * - Logged-in WP user with manage_woocommerce
 * - Token header: X-Tagers-Token + X-Tagers-Channel (pos|radar|kitchen|qa)
 */
add_action('rest_api_init', function(){
    register_rest_route('tagers-kiss/v1', '/beacon', array(
        'methods' => 'POST',
        'permission_callback' => function($request){
            // Option A: logged-in staff
            if (is_user_logged_in() && current_user_can('manage_woocommerce')) return true;

            // Option B: token by channel
            $token = (string) $request->get_header('x-tagers-token');
            $channel = (string) $request->get_header('x-tagers-channel');
            $expected = tagers_kiss_get_channel_token($channel);

            if (!empty($expected) && !empty($token) && hash_equals($expected, $token)) return true;

            return false;
        },
        'callback' => function($request){
            $beacon = $request->get_json_params();
            if (!is_array($beacon)) return new WP_REST_Response(array('ok'=>false,'error'=>'invalid_json'), 400);

            $resp = tagers_kiss_send_beacon($beacon);

            if (is_wp_error($resp)) {
                return new WP_REST_Response(array('ok'=>false,'error'=>$resp->get_error_message()), 500);
            }
            return new WP_REST_Response(array('ok'=>true,'forwarded'=>true), 200);
        }
    ));
});

/**
 * 3) Settings page (simple)
 */
add_action('admin_menu', function(){
    add_options_page('Tagers KISS Bridge', 'Tagers KISS Bridge', 'manage_options', 'tagers-kiss-bridge', 'tagers_kiss_render_settings');
});

function tagers_kiss_render_settings(){
    if (!current_user_can('manage_options')) return;

    if (isset($_POST['tagers_kiss_save'])) {
        check_admin_referer('tagers_kiss_save');

        update_option(TAGERS_KISS_OPTION_URL, sanitize_text_field($_POST['tagers_kiss_api_url']));
        update_option(TAGERS_KISS_OPTION_SECRET, sanitize_text_field($_POST['tagers_kiss_shared_secret']));

        update_option(TAGERS_KISS_OPTION_TOKEN_POS, sanitize_text_field($_POST['tagers_kiss_pos_token']));
        update_option(TAGERS_KISS_OPTION_TOKEN_RADAR, sanitize_text_field($_POST['tagers_kiss_radar_token']));
        update_option(TAGERS_KISS_OPTION_TOKEN_KITCHEN, sanitize_text_field($_POST['tagers_kiss_kitchen_token']));
        update_option(TAGERS_KISS_OPTION_TOKEN_QA, sanitize_text_field($_POST['tagers_kiss_qa_token']));

        echo '<div class="updated"><p>Saved.</p></div>';
    }

    $url = esc_attr(get_option(TAGERS_KISS_OPTION_URL, ''));
    $secret = esc_attr(get_option(TAGERS_KISS_OPTION_SECRET, ''));

    $pos_token = esc_attr(get_option(TAGERS_KISS_OPTION_TOKEN_POS, ''));
    $radar_token = esc_attr(get_option(TAGERS_KISS_OPTION_TOKEN_RADAR, ''));
    $kitchen_token = esc_attr(get_option(TAGERS_KISS_OPTION_TOKEN_KITCHEN, ''));
    $qa_token = esc_attr(get_option(TAGERS_KISS_OPTION_TOKEN_QA, ''));

    ?>
    <div class="wrap">
        <h1>Tagers KISS Bridge</h1>
        <form method="post">
            <?php wp_nonce_field('tagers_kiss_save'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label>KISS API URL</label></th>
                    <td><input type="text" name="tagers_kiss_api_url" value="<?php echo $url; ?>" class="regular-text" placeholder="https://api.tagers.com" /></td>
                </tr>
                <tr>
                    <th scope="row"><label>Shared Secret (HMAC)</label></th>
                    <td><input type="text" name="tagers_kiss_shared_secret" value="<?php echo $secret; ?>" class="regular-text" /></td>
                </tr>

                <tr><th colspan="2"><h2>Tokens por canal (opcional, recomendado)</h2></th></tr>

                <tr>
                    <th scope="row"><label>POS token</label></th>
                    <td><input type="text" name="tagers_kiss_pos_token" value="<?php echo $pos_token; ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th scope="row"><label>RADAR token (Bruno)</label></th>
                    <td><input type="text" name="tagers_kiss_radar_token" value="<?php echo $radar_token; ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th scope="row"><label>KITCHEN token (Producción)</label></th>
                    <td><input type="text" name="tagers_kiss_kitchen_token" value="<?php echo $kitchen_token; ?>" class="regular-text" /></td>
                </tr>
                <tr>
                    <th scope="row"><label>QA token</label></th>
                    <td><input type="text" name="tagers_kiss_qa_token" value="<?php echo $qa_token; ?>" class="regular-text" /></td>
                </tr>
            </table>
            <p class="submit">
                <button type="submit" name="tagers_kiss_save" class="button button-primary">Save</button>
            </p>
        </form>

        <p>
            Headers esperados si usas tokens:<br/>
            <code>X-Tagers-Token</code> + <code>X-Tagers-Channel</code> donde channel ∈ <code>pos|radar|kitchen|qa</code>
        </p>
    </div>
    <?php
}
