-- ==============================================================================
-- AWLAD SELIM - أولاد سليم للمحاسبة وإدارة الأعمال
-- PostgreSQL Relational Enterprise Schema
-- Version: 3.0.0 (Secured Backend Auth, Customer Orders Lifecycle & ACID Inventory)
-- ==============================================================================

-- Sequences for safe concurrent document numbering
CREATE SEQUENCE IF NOT EXISTS seq_customer_order_no;
CREATE SEQUENCE IF NOT EXISTS seq_sales_invoice_no;
CREATE SEQUENCE IF NOT EXISTS seq_purchase_invoice_no;
CREATE SEQUENCE IF NOT EXISTS seq_sales_return_no;
CREATE SEQUENCE IF NOT EXISTS seq_purchase_return_no;
CREATE SEQUENCE IF NOT EXISTS seq_stock_movement_no;
CREATE SEQUENCE IF NOT EXISTS seq_owner_tx_no;
CREATE SEQUENCE IF NOT EXISTS seq_stock_count_no;
CREATE SEQUENCE IF NOT EXISTS seq_stock_transfer_no;
CREATE SEQUENCE IF NOT EXISTS seq_cash_op_no;
CREATE SEQUENCE IF NOT EXISTS seq_order_advance_no;
CREATE SEQUENCE IF NOT EXISTS seq_quote_no;
CREATE SEQUENCE IF NOT EXISTS seq_rep_custody_op_no;

-- 1. المستخدمون والصلاحيات (Users & Roles)
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  full_name TEXT NOT NULL,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_algo VARCHAR(24) NOT NULL DEFAULT 'bcrypt',
  phone VARCHAR(32) DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  role VARCHAR(32) NOT NULL,
  job_title TEXT DEFAULT '',
  department TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  last_login TIMESTAMPTZ,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  shortcuts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 1b. جلسات المستخدمين النشطة (User Sessions & Refresh Tokens)
CREATE TABLE IF NOT EXISTS user_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  device_id VARCHAR(64),
  device_info TEXT,
  ip_address VARCHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. إعدادات النظام والمؤسسة (System Settings)
