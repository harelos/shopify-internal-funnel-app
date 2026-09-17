# Shopify OAuth Helper

Temporary Railway service used to complete the legacy Shopify OAuth callback and
obtain an app-owned Admin API token for the NovaHair order/function setup.

Required Railway environment variables:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SHOPIFY_SCOPES`
- `APP_URL`

The service displays the token after a successful callback. Treat its logs and
output as sensitive, rotate the token after exposure, and disable the service
when installation is complete. No token or secret belongs in this repository.
