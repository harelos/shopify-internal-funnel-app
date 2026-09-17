# NovaHair Orders Shopify App Configuration

Configuration-only Shopify app used to obtain the Admin API scopes required by
the NovaHair CJ order pipeline. It hosts no storefront UI or extension.

The OAuth callback is hosted separately. Access tokens and client secrets must
remain in the deployment platform secret store and must never be committed.

The checked-in `shopify.app.toml` documents the requested scopes and callback
URLs so another developer can recreate or verify the app configuration.
