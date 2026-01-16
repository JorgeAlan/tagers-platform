# Tagers KISS Bridge (WordPress)

Instala este plugin para enviar beacons desde WooCommerce / OpenPOS hacia tu KISS Production API.

## Configuración
1) Copia `tagers-kiss-bridge.php` a `wp-content/plugins/tagers-kiss-bridge/`
2) Activa el plugin
3) Ve a **Settings → Tagers KISS Bridge**
4) Configura:
   - KISS API URL (ej. `https://api.tagers.com`)
   - Shared Secret (igual a `TAGERS_SHARED_SECRET` del KISS API)

## Endpoint para POS
- `POST /wp-json/tagers-kiss/v1/beacon`
  - Requiere usuario logueado con `manage_woocommerce` o header `x-tagers-token`

Este endpoint es útil para scripts del POS (Tampermonkey) porque evita exponer credenciales del KISS API en el cliente.
