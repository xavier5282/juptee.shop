# JUPTEE order system deployment

The Cloudflare Pages Functions and D1 integration is implemented, but this workspace has not been connected to a Cloudflare account. Orders can only be accepted after the steps below are complete. Until then, the storefront intentionally remains a no-index setup preview with sample products.

## 1. Prepare Cloudflare Pages and D1

1. Install Node.js and authenticate Wrangler with the Cloudflare account that owns `jupbd.shop`.
2. From the project root, create the D1 database and a Pages project:

   ```powershell
   npx wrangler d1 create juptee-orders
   npx wrangler pages project create juptee-store
   ```

3. Copy the database ID from the D1 command output into `database_id` in `wrangler.toml`. Keep the binding name as `DB`; the Functions use that name.
4. Create the private product-photo bucket:

   ```powershell
   npx wrangler r2 bucket create juptee-product-images
   ```

   Keep the bucket private. The Pages Function serves uploaded images from the `/media/` route; do not enable public bucket access.
5. Apply the schema to the remote database:

   ```powershell
   npx wrangler d1 migrations apply juptee-orders --remote
   ```

6. In the Pages project settings, attach the D1 database with binding `DB` and the R2 bucket with binding `PRODUCT_IMAGES`, or confirm that both bindings in `wrangler.toml` are applied to the production environment.
7. Deploy the site from the project root:

   ```powershell
   npx wrangler pages deploy . --project-name juptee-store
   ```

8. Add `jupbd.shop` as a custom domain and enable HTTPS. Keep production and preview environments separate; do not point preview deployments at the production order database.
9. Add a Cloudflare rate-limiting rule for `POST /api/orders` to reduce automated order and inventory abuse. Set the limit to suit expected customer traffic and monitor it during launch.

The migration creates the schema and initializes the business notification contacts to `+8801061103327` and `hellojuptee@gmail.com`. It deliberately does not create products or inventory.

## 2. Protect the admin dashboard

Create Cloudflare Access self-hosted applications for the Pages hostname, restricting access to the paths `/admin*` and `/api/admin/*`. If Cloudflare requires separate applications for those paths, create both and allow only the authorized JUPTEE administrators.

Set these Pages environment variables in production:

| Variable | Value |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Your Access team domain only, such as `your-team.cloudflareaccess.com` (no `https://`) |
| `CF_ACCESS_AUD` | The Access application audience tag; if two applications are used, enter both tags separated by a comma |
| `PUBLIC_SITE_URL` | `https://jupbd.shop` (update if the production domain changes) |

The middleware verifies the Access JWT signature, issuer, audience, and expiry before serving `/admin` or the admin APIs. Test that an unauthenticated request to both `/admin/` and `/api/admin/orders` is rejected before sharing the dashboard URL.

## 3. Configure notifications

Set non-secret Pages environment variables:

| Variable | Value |
| --- | --- |
| `META_GRAPH_API_VERSION` | A currently supported Meta Graph API version, in `vNN.N` format |
| `WHATSAPP_PHONE_NUMBER_ID` | The sending phone-number ID from Meta WhatsApp Cloud API |
| `WHATSAPP_TEMPLATE_NAME` | The exact name of the approved WhatsApp message template |
| `WHATSAPP_TEMPLATE_LANGUAGE` | The approved template language code, for example `en` |
| `ORDER_EMAIL_FROM` | A sender address on a domain verified with Resend |

Add these as **Pages secrets**, not normal variables or browser settings:

- `WHATSAPP_ACCESS_TOKEN` — a valid WhatsApp Cloud API access token with permission to send messages from the configured phone number.
- `RESEND_API_KEY` — the API key for the verified Resend account.

In Meta, submit and get approval for a utility template whose body includes one text variable, for example `New JUPTEE order notification: {{1}}`. The variable carries the complete order details; long details are sent as sequential, numbered parts using the same approved template. The configured business recipient must be able to receive Cloud API messages; verify the exact `+8801061103327` number with the business before going live. Provider failures are recorded in the admin dashboard without deleting the order.

New orders use the recipient values in D1. An administrator can change the WhatsApp recipient and notification email in the protected dashboard; changes apply to future orders. The two notification channels are attempted independently. A missing setting or provider failure is recorded as `failed` and does not undo the saved order.

## 4. Add products from the protected dashboard

The migration intentionally leaves the product catalogue and inventory empty. Once the D1 and `PRODUCT_IMAGES` bindings are deployed, an authorized administrator can open `/admin/`, select **Products & photos**, and add each verified item:

1. Enter a permanent product ID, title, category, description, regular price, and optional lower sale price. Product IDs must be unique and should not be changed after orders have been placed.
2. Enter comma-separated colors and sizes and build the variation table. Record the real stock for every color/size combination; a disabled variation is unavailable for purchase.
3. Upload the actual front, back, side, and detail photographs. JPEG, PNG, and WebP files up to 6 MB each are accepted. Drafts can be saved before all four photos are ready; all four are required to publish.
4. Save as a draft while details are being checked. Enable **Publish on storefront** only when the product information, photos, price, and inventory are accurate.

Published products and active variations are loaded from D1 on the customer storefront. Images remain in the private R2 bucket and are delivered through the site's `/media/` handler. D1 is authoritative for order prices and stock; customer-submitted prices are never trusted. Updating the regular or sale price in the dashboard updates the corresponding checkout prices. Deactivated variants remain in D1 for order history and cancellation handling.

Do not treat the built-in setup-preview products, prices, or stock as real inventory. If the public catalog API is unavailable, the browser keeps the clearly marked setup preview. If the API succeeds but no products are published, the customer catalog remains empty. Checkout will not accept products absent from D1.

## 5. Verify in a staging environment

Before using production customer data:

1. Use a staging Pages environment and a separate test D1 database.
2. Confirm checkout rejects an unavailable variant and retains the customer's bag.
3. Place a test order for an in-stock variant; confirm the order and item rows exist, stock decreases once, and the dashboard shows the correct delivery charge and total.
4. Retry the same submission after a simulated connection interruption; confirm it returns the same order ID and does not decrement stock twice. Reusing the idempotency key with changed details must be rejected.
5. Test WhatsApp and email independently. Confirm each status updates to `sent` or `failed`, and a provider failure does not remove the order.
6. Cancel a test order and confirm stock is restored once. If that stock is sold before the cancelled order is reopened, confirm the dashboard reports that the order cannot be reopened.
7. Confirm unauthenticated dashboard and admin API requests are blocked, and an authorized administrator can update an order status and notification contacts.
8. From the protected dashboard, save a draft, upload and replace photos, publish a verified product, and confirm its photos and exact color/size stock appear on the storefront. Confirm a disabled or sold-out variation cannot be added to the bag.
9. Verify the customer-facing phone, delivery, returns, privacy, and terms information before accepting real orders.

The order endpoint uses cash on delivery and currently has no coupon or discount system, so the saved discount is zero. Do not remove the storefront `noindex` setting or publish sample catalogue claims until launch information and inventory are verified.
