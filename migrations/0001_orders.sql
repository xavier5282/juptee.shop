PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notification_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO notification_settings (key, value) VALUES
  ('whatsapp_recipient', '+8801061103327'),
  ('notification_email', 'hellojuptee@gmail.com');

CREATE TABLE IF NOT EXISTS catalog_variants (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT NOT NULL DEFAULT '',
  district_area TEXT NOT NULL,
  full_address TEXT NOT NULL,
  order_notes TEXT NOT NULL DEFAULT '',
  delivery_area TEXT NOT NULL,
  delivery_charge INTEGER NOT NULL CHECK (delivery_charge >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'confirmed', 'processing', 'shipped', 'completed', 'cancelled')),
  whatsapp_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (whatsapp_status IN ('pending', 'sent', 'failed')),
  whatsapp_error TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'failed')),
  email_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  product_title TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL CHECK (line_total >= 0),
  UNIQUE (order_id, variant_id)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);

CREATE TRIGGER IF NOT EXISTS order_item_stock_check
BEFORE INSERT ON order_items
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM catalog_variants
      WHERE id = NEW.variant_id AND active = 1 AND stock >= NEW.quantity
    )
    THEN RAISE(ABORT, 'Product variant unavailable or insufficient stock')
  END;
END;

CREATE TRIGGER IF NOT EXISTS order_item_stock_decrement
AFTER INSERT ON order_items
BEGIN
  UPDATE catalog_variants
  SET stock = stock - NEW.quantity,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.variant_id;
END;

CREATE TRIGGER IF NOT EXISTS cancelled_order_stock_check
BEFORE UPDATE OF status ON orders
WHEN OLD.status = 'cancelled' AND NEW.status != 'cancelled'
BEGIN
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM order_items oi
      JOIN catalog_variants cv ON cv.id = oi.variant_id
      WHERE oi.order_id = OLD.id AND (cv.active != 1 OR cv.stock < oi.quantity)
    )
    THEN RAISE(ABORT, 'Cancelled order cannot be reopened: product stock is unavailable')
  END;
END;

CREATE TRIGGER IF NOT EXISTS cancelled_order_stock_decrement
AFTER UPDATE OF status ON orders
WHEN OLD.status = 'cancelled' AND NEW.status != 'cancelled'
BEGIN
  UPDATE catalog_variants
  SET stock = stock - (
        SELECT oi.quantity FROM order_items oi
        WHERE oi.order_id = OLD.id AND oi.variant_id = catalog_variants.id
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (SELECT variant_id FROM order_items WHERE order_id = OLD.id);
END;

CREATE TRIGGER IF NOT EXISTS cancelled_order_stock_restock
AFTER UPDATE OF status ON orders
WHEN OLD.status != 'cancelled' AND NEW.status = 'cancelled'
BEGIN
  UPDATE catalog_variants
  SET stock = stock + (
        SELECT oi.quantity FROM order_items oi
        WHERE oi.order_id = OLD.id AND oi.variant_id = catalog_variants.id
      ),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (SELECT variant_id FROM order_items WHERE order_id = OLD.id);
END;
