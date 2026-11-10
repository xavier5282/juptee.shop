# JUPTEE order system deployment

The Cloudflare Pages Functions and D1 integration is implemented, but this workspace has not been connected to a Cloudflare account. Orders can only be accepted after the steps below are complete. Until then, the storefront intentionally remains a no-index setup preview with sample products.

## 1. Prepare Cloudflare Pages and D1

1. Install Node.js and authenticate Wrangler with the Cloudflare account that owns `juptee.shop`.
2. From the project root, create the D1 database and a Pages project:

   ```powershell
   npx wrangler d1 create juptee-orders
   npx wrangler pages project create juptee-store
   ```

3. Copy the database ID from the D1 command output into `database_id` in `wrangler.toml`. Keep the binding name as `DB`; the Functions use that name.
4. Create a Cloudinary account and note the cloud name, API key, and API secret from the product environment's API settings. New admin uploads use Cloudinary; do not create an R2 bucket for new images.
5. Apply the schema to the remote database:

   ```powershell
   npx wrangler d1 migrations apply juptee-orders --remote
   ```

6. In the Pages project settings, attach the D1 database with binding `DB`. Keep the existing private `PRODUCT_IMAGES` R2 binding only while product rows still contain legacy R2 image keys; it preserves those old `/media/` URLs. The binding is not used for new uploads. For a fresh install with no legacy R2 keys, remove the existing `[[r2_buckets]]` block from `wrangler.toml` before deploying. For an existing catalog, keep that block and attach its existing bucket; do not remove the bucket or binding until all legacy image references have been migrated and verified.
7. Deploy the site from the project root:

   ```powershell
   npx wrangler pages deploy . --project-name juptee-store
   ```

8. Add `juptee.shop` as a custom domain and enable HTTPS. Keep production and preview environments separate; do not point preview deployments at the production order database.
9. Add Cloudflare rate-limiting rules for `POST /api/orders` and `POST /api/chatbot` to reduce automated order abuse and unexpected AI spend. Set conservative limits appropriate to expected traffic and monitor them during launch.

The migration creates the schema and initializes the business notification contacts to `+8801061103327` and `hellojuptee@gmail.com`. It deliberately does not create products or inventory.

The existing `products.images_json` column already stores an image array, so Cloudinary URLs/public IDs and local repository paths need no D1 schema migration. The existing R2 image route remains read-only compatibility for any previously uploaded R2 images.

To check whether legacy R2 image keys remain, run this query against the production D1 database before removing its binding:

```sql
SELECT id, images_json
FROM products
WHERE images_json LIKE '%"products/%';
```

For each result, replace or migrate those images from the protected dashboard and verify the resulting storefront images before removing any R2 resources. If all rows are clear and no legacy photos are required, remove the `PRODUCT_IMAGES` binding from `wrangler.toml` and Pages settings and remove `/media/*` from `_routes.json` along with `functions/media/[[key]].js`. The current `wrangler.toml` retains the binding until this audit because it still serves existing R2-backed references.

## 2. Protect the admin dashboard

Create Cloudflare Access self-hosted applications for the Pages hostname, restricting access to the paths `/admin*` and `/api/admin/*`. If Cloudflare requires separate applications for those paths, create both and allow only the authorized JUPTEE administrators.

Set these Pages environment variables in production:

| Variable | Value |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | Your Access team domain only, such as `your-team.cloudflareaccess.com` (no `https://`) |
| `CF_ACCESS_AUD` | The Access application audience tag; if two applications are used, enter both tags separated by a comma |
| `PUBLIC_SITE_URL` | `https://juptee.shop` (update if the production domain changes) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary product environment cloud name |

Add these Cloudinary values as Pages secrets (never add them to frontend code or Git):

- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

They can be set from **Workers & Pages → juptee-store → Settings → Variables and Secrets**, or with Wrangler:

```powershell
npx wrangler pages secret put CLOUDINARY_API_KEY --project-name juptee-store
npx wrangler pages secret put CLOUDINARY_API_SECRET --project-name juptee-store
```