CREATE TABLE IF NOT EXISTS system_settings (
  id VARCHAR(64) PRIMARY KEY,
  company_name TEXT NOT NULL,
  company_subtitle TEXT,
  phone1 VARCHAR(32),
  phone2 VARCHAR(32),
  address TEXT,
  commercial_registration VARCHAR(64),
  tax_number VARCHAR(64),
  currency VARCHAR(16) NOT NULL DEFAULT 'ج.م',
  default_print_mode VARCHAR(16) NOT NULL DEFAULT 'a4',
  invoice_notes TEXT,
  allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE,
  extra_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. المستودعات والمخازن (Warehouses)
CREATE TABLE IF NOT EXISTS warehouses (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  code VARCHAR(32) UNIQUE NOT NULL,
  location TEXT,
  manager_name TEXT,
  phone VARCHAR(32),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. تصنيفات السلع الغذائية (Categories)
CREATE TABLE IF NOT EXISTS product_categories (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. المنتجات والأصناف الغذائية (Products)
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  barcode VARCHAR(64),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  category_id VARCHAR(64),
  base_unit VARCHAR(32) NOT NULL,
  size TEXT,
  color TEXT,
  purchase_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  selling_price NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  min_stock_level NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  stock_per_warehouse JSONB NOT NULL DEFAULT '{}'::jsonb,
  image TEXT,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  import_batch_id VARCHAR(64),
  imported_from_file BOOLEAN NOT NULL DEFAULT FALSE,
  source_file_name TEXT,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. وحدات التعبئة الإضافية للأصناف (Product Units)
CREATE TABLE IF NOT EXISTS product_units (
  id VARCHAR(64) PRIMARY KEY,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  conversion_factor NUMERIC(12, 3) NOT NULL,
  barcode VARCHAR(64),
  purchase_price NUMERIC(14, 2),
  selling_price NUMERIC(14, 2)
);

-- 7. العملاء وأسعار الجملة المخصصة (Customers & Price History)
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  user_id VARCHAR(64) UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  assigned_rep_id VARCHAR(64),
  allowed_rep_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  name TEXT NOT NULL,
  phone VARCHAR(32),
  secondary_phone VARCHAR(32),
  phone2 VARCHAR(32),
  shop_name TEXT,
  shop_photo TEXT,
  photo TEXT,
  address TEXT,
  shop_address TEXT,
  area TEXT,
  geo_coordinates TEXT,
  map_location TEXT,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  price_history JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. الموردون (Suppliers)
CREATE TABLE IF NOT EXISTS suppliers (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone VARCHAR(32),
  address TEXT,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. الخزائن والبنوك (Cashboxes & Banks)
CREATE TABLE IF NOT EXISTS cashboxes (
  id VARCHAR(64) PRIMARY KEY,
  name TEXT NOT NULL,
  type VARCHAR(16) NOT NULL DEFAULT 'cashbox',
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. الفواتير (Invoices: Sales & Purchases)
CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  invoice_number VARCHAR(64) UNIQUE NOT NULL,
  type VARCHAR(16) NOT NULL, -- 'sales' | 'purchase'
  date DATE NOT NULL,
  customer_id VARCHAR(64) REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  supplier_id VARCHAR(64) REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT,
  representative_id VARCHAR(64),
  representative_name TEXT,
  warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  warehouse_name TEXT NOT NULL,
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  tax_total NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  grand_total NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  applied_advance_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  remaining_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  payment_type VARCHAR(16) NOT NULL, -- 'cash' | 'credit' | 'partial'
  payment_method VARCHAR(32) NOT NULL DEFAULT 'cash',
  cashbox_id VARCHAR(64) NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  status VARCHAR(16) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  notes TEXT,
  linked_rep_transfer_id VARCHAR(64),
  linked_rep_transfer_number VARCHAR(64),
  linked_customer_order_id VARCHAR(64),
  returned_quantity_by_item JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(128),
  origin_device_id VARCHAR(64),
  sync_status VARCHAR(24) NOT NULL DEFAULT 'synced',
  review_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
  reviewed_by VARCHAR(64),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT DEFAULT '',
  edited_by VARCHAR(64),
  edited_at TIMESTAMPTZ,
  edit_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  cancelled_by VARCHAR(64),
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. بنود الفواتير (Invoice Items)
CREATE TABLE IF NOT EXISTS invoice_items (
  id VARCHAR(64) PRIMARY KEY,
  invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  barcode VARCHAR(64),
  unit VARCHAR(32) NOT NULL,
  unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
  quantity NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(14, 2) NOT NULL,
  purchase_price_at_time NUMERIC(14, 2) NOT NULL,
  discount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  total NUMERIC(14, 2) NOT NULL
);

-- 12. دفعات سداد الفواتير المتعددة (Invoice Subsequent Payments)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id VARCHAR(64) PRIMARY KEY,
  invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  invoice_number VARCHAR(64) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  date DATE NOT NULL,
  payment_method VARCHAR(32) NOT NULL DEFAULT 'cash',
  cashbox_id VARCHAR(64) NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  cashbox_name TEXT NOT NULL,
  notes TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. مرتجعات الفواتير (Invoice Returns)
CREATE TABLE IF NOT EXISTS invoice_returns (
  id VARCHAR(64) PRIMARY KEY,
  return_number VARCHAR(64) UNIQUE NOT NULL,
  type VARCHAR(32) NOT NULL, -- 'sales_return' | 'purchase_return'
  original_invoice_id VARCHAR(64) NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  original_invoice_number VARCHAR(64) NOT NULL,
  date DATE NOT NULL,
  party_id VARCHAR(64) NOT NULL,
  party_name TEXT NOT NULL,
  warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  warehouse_name TEXT NOT NULL,
  grand_total NUMERIC(14, 2) NOT NULL,
  refund_type VARCHAR(16) NOT NULL DEFAULT 'cash',
  cashbox_id VARCHAR(64),
  reason TEXT NOT NULL,
  notes TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. بنود المرتجعات (Invoice Return Items)
CREATE TABLE IF NOT EXISTS invoice_return_items (
  id VARCHAR(64) PRIMARY KEY,
  return_id VARCHAR(64) NOT NULL REFERENCES invoice_returns(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit VARCHAR(32) NOT NULL,
  unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
  quantity NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(14, 2) NOT NULL,
  total NUMERIC(14, 2) NOT NULL
);

-- 15. المناديب (Representatives)
CREATE TABLE IF NOT EXISTS representatives (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64),
  user_id VARCHAR(64) UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone VARCHAR(32),
  vehicle_number VARCHAR(64),
  address TEXT,
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  cash_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  goods_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  commission_rate NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
  warehouse_id VARCHAR(64) REFERENCES warehouses(id) ON DELETE SET NULL,
  notes TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. تحويلات العهدة المالية للمناديب (Rep Financial Transfers)
CREATE TABLE IF NOT EXISTS rep_transfers (
  id VARCHAR(64) PRIMARY KEY,
  transfer_number VARCHAR(64) UNIQUE NOT NULL,
  representative_id VARCHAR(64) REFERENCES representatives(id) ON DELETE RESTRICT,
  representative_name TEXT,
  direction VARCHAR(32),
  sender_id VARCHAR(64),
  sender_name TEXT,
  receiver_id VARCHAR(64),
  receiver_name TEXT,
  type VARCHAR(32),
  amount NUMERIC(14, 2) NOT NULL,
  cashbox_id VARCHAR(64),
  cashbox_name TEXT,
  date DATE NOT NULL,
  status VARCHAR(32) NOT NULL,
  notes TEXT,
  rejection_reason TEXT,
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  confirmed_by TEXT,
  audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 17. طلبات تحويل أصناف وعهدة المندوب المرتبطة بالفاتورة (Rep Item Transfers linked to Invoices)
CREATE TABLE IF NOT EXISTS rep_item_transfers (
  id VARCHAR(64) PRIMARY KEY,
  request_number VARCHAR(64) UNIQUE NOT NULL,
  date DATE NOT NULL,
  representative_id VARCHAR(64) NOT NULL REFERENCES representatives(id) ON DELETE RESTRICT,
  representative_name TEXT NOT NULL,
  invoice_id VARCHAR(64),
  invoice_number VARCHAR(64),
  source_warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  source_warehouse_name TEXT NOT NULL,
  target_warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  target_warehouse_name TEXT NOT NULL,
  status VARCHAR(16) NOT NULL,
  rejection_reason TEXT,
  notes TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transfer_mode VARCHAR(32) NOT NULL DEFAULT 'transfer',
  dispatched_by TEXT,
  dispatched_at TIMESTAMPTZ,
  reviewed_by VARCHAR(64),
  reviewed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  received_by VARCHAR(64),
  received_at TIMESTAMPTZ
);

-- 18. بنود طلب تحويل الأصناف (Rep Item Transfer Items)
CREATE TABLE IF NOT EXISTS rep_item_transfer_items (
  id VARCHAR(64) PRIMARY KEY,
  transfer_id VARCHAR(64) NOT NULL REFERENCES rep_item_transfers(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  barcode VARCHAR(64),
  unit VARCHAR(32) NOT NULL,
  requested_qty NUMERIC(12, 3) NOT NULL,
  available_in_van_qty NUMERIC(12, 3) NOT NULL DEFAULT 0.000,
  shortage_qty NUMERIC(12, 3) NOT NULL,
  approved_qty NUMERIC(12, 3),
  executed_qty NUMERIC(12, 3)
);

-- 19. حركات المخزون التفصيلية (Stock Movements Ledger)
CREATE TABLE IF NOT EXISTS stock_movements (
  id VARCHAR(64) PRIMARY KEY,
  movement_number VARCHAR(64) UNIQUE,
  date DATE NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  warehouse_name TEXT NOT NULL,
  target_warehouse_id VARCHAR(64),
  target_warehouse_name TEXT,
  movement_type VARCHAR(32) NOT NULL,
  quantity NUMERIC(12, 3) NOT NULL,
  unit VARCHAR(32) DEFAULT '',
  unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
  unit_cost NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  balance_before NUMERIC(12, 3),
  balance_after NUMERIC(12, 3) DEFAULT 0.000,
  related_doc_type VARCHAR(32),
  related_doc_id VARCHAR(64),
  related_doc_number VARCHAR(64),
  notes TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 20. المعاملات المالية للخزائن (Financial Transactions)
CREATE TABLE IF NOT EXISTS financial_transactions (
  id VARCHAR(64) PRIMARY KEY,
  transaction_number VARCHAR(64) UNIQUE NOT NULL,
  date DATE NOT NULL,
  type VARCHAR(32) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  cashbox_id VARCHAR(64) NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  cashbox_name TEXT NOT NULL,
  balance_after NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  category TEXT,
  related_entity_type VARCHAR(32),
  related_entity_id VARCHAR(64),
  related_entity_name TEXT,
  related_doc_type VARCHAR(32),
  related_doc_id VARCHAR(64),
  related_doc_number VARCHAR(64),
  description TEXT,
  notes TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 21. الشيكات (Cheques)
CREATE TABLE IF NOT EXISTS cheques (
  id VARCHAR(64) PRIMARY KEY,
  cheque_number VARCHAR(64) NOT NULL,
  type VARCHAR(16) NOT NULL,
  bank_name TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  party_type VARCHAR(16) NOT NULL,
  party_id VARCHAR(64) NOT NULL,
  party_name TEXT NOT NULL,
  status VARCHAR(16) NOT NULL,
  cashbox_id VARCHAR(64),
  notes TEXT,
  created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 22. الأقساط (Installments)
CREATE TABLE IF NOT EXISTS installments (
  id VARCHAR(64) PRIMARY KEY,
  schedule_number VARCHAR(64) UNIQUE NOT NULL,
  customer_id VARCHAR(64) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  invoice_id VARCHAR(64) REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(64),
  total_amount NUMERIC(14, 2) NOT NULL,
  paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  remaining_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  number_of_installments INT NOT NULL DEFAULT 1,
  installments_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 23. الموظفون (Employees)
CREATE TABLE IF NOT EXISTS employees (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(64) UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  job_title TEXT NOT NULL,
  department TEXT,
  phone VARCHAR(32),
  national_id VARCHAR(32),
  address TEXT,
  hire_date DATE NOT NULL,
  basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 24. السلف والخصومات للموظفين (Advances & Deductions)
CREATE TABLE IF NOT EXISTS advances_deductions (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_name TEXT NOT NULL,
  type VARCHAR(16) NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  date DATE NOT NULL,
  reason TEXT,
  cashbox_id VARCHAR(64),
  is_settled BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 25. الحضور والغياب (Attendance)
CREATE TABLE IF NOT EXISTS attendance (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_name TEXT NOT NULL,
  date DATE NOT NULL,
  status VARCHAR(16) NOT NULL,
  check_in_time VARCHAR(16),
  check_out_time VARCHAR(16),
  delay_minutes INT NOT NULL DEFAULT 0,
  notes TEXT,
  created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 26. مسير الرواتب (Payrolls)
CREATE TABLE IF NOT EXISTS payrolls (
  id VARCHAR(64) PRIMARY KEY,
  payroll_number VARCHAR(64) UNIQUE NOT NULL,
  month VARCHAR(16) NOT NULL,
  year INT,
  employee_id VARCHAR(64) NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  employee_name TEXT NOT NULL,
  basic_salary NUMERIC(14, 2) NOT NULL,
  allowances NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  deductions NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  advances NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  net_salary NUMERIC(14, 2) NOT NULL,
  payment_status VARCHAR(16) NOT NULL DEFAULT 'paid',
  payment_date DATE,
  cashbox_id VARCHAR(64),
  notes TEXT,
  created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 27. المصروفات والإيرادات الأخرى (Expenses & Incomes)
CREATE TABLE IF NOT EXISTS expenses_incomes (
  id VARCHAR(64) PRIMARY KEY,
  voucher_number VARCHAR(64) UNIQUE NOT NULL,
  type VARCHAR(16) NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL,
  date DATE NOT NULL,
  cashbox_id VARCHAR(64) NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  cashbox_name TEXT NOT NULL,
  payment_method VARCHAR(32) DEFAULT 'cash',
  recipient_or_payer TEXT,
  attachment_name TEXT,
  notes TEXT,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 28. سجل المراجعة وتدقيق العمليات (Audit Logs)
CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id VARCHAR(64),
  user_name TEXT,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  record_id VARCHAR(64),
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(64),
  device_info TEXT,
  notes TEXT
);

-- 29. سجل الترحيل والترقية (Migration Logs)
CREATE TABLE IF NOT EXISTS migration_logs (
  id VARCHAR(64) PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version VARCHAR(32) NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  destination TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  total_records INT NOT NULL DEFAULT 0,
  migrated_records INT NOT NULL DEFAULT 0,
  failed_records INT NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  executed_by VARCHAR(64) NOT NULL,
  notes TEXT
);

-- 30. طلبات العملاء والمندوبين (Customer & Representative Item Orders)
CREATE TABLE IF NOT EXISTS customer_item_orders (
  id VARCHAR(64) PRIMARY KEY,
  request_number VARCHAR(64) UNIQUE NOT NULL,
  customer_id VARCHAR(64) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  requester_type VARCHAR(24) NOT NULL DEFAULT 'customer',
  submitted_by_name TEXT DEFAULT '',
  representative_id VARCHAR(64),
  representative_name TEXT DEFAULT '',
  customer_name TEXT NOT NULL,
  customer_phone VARCHAR(32) NOT NULL DEFAULT '',
  shop_name TEXT DEFAULT '',
  delivery_address TEXT NOT NULL DEFAULT '',
  geo_coordinates TEXT DEFAULT '',
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  advance_paid_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  remaining_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'approved', 'rejected', 'preparing', 'rep_assigned', 'out_for_delivery', 'delivered', 'needs_review', 'invoiced', 'collected', 'closed', 'cancelled')),
  delivery_rep_id VARCHAR(64),
  delivery_rep_name TEXT DEFAULT '',
  delivered_at TIMESTAMPTZ,
  delivery_notes TEXT DEFAULT '',
  delivery_proof TEXT,
  collected_amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  source_platform VARCHAR(24) NOT NULL DEFAULT 'web',
  origin_device_id VARCHAR(64),
  sync_status VARCHAR(24) NOT NULL DEFAULT 'synced',
  notes TEXT,
  rejection_reason TEXT,
  reviewed_by VARCHAR(64),
  reviewed_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  invoice_id VARCHAR(64) UNIQUE REFERENCES invoices(id) ON DELETE SET NULL,
  invoice_number VARCHAR(64),
  idempotency_key VARCHAR(128) UNIQUE,
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 31. تفاصيل أصناف طلب العميل والمندوب (Customer Order Items)
CREATE TABLE IF NOT EXISTS customer_item_order_items (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES customer_item_orders(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_code VARCHAR(64),
  product_name TEXT NOT NULL,
  product_image TEXT,
  unit VARCHAR(32) NOT NULL,
  unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
  quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
  reference_unit_price NUMERIC(14, 2)
);

-- 32. سجل تغيّر حالات طلب العميل (Customer Order Status History)
CREATE TABLE IF NOT EXISTS order_status_history (
  id VARCHAR(64) PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES customer_item_orders(id) ON DELETE CASCADE,
  from_status VARCHAR(24),
  to_status VARCHAR(24) NOT NULL,
  changed_by_user_id VARCHAR(64) REFERENCES users(id) ON DELETE SET NULL,
  changed_by_name TEXT NOT NULL,
  reason TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 33. مفاتيح منع التكرار للعمليات المتزامنة (Idempotency Keys)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_id VARCHAR(128) PRIMARY KEY,
  user_id VARCHAR(64),
  endpoint VARCHAR(128) NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- فهارس تحسين الأداء (Indexes for High-Performance Wholesale Queries)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_reps_user ON representatives(user_id);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_type_status ON invoices(type, status);
CREATE INDEX IF NOT EXISTS idx_invoices_rep_transfer ON invoices(linked_rep_transfer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_linked_order ON invoices(linked_customer_order_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product ON invoice_items(product_id);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_date ON invoice_payments(date DESC);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_item_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON customer_item_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON customer_item_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON customer_item_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_status_history(order_id);

CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- 34. الحسابات الشخصية لأصحاب النشاط (Owner Personal Accounts - المعزولة تماماً عن حسابات المؤسسة)
CREATE TABLE IF NOT EXISTS owner_accounts (
  id VARCHAR(64) PRIMARY KEY,
  owner_name TEXT NOT NULL,
  account_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  opening_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  current_balance NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  notes TEXT DEFAULT '',
  created_by VARCHAR(64) NOT NULL DEFAULT 'النظام',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 35. حركات الحسابات الشخصية لأصحاب النشاط (Owner Personal Transactions)
CREATE TABLE IF NOT EXISTS owner_transactions (
  id VARCHAR(64) PRIMARY KEY,
  tx_number VARCHAR(64) UNIQUE NOT NULL,
  account_id VARCHAR(64) NOT NULL REFERENCES owner_accounts(id) ON DELETE RESTRICT,
  account_name TEXT NOT NULL,
  owner_name TEXT NOT NULL,
  type VARCHAR(32) NOT NULL CHECK (type IN ('personal_deposit', 'personal_withdrawal', 'personal_expense', 'opening_balance', 'adjustment')),
  amount NUMERIC(14, 2) NOT NULL,
  date DATE NOT NULL,
  cashbox_id VARCHAR(64) REFERENCES cashboxes(id) ON DELETE RESTRICT,
  cashbox_name TEXT DEFAULT '',
  balance_before NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  balance_after NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  idempotency_key VARCHAR(128) UNIQUE,
  created_by_user_id VARCHAR(64),
  created_by VARCHAR(64) NOT NULL,
  edited_by VARCHAR(64),
  edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 36. جلسات جرد المخزن (Inventory Stock Counts)
CREATE TABLE IF NOT EXISTS stock_counts (
  id VARCHAR(64) PRIMARY KEY,
  count_number VARCHAR(64) UNIQUE NOT NULL,
  date DATE NOT NULL,
  warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  warehouse_name TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  notes TEXT DEFAULT '',
  rejection_reason TEXT,
  counter_user_id VARCHAR(64),
  counter_name TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  approved_by_user_id VARCHAR(64),
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 37. بنود جرد المخزن (Inventory Stock Count Items)
CREATE TABLE IF NOT EXISTS stock_count_items (
  id VARCHAR(64) PRIMARY KEY,
  count_id VARCHAR(64) NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_code VARCHAR(64) DEFAULT '',
  product_barcode VARCHAR(64) DEFAULT '',
  product_name TEXT NOT NULL,
  unit VARCHAR(32) NOT NULL,
  system_qty NUMERIC(14, 3) NOT NULL DEFAULT 0.000,
  actual_qty NUMERIC(14, 3) NOT NULL DEFAULT 0.000,
  variance_qty NUMERIC(14, 3) NOT NULL DEFAULT 0.000,
  variance_type VARCHAR(16) NOT NULL DEFAULT 'matched' CHECK (variance_type IN ('matched', 'shortage', 'surplus')),
  live_qty_at_approval NUMERIC(14, 3),
  reason TEXT DEFAULT ''
);

-- 38. طلبات تحويل الأصناف بين المستودعات (Structured Multi-Item Stock Transfer Orders)
CREATE TABLE IF NOT EXISTS stock_transfer_requests (
  id VARCHAR(64) PRIMARY KEY,
  transfer_number VARCHAR(64) UNIQUE NOT NULL,
  date DATE NOT NULL,
  source_warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  source_warehouse_name TEXT NOT NULL,
  target_warehouse_id VARCHAR(64) NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  target_warehouse_name TEXT NOT NULL,
  transfer_type VARCHAR(32) NOT NULL DEFAULT 'warehouse_transfer',
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'executed')),
  reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  rejection_reason TEXT,
  created_by_user_id VARCHAR(64),
  created_by TEXT NOT NULL,
  submitted_at TIMESTAMPTZ,
  approved_by_user_id VARCHAR(64),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  executed_by_user_id VARCHAR(64),
  executed_by TEXT,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 39. أصناف طلب تحويل المخزون (Stock Transfer Request Items)
CREATE TABLE IF NOT EXISTS stock_transfer_request_items (
  id VARCHAR(64) PRIMARY KEY,
  transfer_id VARCHAR(64) NOT NULL REFERENCES stock_transfer_requests(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_code VARCHAR(64) DEFAULT '',
  product_barcode VARCHAR(64) DEFAULT '',
  product_name TEXT NOT NULL,
  unit VARCHAR(32) NOT NULL,
  unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
  requested_qty NUMERIC(14, 3) NOT NULL CHECK (requested_qty > 0),
  available_qty_snapshot NUMERIC(14, 3) NOT NULL DEFAULT 0.000,
  executed_qty NUMERIC(14, 3),
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_owner_tx_account ON owner_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_owner_tx_date ON owner_transactions(date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_counts_wh ON stock_counts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_status ON stock_counts(status);
CREATE INDEX IF NOT EXISTS idx_stock_count_items_count ON stock_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_status ON stock_transfer_requests(status);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_request_items(transfer_id);


CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_wh ON stock_movements(product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements(date DESC);

CREATE INDEX IF NOT EXISTS idx_rep_transfers_rep ON rep_transfers(representative_id);
CREATE INDEX IF NOT EXISTS idx_rep_item_transfers_rep ON rep_item_transfers(representative_id);
CREATE INDEX IF NOT EXISTS idx_rep_item_transfers_invoice ON rep_item_transfers(invoice_id);

CREATE INDEX IF NOT EXISTS idx_fin_tx_cashbox ON financial_transactions(cashbox_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_migration_logs_timestamp ON migration_logs(timestamp DESC);

-- 40. روابط الربط الذكي والأجهزة المرتبطة (Device Pairing Tokens & Paired Devices)
CREATE TABLE IF NOT EXISTS pairing_tokens (
  id VARCHAR(64) PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  token_preview VARCHAR(32) NOT NULL,
  created_by_user_id VARCHAR(64),
  created_by_name TEXT NOT NULL,
  target_user_id VARCHAR(64),
  target_user_name TEXT DEFAULT '',
  target_role VARCHAR(32) DEFAULT '',
  target_device_type VARCHAR(24) NOT NULL DEFAULT 'any',
  connection_mode VARCHAR(32) NOT NULL DEFAULT 'auto',
  server_base_url TEXT DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  single_use BOOLEAN NOT NULL DEFAULT TRUE,
  used_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  require_admin_approval BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at TIMESTAMPTZ,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paired_devices (
  device_id VARCHAR(64) PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_type VARCHAR(24) NOT NULL DEFAULT 'android',
  os_version TEXT DEFAULT '',
  app_version TEXT DEFAULT '',
  linked_user_id VARCHAR(64),
  linked_user_name TEXT DEFAULT '',
  connection_mode VARCHAR(32) NOT NULL DEFAULT 'local_network',
  server_url_used TEXT DEFAULT '',
  ip_address VARCHAR(64) DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_approval', 'revoked')),
  pairing_token_id VARCHAR(64),
  config_version INT NOT NULL DEFAULT 1,
  paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expires ON pairing_tokens(expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_paired_devices_status ON paired_devices(status);
CREATE INDEX IF NOT EXISTS idx_sessions_device ON user_sessions(device_id);

-- 41. الدفعات المقدمة لطلبات العملاء (Order Advance Payments / Customer Credit before Invoicing)
CREATE TABLE IF NOT EXISTS order_advance_payments (
  id VARCHAR(64) PRIMARY KEY,
  payment_number VARCHAR(64) UNIQUE NOT NULL,
  order_id VARCHAR(64) NOT NULL REFERENCES customer_item_orders(id) ON DELETE CASCADE,
  customer_id VARCHAR(64) NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  cashbox_id VARCHAR(64) NOT NULL REFERENCES cashboxes(id) ON DELETE RESTRICT,
  cashbox_name TEXT NOT NULL DEFAULT '',
  payment_method VARCHAR(32) NOT NULL DEFAULT 'cash',
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  date DATE NOT NULL,
  notes TEXT DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'applied', 'refunded')),
  applied_invoice_id VARCHAR(64),
  idempotency_key VARCHAR(128) UNIQUE,
  origin_device_id VARCHAR(64),
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 42. سجل تعارضات المزامنة للمراجعة اليدوية (Sync Conflicts - No Silent Overwrites)
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id VARCHAR(64) PRIMARY KEY,
  operation_id VARCHAR(128) NOT NULL,
  operation_type VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64),
  device_id VARCHAR(64),
  user_id VARCHAR(64),
  user_name TEXT DEFAULT '',
  conflict_reason TEXT NOT NULL,
  local_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(32) NOT NULL DEFAULT 'needs_review' CHECK (status IN ('needs_review', 'resolved_keep_server', 'resolved_apply_local', 'dismissed')),
  resolution_notes TEXT DEFAULT '',
  resolved_by VARCHAR(64),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 43. سجل منع تكرار عمليات المزامنة (Offline Sync Operation Deduplication Log)
CREATE TABLE IF NOT EXISTS sync_operation_logs (
  id VARCHAR(64) PRIMARY KEY,
  operation_id VARCHAR(128) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  device_id VARCHAR(64),
  operation_type VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64),
  status VARCHAR(32) NOT NULL,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_order_advances_order ON order_advance_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_advances_customer ON order_advance_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_status ON sync_conflicts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_ops_user_op ON sync_operation_logs(user_id, operation_id);

-- 44. سجل عمليات عهدة المندوب وتسليمها للعملاء والمرتجعات والتسويات (Representative Custody Operations)
CREATE TABLE IF NOT EXISTS rep_custody_operations (
  id VARCHAR(64) PRIMARY KEY,
  operation_number VARCHAR(64) UNIQUE NOT NULL,
  date DATE NOT NULL,
  representative_id VARCHAR(64) NOT NULL REFERENCES representatives(id) ON DELETE RESTRICT,
  representative_name TEXT NOT NULL,
  operation_type VARCHAR(32) NOT NULL,
  product_id VARCHAR(64) NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  unit VARCHAR(32) NOT NULL,
  unit_factor NUMERIC(12, 3) NOT NULL DEFAULT 1.000,
  quantity NUMERIC(12, 3) NOT NULL,
  base_quantity NUMERIC(12, 3) NOT NULL,
  warehouse_id VARCHAR(64),
  warehouse_name TEXT DEFAULT '',
  customer_id VARCHAR(64),
  customer_name TEXT DEFAULT '',
  invoice_id VARCHAR(64),
  invoice_number VARCHAR(64),
  notes TEXT DEFAULT '',
  status VARCHAR(24) NOT NULL DEFAULT 'approved',
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_custody_ops_rep ON rep_custody_operations(representative_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rep_custody_ops_prod ON rep_custody_operations(product_id);


