# JUPTEE Store

JUPTEE is a static storefront built with HTML, CSS, and vanilla JavaScript. It has no build step, backend, database, or admin dashboard.

## Pages

- `index.html` — homepage and featured products
- `products.html` — searchable, filterable catalog
- `product-details.html?id=JUP-001` — product details and WhatsApp ordering
- `about.html` — company, services, and founder story

## Adding products

1. Upload product photos under the matching folder:
   - `assets/images/tshirts/<product-id>/`
   - `assets/images/hoodies/<product-id>/`
   - `assets/images/drop/<product-id>/`
2. Add a product object to the `products` array in `data/products.json`.
3. Use paths relative to the site root, such as `./assets/images/tshirts/JUP-013/front.jpg`.
4. Include a unique `id`, `name`, `category`, `price`, `discount_price`, `description`, `sizes`, `colors`, `images` array, and `status`. Use `status: "published"` to show the product, or `status: "unpublished"` to keep it hidden. Set `featured` to `true` to show the product on the homepage.
5. Commit and push. The product will appear when the static site deploys.

Category values must be `T-shirts`, `Hoodies`, or `Drop Shoulder`. Each product can list any number of gallery images.

## Hosting

Deploy the repository root as the Cloudflare Pages build output. No build command, environment variables, functions, or database bindings are required.
