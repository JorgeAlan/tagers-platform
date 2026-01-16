<?php
/**
 * Ejemplos de hooks WooCommerce para generar beacons.
 * Requiere el plugin Tagers KISS Bridge (función tagers_kiss_send_beacon()).
 */

// Order created
add_action('woocommerce_checkout_order_processed', function($order_id, $posted_data, $order){
    if (!function_exists('tagers_kiss_send_beacon')) return;
    if (!$order) $order = wc_get_order($order_id);
    if (!$order) return;

    $beacon = array(
        'beacon_id' => wp_generate_uuid4(),
        'timestamp_iso' => gmdate('c'),
        'signal_source' => 'WC_ORDER_CREATED',
        'location_id' => get_option('tagers_store_location_id', 'unknown'),
        'actor' => array('role'=>'SYSTEM','name'=>'WooCommerce'),
        'machine_payload' => array(
            'order_id' => (string)$order_id,
            'total' => (float)$order->get_total(),
            'payment_method' => (string)$order->get_payment_method()
        )
    );
    tagers_kiss_send_beacon($beacon);
}, 10, 3);

// Stock reduced (when order is processed)
add_action('woocommerce_reduce_order_stock', function($order){
    if (!function_exists('tagers_kiss_send_beacon')) return;
    if (!$order || !is_a($order, 'WC_Order')) return;

    $items = array();
    foreach ($order->get_items() as $item) {
        $product = $item->get_product();
        if (!$product) continue;
        $items[] = array(
            'product_id' => $product->get_id(),
            'sku' => $product->get_sku(),
            'qty' => (int)$item->get_quantity(),
        );
    }

    $beacon = array(
        'beacon_id' => wp_generate_uuid4(),
        'timestamp_iso' => gmdate('c'),
        'signal_source' => 'WC_STOCK_REDUCED',
        'location_id' => get_option('tagers_store_location_id', 'unknown'),
        'actor' => array('role'=>'SYSTEM','name'=>'WooCommerce'),
        'machine_payload' => array(
            'order_id' => (string)$order->get_id(),
            'items' => $items
        )
    );

    tagers_kiss_send_beacon($beacon);
}, 10, 1);
