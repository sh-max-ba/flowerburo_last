import type Database from "better-sqlite3"
import { db } from "./connection"

export function ensureColumn(
  table: string,
  column: string,
  ddl: string,
  client: Database.Database = db()
) {
  const columns = client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((existing) => existing.name === column)) {
    client.exec(ddl)
  }
}

export function migrateBaseline(client: Database.Database) {
  client.exec(`
    CREATE TABLE IF NOT EXISTS products (
      code TEXT PRIMARY KEY,
      category_path TEXT NOT NULL DEFAULT '',
      article TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'шт',
      stock REAL NOT NULL DEFAULT 0,
      reserved REAL NOT NULL DEFAULT 0,
      expected REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      image_path TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER,
      user_id INTEGER,
      payment_method TEXT DEFAULT 'cash',
      customer_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      items_total_before_discount REAL DEFAULT 0,
      items_discount_total REAL DEFAULT 0,
      sale_discount_type TEXT DEFAULT 'none',
      sale_discount_value REAL DEFAULT 0,
      sale_discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_code TEXT NOT NULL REFERENCES products(code),
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      bouquet_id INTEGER,
      bouquet_name TEXT,
      bouquet_group_id TEXT,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      cashier_name TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      user_id INTEGER,
      opened_by_user_id INTEGER,
      closed_by_user_id INTEGER,
      type TEXT DEFAULT 'day'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT,
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      customer TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      recipient_phone TEXT,
      source TEXT,
      delivery_type TEXT,
      address TEXT,
      due_at TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      items_total_before_discount REAL DEFAULT 0,
      items_discount_total REAL DEFAULT 0,
      order_discount_type TEXT DEFAULT 'none',
      order_discount_value REAL DEFAULT 0,
      order_discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      prepaid REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      is_reserved INTEGER DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      type TEXT NOT NULL,
      product_code TEXT,
      product_name TEXT,
      qty REAL,
      unit_price REAL,
      total REAL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cash_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      order_id INTEGER,
      sale_id INTEGER,
      user_id INTEGER,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT,
      type TEXT NOT NULL,
      qty REAL NOT NULL,
      before_stock REAL,
      after_stock REAL,
      before_reserved REAL,
      after_reserved REAL,
      order_id INTEGER,
      sale_id INTEGER,
      shift_id INTEGER,
      document_id INTEGER,
      user_id INTEGER,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      supplier_id INTEGER,
      supplier_name TEXT,
      comment TEXT,
      operation_at TEXT,
      created_by_user_id INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      posted_by_user_id INTEGER,
      posted_by_name TEXT,
      posted_at TEXT,
      cancelled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      phone TEXT,
      contact_name TEXT,
      comment TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_document_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      before_stock REAL,
      after_stock REAL,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bouquet_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_path TEXT,
      price REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_by_user_id INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bouquet_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bouquet_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_code TEXT,
      name TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      bouquet_id INTEGER,
      bouquet_name TEXT,
      bouquet_group_id TEXT,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL NOT NULL,
      is_custom INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS warehouse_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      status TEXT NOT NULL,
      total_rows INTEGER DEFAULT 0,
      created_count INTEGER DEFAULT 0,
      updated_count INTEGER DEFAULT 0,
      unchanged_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      created_by_user_id INTEGER,
      created_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      applied_at TEXT,
      report_json TEXT
    );

    CREATE TABLE IF NOT EXISTS warehouse_import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_id INTEGER NOT NULL,
      row_number INTEGER,
      code TEXT,
      name TEXT,
      category_path TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      old_stock REAL,
      new_stock REAL,
      stock_delta REAL,
      old_reserved REAL,
      new_reserved REAL,
      old_sale_price REAL,
      new_sale_price REAL,
      old_cost_price REAL,
      new_cost_price REAL,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      normalized_phone TEXT,
      instagram TEXT,
      source TEXT,
      wazzup_chat_type TEXT,
      wazzup_chat_id TEXT,
      wazzup_channel_id TEXT,
      default_discount_percent REAL DEFAULT 0,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_pipelines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      color TEXT,
      is_closed INTEGER DEFAULT 0,
      is_won INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE,
      customer_id INTEGER,
      customer_name TEXT,
      customer_phone TEXT,
      recipient_phone TEXT,
      responsible_user_id INTEGER,
      responsible_user_name TEXT,
      pipeline_id INTEGER,
      stage_id INTEGER,
      status TEXT DEFAULT 'open',
      source TEXT DEFAULT 'manual',
      title TEXT,
      due_at TEXT,
      delivery_type TEXT,
      address TEXT,
      comment TEXT,
      items_total REAL DEFAULT 0,
      items_discount_total REAL DEFAULT 0,
      deal_discount_type TEXT DEFAULT 'none',
      deal_discount_value REAL DEFAULT 0,
      deal_discount_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      paid REAL DEFAULT 0,
      order_id INTEGER,
      wazzup_chat_type TEXT,
      wazzup_chat_id TEXT,
      wazzup_channel_id TEXT,
      last_message_text TEXT,
      last_message_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wazzup_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_hash TEXT UNIQUE,
      event_type TEXT,
      status TEXT DEFAULT 'received',
      raw_payload TEXT NOT NULL,
      error TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS wazzup_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE,
      deal_id INTEGER,
      customer_id INTEGER,
      channel_id TEXT,
      chat_type TEXT,
      chat_id TEXT,
      direction TEXT,
      message_type TEXT,
      text TEXT,
      content_uri TEXT,
      status TEXT,
      is_echo INTEGER DEFAULT 0,
      date_time TEXT,
      raw_payload TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wazzup_user_sync (
      user_id INTEGER PRIMARY KEY,
      wazzup_user_id TEXT,
      name TEXT,
      status TEXT,
      last_synced_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS wazzup_pipeline_sync (
      pipeline_id INTEGER PRIMARY KEY,
      wazzup_pipeline_id TEXT,
      status TEXT,
      last_synced_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS wazzup_stage_sync (
      stage_id INTEGER PRIMARY KEY,
      wazzup_stage_id TEXT,
      status TEXT,
      last_synced_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS wazzup_contact_sync (
      customer_id INTEGER PRIMARY KEY,
      wazzup_contact_id TEXT,
      status TEXT,
      last_synced_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS wazzup_deal_sync (
      deal_id INTEGER PRIMARY KEY,
      wazzup_deal_id TEXT,
      status TEXT,
      last_synced_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS integration_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL UNIQUE,
      api_key TEXT,
      crm_key TEXT,
      webhook_url TEXT,
      webhook_auth_required INTEGER DEFAULT 0,
      is_enabled INTEGER DEFAULT 0,
      last_check_status TEXT,
      last_check_message TEXT,
      last_check_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      product_code TEXT NOT NULL,
      product_name TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      bouquet_id INTEGER,
      bouquet_name TEXT,
      bouquet_group_id TEXT,
      discount_type TEXT DEFAULT 'none',
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      total_before_discount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deal_bouquet_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      bouquet_id INTEGER NOT NULL,
      bouquet_name TEXT,
      message_text TEXT,
      image_path TEXT,
      sent_by_user_id INTEGER,
      sent_by_name TEXT,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_customers_normalized_phone ON customers(normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
    CREATE INDEX IF NOT EXISTS idx_deal_stages_pipeline_position ON deal_stages(pipeline_id, position);
    CREATE INDEX IF NOT EXISTS idx_deals_customer_id ON deals(customer_id);
    CREATE INDEX IF NOT EXISTS idx_deals_stage_id ON deals(stage_id);
    CREATE INDEX IF NOT EXISTS idx_deal_items_deal_id ON deal_items(deal_id);
    CREATE INDEX IF NOT EXISTS idx_wazzup_webhook_events_hash ON wazzup_webhook_events(event_hash);
    CREATE INDEX IF NOT EXISTS idx_wazzup_messages_chat ON wazzup_messages(chat_type, chat_id);
    CREATE INDEX IF NOT EXISTS idx_integration_settings_provider ON integration_settings(provider);
    CREATE INDEX IF NOT EXISTS idx_bouquet_template_items_bouquet_id ON bouquet_template_items(bouquet_id);
    CREATE INDEX IF NOT EXISTS idx_bouquet_template_items_product_code ON bouquet_template_items(product_code);
    CREATE INDEX IF NOT EXISTS idx_deal_bouquet_messages_deal_id ON deal_bouquet_messages(deal_id, sent_at);
  `)

  ensureColumn("products", "image_path", "ALTER TABLE products ADD COLUMN image_path TEXT", client)
  ensureColumn("bouquet_templates", "image_path", "ALTER TABLE bouquet_templates ADD COLUMN image_path TEXT", client)
  ensureColumn("orders", "number", "ALTER TABLE orders ADD COLUMN number TEXT", client)
  ensureColumn("orders", "source", "ALTER TABLE orders ADD COLUMN source TEXT", client)
  ensureColumn("orders", "recipient_phone", "ALTER TABLE orders ADD COLUMN recipient_phone TEXT", client)
  ensureColumn("orders", "delivery_type", "ALTER TABLE orders ADD COLUMN delivery_type TEXT", client)
  ensureColumn("orders", "address", "ALTER TABLE orders ADD COLUMN address TEXT", client)
  ensureColumn("orders", "prepaid", "ALTER TABLE orders ADD COLUMN prepaid REAL DEFAULT 0", client)
  ensureColumn("orders", "paid", "ALTER TABLE orders ADD COLUMN paid REAL DEFAULT 0", client)
  ensureColumn("orders", "delivery_price", "ALTER TABLE orders ADD COLUMN delivery_price REAL DEFAULT 0", client)
  ensureColumn("orders", "courier_payout", "ALTER TABLE orders ADD COLUMN courier_payout REAL DEFAULT 0", client)
  ensureColumn(
    "orders",
    "delivery_payout_paid",
    "ALTER TABLE orders ADD COLUMN delivery_payout_paid INTEGER DEFAULT 0",
    client
  )
  ensureColumn("orders", "ready_at", "ALTER TABLE orders ADD COLUMN ready_at TEXT", client)
  ensureColumn(
    "orders",
    "handed_to_courier_at",
    "ALTER TABLE orders ADD COLUMN handed_to_courier_at TEXT",
    client
  )
  ensureColumn("orders", "completed_at", "ALTER TABLE orders ADD COLUMN completed_at TEXT", client)
  ensureColumn("orders", "courier_name", "ALTER TABLE orders ADD COLUMN courier_name TEXT", client)
  ensureColumn("orders", "is_reserved", "ALTER TABLE orders ADD COLUMN is_reserved INTEGER DEFAULT 0", client)
  ensureColumn("orders", "updated_at", "ALTER TABLE orders ADD COLUMN updated_at TEXT", client)
  ensureColumn("orders", "customer_id", "ALTER TABLE orders ADD COLUMN customer_id INTEGER", client)
  ensureColumn("orders", "deal_id", "ALTER TABLE orders ADD COLUMN deal_id INTEGER", client)
  ensureColumn(
    "orders",
    "items_total_before_discount",
    "ALTER TABLE orders ADD COLUMN items_total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "items_discount_total",
    "ALTER TABLE orders ADD COLUMN items_discount_total REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "order_discount_type",
    "ALTER TABLE orders ADD COLUMN order_discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "orders",
    "order_discount_value",
    "ALTER TABLE orders ADD COLUMN order_discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "order_discount_amount",
    "ALTER TABLE orders ADD COLUMN order_discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "orders",
    "total_before_discount",
    "ALTER TABLE orders ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn("shifts", "cashier_name", "ALTER TABLE shifts ADD COLUMN cashier_name TEXT NOT NULL DEFAULT ''", client)
  ensureColumn("shifts", "user_id", "ALTER TABLE shifts ADD COLUMN user_id INTEGER", client)
  ensureColumn("shifts", "opened_by_user_id", "ALTER TABLE shifts ADD COLUMN opened_by_user_id INTEGER", client)
  ensureColumn("shifts", "closed_by_user_id", "ALTER TABLE shifts ADD COLUMN closed_by_user_id INTEGER", client)
  ensureColumn("shifts", "type", "ALTER TABLE shifts ADD COLUMN type TEXT DEFAULT 'day'", client)
  ensureColumn("sales", "shift_id", "ALTER TABLE sales ADD COLUMN shift_id INTEGER", client)
  ensureColumn("sales", "user_id", "ALTER TABLE sales ADD COLUMN user_id INTEGER", client)
  ensureColumn("sales", "payment_method", "ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT 'cash'", client)
  ensureColumn("sales", "customer_id", "ALTER TABLE sales ADD COLUMN customer_id INTEGER", client)
  ensureColumn("sales", "customer_name", "ALTER TABLE sales ADD COLUMN customer_name TEXT", client)
  ensureColumn("sales", "customer_phone", "ALTER TABLE sales ADD COLUMN customer_phone TEXT", client)
  ensureColumn(
    "sales",
    "items_total_before_discount",
    "ALTER TABLE sales ADD COLUMN items_total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "items_discount_total",
    "ALTER TABLE sales ADD COLUMN items_discount_total REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "sale_discount_type",
    "ALTER TABLE sales ADD COLUMN sale_discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "sales",
    "sale_discount_value",
    "ALTER TABLE sales ADD COLUMN sale_discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "sale_discount_amount",
    "ALTER TABLE sales ADD COLUMN sale_discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sales",
    "total_before_discount",
    "ALTER TABLE sales ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sale_items",
    "discount_type",
    "ALTER TABLE sale_items ADD COLUMN discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "sale_items",
    "discount_value",
    "ALTER TABLE sale_items ADD COLUMN discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sale_items",
    "discount_amount",
    "ALTER TABLE sale_items ADD COLUMN discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "sale_items",
    "total_before_discount",
    "ALTER TABLE sale_items ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn("sale_items", "bouquet_id", "ALTER TABLE sale_items ADD COLUMN bouquet_id INTEGER", client)
  ensureColumn("sale_items", "bouquet_name", "ALTER TABLE sale_items ADD COLUMN bouquet_name TEXT", client)
  ensureColumn("sale_items", "bouquet_group_id", "ALTER TABLE sale_items ADD COLUMN bouquet_group_id TEXT", client)
  ensureColumn(
    "order_items",
    "discount_type",
    "ALTER TABLE order_items ADD COLUMN discount_type TEXT DEFAULT 'none'",
    client
  )
  ensureColumn(
    "order_items",
    "discount_value",
    "ALTER TABLE order_items ADD COLUMN discount_value REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "order_items",
    "discount_amount",
    "ALTER TABLE order_items ADD COLUMN discount_amount REAL DEFAULT 0",
    client
  )
  ensureColumn(
    "order_items",
    "total_before_discount",
    "ALTER TABLE order_items ADD COLUMN total_before_discount REAL DEFAULT 0",
    client
  )
  ensureColumn("order_items", "bouquet_id", "ALTER TABLE order_items ADD COLUMN bouquet_id INTEGER", client)
  ensureColumn("order_items", "bouquet_name", "ALTER TABLE order_items ADD COLUMN bouquet_name TEXT", client)
  ensureColumn("order_items", "bouquet_group_id", "ALTER TABLE order_items ADD COLUMN bouquet_group_id TEXT", client)
  ensureColumn("orders", "created_by_user_id", "ALTER TABLE orders ADD COLUMN created_by_user_id INTEGER", client)
  ensureColumn("orders", "updated_by_user_id", "ALTER TABLE orders ADD COLUMN updated_by_user_id INTEGER", client)
  ensureColumn("movements", "user_id", "ALTER TABLE movements ADD COLUMN user_id INTEGER", client)
  ensureColumn("cash_transactions", "user_id", "ALTER TABLE cash_transactions ADD COLUMN user_id INTEGER", client)
  ensureColumn(
    "cash_transactions",
    "customer_id",
    "ALTER TABLE cash_transactions ADD COLUMN customer_id INTEGER",
    client
  )
  ensureColumn("cash_transactions", "deal_id", "ALTER TABLE cash_transactions ADD COLUMN deal_id INTEGER", client)
  ensureColumn("stock_movements", "user_id", "ALTER TABLE stock_movements ADD COLUMN user_id INTEGER", client)
  ensureColumn("stock_movements", "document_id", "ALTER TABLE stock_movements ADD COLUMN document_id INTEGER", client)
  ensureColumn("stock_documents", "supplier_id", "ALTER TABLE stock_documents ADD COLUMN supplier_id INTEGER", client)
  ensureColumn("stock_documents", "supplier_name", "ALTER TABLE stock_documents ADD COLUMN supplier_name TEXT", client)
  ensureColumn("stock_documents", "operation_at", "ALTER TABLE stock_documents ADD COLUMN operation_at TEXT", client)
  ensureColumn(
    "warehouse_import_items",
    "category_path",
    "ALTER TABLE warehouse_import_items ADD COLUMN category_path TEXT NOT NULL DEFAULT ''",
    client
  )
  ensureColumn("customers", "wazzup_chat_type", "ALTER TABLE customers ADD COLUMN wazzup_chat_type TEXT", client)
  ensureColumn("customers", "wazzup_chat_id", "ALTER TABLE customers ADD COLUMN wazzup_chat_id TEXT", client)
  ensureColumn("customers", "wazzup_channel_id", "ALTER TABLE customers ADD COLUMN wazzup_channel_id TEXT", client)
  ensureColumn("deals", "recipient_phone", "ALTER TABLE deals ADD COLUMN recipient_phone TEXT", client)
  ensureColumn("deals", "wazzup_chat_type", "ALTER TABLE deals ADD COLUMN wazzup_chat_type TEXT", client)
  ensureColumn("deals", "wazzup_chat_id", "ALTER TABLE deals ADD COLUMN wazzup_chat_id TEXT", client)
  ensureColumn("deals", "wazzup_channel_id", "ALTER TABLE deals ADD COLUMN wazzup_channel_id TEXT", client)
  ensureColumn("deals", "last_message_text", "ALTER TABLE deals ADD COLUMN last_message_text TEXT", client)
  ensureColumn("deals", "last_message_at", "ALTER TABLE deals ADD COLUMN last_message_at TEXT", client)
  ensureColumn("deal_items", "bouquet_id", "ALTER TABLE deal_items ADD COLUMN bouquet_id INTEGER", client)
  ensureColumn("deal_items", "bouquet_name", "ALTER TABLE deal_items ADD COLUMN bouquet_name TEXT", client)
  ensureColumn("deal_items", "bouquet_group_id", "ALTER TABLE deal_items ADD COLUMN bouquet_group_id TEXT", client)
  ensureColumn(
    "integration_settings",
    "webhook_auth_required",
    "ALTER TABLE integration_settings ADD COLUMN webhook_auth_required INTEGER DEFAULT 0",
    client
  )
  client.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_wazzup_chat ON customers(wazzup_chat_type, wazzup_chat_id);
    CREATE INDEX IF NOT EXISTS idx_deals_wazzup_chat ON deals(wazzup_chat_type, wazzup_chat_id, status);
    CREATE INDEX IF NOT EXISTS idx_bouquet_template_items_bouquet_id ON bouquet_template_items(bouquet_id);
    CREATE INDEX IF NOT EXISTS idx_bouquet_template_items_product_code ON bouquet_template_items(product_code);
    CREATE INDEX IF NOT EXISTS idx_sale_items_bouquet_group_id ON sale_items(bouquet_group_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_bouquet_group_id ON order_items(bouquet_group_id);
    CREATE INDEX IF NOT EXISTS idx_deal_items_bouquet_group_id ON deal_items(bouquet_group_id);

    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_cash_transactions_shift_id ON cash_transactions(shift_id);
    CREATE INDEX IF NOT EXISTS idx_cash_transactions_order_id ON cash_transactions(order_id);
    CREATE INDEX IF NOT EXISTS idx_sales_shift_id ON sales(shift_id);
    CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_due_at ON orders(due_at);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_document_id ON stock_movements(document_id);
    CREATE INDEX IF NOT EXISTS idx_movements_created_at ON movements(created_at);
    CREATE INDEX IF NOT EXISTS idx_deals_source_status ON deals(source, status, order_id);
  `)
}