Set `CLOUDINARY_CLOUD_NAME` as a Pages environment variable. The [Free plan](https://cloudinary.com/pricing) currently includes 25 monthly credits shared across managed storage, image bandwidth, and transformations; Cloudinary equates one credit to 1 GB of storage, 1 GB of image bandwidth, or 1,000 transformations. Monitor usage in the Cloudinary console; higher usage or upgraded features may require a paid plan. Signed requests follow [Cloudinary's signature guidance](https://cloudinary.com/documentation/authentication_signatures).

## 3. Configure the AI shopping assistant

The floating assistant uses the published D1 catalog and calls OpenAI only from a Pages Function. Create an OpenAI API key with API billing enabled, then add it to Pages secrets:

```powershell
npx wrangler pages secret put OPENAI_API_KEY --project-name juptee-store
```

Optionally set `OPENAI_MODEL` as a Pages environment variable (default: `gpt-4o-mini`). OpenAI API usage is billed separately from ChatGPT subscriptions; per-message cost depends on model and token use. Add a spend limit/alert in the OpenAI platform and a Cloudflare rate limit for `POST /api/chatbot`. Do not put the key in frontend code or Git.

The assistant's order form submits to the existing `/api/orders` endpoint. The AI provider does not receive order form fields; email addresses and phone numbers in chat text are redacted before an AI request, but customers should still avoid typing private details into free-form chat. The assistant confirms an order only after the existing order API returns a saved order ID.

The protected dashboard's **Store & assistant settings** panel configures Dhaka and outside-city delivery charges, the legacy sub-city fee, garment size chart, current promotion information, FAQs and human support phone. These values use the existing D1 `notification_settings` table, so no additional migration is needed. Promotion text is informational only: the existing order service has no coupon/discount calculation and saves a zero discount. The existing payment method is cash on delivery only; payment methods cannot be enabled from the chatbot settings. Product names, prices, variants and stock continue to come from the published D1 catalog.

### Bangladesh checkout locations

The checkout and chatbot order form use the bilingual Bangladesh Locations Dataset in `assets/data/bangladesh-locations.json`, derived from [HedaetShahriar/bangladesh-locations-dataset](https://github.com/HedaetShahriar/bangladesh-locations-dataset) v1.5.0 at revision `0d3116a7f59be5b2450742432805df2ab505043e`. This snapshot contains all 8 divisions, 64 districts, 502 upazilas, and 74 thanas. The location selector loads this static same-origin asset, so it also works on static previews without Cloudflare Functions; server-side order validation uses the same dataset through `/api/locations` and the order API. It does not rely on a third-party runtime service. The dataset is MIT-licensed; see `assets/data/LICENSE-bangladesh-locations.txt`. Its maintainers note that the public-source dataset is not an official government publication and may contain name or spelling errors; verify customer-facing labels before launch.

Apply the pending schema migration to each existing D1 database before deploying this version:

```powershell
npx wrangler d1 migrations apply juptee-orders --remote
```

Migration `0003_order_locations.sql` adds division, district, upazila/thana, and delivery-instruction fields while preserving prior orders. New checkout submissions send location IDs; the order API verifies that the district belongs to the selected division and the upazila/thana belongs to that district, then saves canonical location names. The server applies the configured Dhaka fee to orders in Dhaka district and the configured outside fee to every other district. The former sub-city fee setting remains in the admin form for compatibility but is not used by checkout. Admin orders, business notifications, and the customer confirmation display the saved location and address.

The middleware verifies the Access JWT signature, issuer, audience, and expiry before serving `/admin` or the admin APIs. Test that an unauthenticated request to both `/admin/` and `/api/admin/orders` is rejected before sharing the dashboard URL.

## 4. Configure notifications

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

## 5. Add products from the protected dashboard

The migration intentionally leaves the product catalogue and inventory empty. Once D1, Cloudinary settings, and Cloudflare Access are configured, an authorized administrator can open `/admin/`, select **Products & photos**, and add each verified item:

1. Enter a permanent product ID, title, category, description, regular price, and optional lower sale price. Product IDs must be unique and should not be changed after orders have been placed.
2. Enter comma-separated colors and sizes and build the variation table. Record the real stock for every color/size combination; a disabled variation is unavailable for purchase.
3. Use a repository image path such as `/assets/products/product-name.webp`, or upload images by selecting files, dragging them into a gallery slot, or selecting up to four files at once. JPG, PNG, and WebP files up to 6 MB each (20 MB total per request) are accepted. The server verifies image signatures and MIME types before uploading to Cloudinary. Preview, replace, remove, and reorder images before saving; the first gallery image is primary. Drafts can be saved before all four photos are ready; all four are required to publish.
4. Save as a draft while details are being checked. Enable **Publish on storefront** only when the product information, photos, price, and inventory are accurate.

Published products and active variations are loaded from D1 on the customer storefront. Local paths are served from the repository, new uploads are stored as Cloudinary URL/public-ID metadata in `images_json` and delivered through Cloudinary's optimized `f_auto,q_auto` URLs, and any old R2 keys continue to use the site's private `/media/` handler. Removing/replacing a saved Cloudinary image deletes it from Cloudinary after the product update; legacy R2 images are not deleted by this migration. D1 is authoritative for order prices and stock; customer-submitted prices are never trusted. Updating the regular or sale price in the dashboard updates the corresponding checkout prices. Deactivated variants remain in D1 for order history and cancellation handling.

After confirming no product `images_json` values still contain legacy R2 keys and verifying every old photo on the storefront, follow the R2 cleanup steps in section 1. Do not do this before migrating the legacy images; new Cloudinary uploads do not need R2.

Do not treat the built-in setup-preview products, prices, or stock as real inventory. If the public catalog API is unavailable, the browser keeps the clearly marked setup preview. If the API succeeds but no products are published, the customer catalog remains empty. Checkout will not accept products absent from D1.

## 6. Verify in a staging environment

Before using production customer data:

1. Use a staging Pages environment and a separate test D1 database.
2. Confirm checkout rejects an unavailable variant and retains the customer's bag.
3. Place a test order for an in-stock variant; confirm the order and item rows exist, stock decreases once, and the dashboard shows the correct delivery charge and total.
4. Retry the same submission after a simulated connection interruption; confirm it returns the same order ID and does not decrement stock twice. Reusing the idempotency key with changed details must be rejected.
5. Test WhatsApp and email independently. Confirm each status updates to `sent` or `failed`, and a provider failure does not remove the order.
6. Cancel a test order and confirm stock is restored once. If that stock is sold before the cancelled order is reopened, confirm the dashboard reports that the order cannot be reopened.
7. Confirm unauthenticated dashboard and admin API requests are blocked, and an authorized administrator can update an order status and notification contacts.
8. From the protected dashboard, save a draft, test a repository path, upload multiple files (including drag/drop), replace and remove Cloudinary photos, reorder the primary photo, and publish a verified product. Confirm optimized images and exact color/size stock appear on the storefront, and that broken image URLs fall back safely. Confirm a disabled or sold-out variation cannot be added to the bag.
9. Configure chat delivery fees, size chart, FAQs, promotions, and support number in the admin panel. Confirm storefront checkout, chatbot delivery estimates, and the order API all use the same configured fee.
10. Set the OpenAI secret in staging, then test English, Bangla, and Banglish questions about published products, unavailable items, current prices, offers, sizes, and FAQs. Confirm missing AI configuration produces an explicit unavailable message while catalog actions and order flow still work.
11. Test the order assistant: submit valid details, edit/cancel the summary, confirm a successful order and order ID, then simulate an API/network failure and retry. Confirm no success message is shown before the backend saves the order, duplicate retries do not decrement stock twice, and personal order fields are not sent to the AI provider.
12. Test the location selector: check all 8 divisions, all 64 districts, and the upazila/thana list for each district; search in English and Bangla; verify changing a division clears district and thana, and changing a district clears thana. Confirm an incomplete location is blocked in the browser and invalid or mismatched location IDs are rejected by the order API.
13. Submit a test order from Dhaka district and one from another district; verify the server-applied fees (default ৳80 and ৳130), saved division/district/thana, both address lines, phone, and delivery instructions in D1, admin, notifications, and customer confirmation. Confirm older orders still display their stored legacy address.
14. Check the widget and checkout at narrow mobile viewport sizes, including open/close, keyboard scrolling, search, typing feedback, and order review. Verify checkout, bag, order history and the admin orders panel still work.
15. Verify the customer-facing phone, delivery, returns, privacy, and terms information before accepting real orders.

The order endpoint uses cash on delivery and currently has no coupon or discount system, so the saved discount is zero. Do not remove the storefront `noindex` setting or publish sample catalogue claims until launch information and inventory are verified.
