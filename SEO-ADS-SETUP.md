# JUPTEE search, ads, and catalog setup

## Current preview status

The storefront currently contains sample products, prices, and stock counts. Cloudflare order handling is implemented but must be deployed and configured with verified inventory and provider credentials before accepting real orders. The HTML intentionally sets `noindex,follow` so search engines do not list this setup preview as a purchasable store.

Follow [ORDER-SYSTEM-SETUP.md](./ORDER-SYSTEM-SETUP.md) to create the Cloudflare D1 database, deploy Pages Functions, configure Cloudflare Access, add notification secrets, and load verified product variants.

Before launch:

1. Replace the sample product data with confirmed products, prices, variant availability, and public HTTPS product images.
2. Complete and test the Cloudflare order-service deployment in `ORDER-SYSTEM-SETUP.md`, load verified inventory, and publish final business, delivery, returns, privacy, and terms information.
3. Confirm that `https://jupbd.shop/` is the canonical production domain. Update the canonical URL, Open Graph URL, JSON-LD URLs, `robots.txt`, and `sitemap.xml` together if the domain differs.
4. Remove or change the `noindex,follow` meta tag in `index.html` to `index,follow` only after the production site is ready. Add a real 1200×630 social-sharing image and set `og:image` when product/brand photography is available.
5. Deploy the site over HTTPS. Confirm `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`, `/assets/favicon.ico`, and `/assets/juptee-favicon.png` return successfully.

## Google Search Console

1. Add the production domain as a **Domain property** in Google Search Console.
2. Verify ownership by adding the exact DNS TXT record Google provides to the domain's DNS settings. The verification value is account-specific and is intentionally not fabricated in this project.
3. After launch and removal of `noindex`, submit `https://jupbd.shop/sitemap.xml` in Search Console.
4. The storefront uses hash-based routes (for example `#p-size`). Hash fragments are not separate crawlable sitemap pages. For dedicated search listings for products, categories, and policies, migrate them to real server-served paths with unique canonical URLs and rendered page content.

## Google Ads and publisher ads

- Google Ads does not require an `ads.txt` file. Do not publish a made-up publisher ID or conversion label.
- To measure Ads conversions, configure the Google tag using the Google tag ID and conversion action/label from the actual Ads account. The tag and label are account-specific; this project does not fabricate them. Only mark an order as a purchase after a real server-confirmed order. The order service is not live until configured and deployed.
- If using AdSense or Google Ad Manager to sell advertising on this domain, create `/ads.txt` only with the exact publisher/seller line supplied by that account. The publisher ID is not available in this project.
- Add appropriate consent and privacy disclosures before enabling advertising or analytics tags where required.

## Meta Pixel and product catalog

- Configure the Pixel using the real Pixel ID from Meta Business settings. Never put an access token or Conversions API secret in browser JavaScript.
- The current browser-side Meta events do not prove that a purchase happened. Connect the Conversions API through a secure server and send purchase events only after an order is confirmed by that server.
- `meta-catalog-template.csv` contains the standard product fields for preparing a catalog feed. It deliberately contains no product rows because the present catalogue, stock, and images are sample/unconfirmed.
- Fill the template with verified variant IDs, prices, availability, public HTTPS product and image URLs, and accurate product attributes. Validate it in Commerce Manager, then host the completed feed at a stable HTTPS URL for scheduled fetching. A locally generated preview or a URL that is not actually hosted cannot be used as a catalog feed.
- The existing `#meta` screen is a local preview only; its browser settings are not persisted and it does not publish a feed endpoint.

## Files in this setup

- `robots.txt` allows crawling and advertises the sitemap.
- `sitemap.xml` lists the production homepage only. Add pages only after they have real, stable, server-served URLs.
- `index.html` contains canonical, social sharing, theme, organization structured data, and preview noindex metadata.
- `assets/favicon.ico`, `assets/juptee-favicon.png`, and `site.webmanifest` use the supplied JUPTEE logo for browser and install icons.
