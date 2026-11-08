# JUPTEE Store

This repository contains the JUPTEE storefront and its Cloudflare Pages Functions.

GitHub Pages can host a static preview, but it does not run the Cloudflare Functions or connect to D1. Product images and browsing work there; checkout, live catalog, chat, uploads, and admin features require the backend and must not be presented as live.

For the functional store, connect this repository to Cloudflare Pages and complete the database, secrets, and deployment steps in [ORDER-SYSTEM-SETUP.md](./ORDER-SYSTEM-SETUP.md). Do not publish real orders until the verified product catalog and order API are configured.
