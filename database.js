"use strict";

require("dotenv").config();

const mysql = require("mysql2/promise");

const databaseName = String(process.env.DB_NAME || "esports_club").trim();
if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
  throw new Error("DB_NAME 只能包含字母、数字和下划线");
}

let pool;

function connectionOptions(includeDatabase = true) {
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "club_app",
    password: process.env.DB_PASSWORD || "",
    ...(includeDatabase ? { database: databaseName } : {}),
    charset: "utf8mb4",
    timezone: "Z",
    decimalNumbers: true,
    waitForConnections: true,
    connectionLimit: Math.max(2, Number(process.env.DB_CONNECTION_LIMIT || 10)),
    queueLimit: 0,
  };
}

async function initializeDatabase({ schema = true } = {}) {
  if (pool) return pool;

  if (schema && process.env.NODE_ENV !== "production") {
    const bootstrap = await mysql.createConnection(connectionOptions(false));
    try {
      await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    } finally { await bootstrap.end(); }
  }

  pool = mysql.createPool(connectionOptions(true));
  await pool.query("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci");
  if (!schema) return pool;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS metadata (
      \`key\` VARCHAR(191) PRIMARY KEY,
      \`value\` LONGTEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      account VARCHAR(48) PRIMARY KEY,
      display_name VARCHAR(80) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      account VARCHAR(48) PRIMARY KEY,
      club_name VARCHAR(80) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configs (
      account VARCHAR(48) PRIMARY KEY,
      payload LONGTEXT NOT NULL,
      version INT NOT NULL DEFAULT 1,
      updated_at BIGINT NOT NULL,
      CONSTRAINT fk_configs_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      customer_key VARCHAR(80) PRIMARY KEY,
      numeric_id BIGINT UNSIGNED NOT NULL UNIQUE,
      display_name VARCHAR(40) NOT NULL UNIQUE,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX customers_created_idx (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      customer_id VARCHAR(80) NULL,
      payload LONGTEXT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX orders_account_created_idx (account, created_at, id),
      INDEX orders_customer_created_idx (account, customer_id, created_at, id),
      CONSTRAINT fk_orders_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      sender_role VARCHAR(16) NOT NULL,
      sender_id VARCHAR(80) NOT NULL,
      sender_name VARCHAR(80) NOT NULL,
      body TEXT NOT NULL,
      read_by_boss_at BIGINT NULL,
      read_by_staff_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      INDEX order_messages_order_idx (account, order_no, created_at, id),
      INDEX order_messages_unread_idx (account, order_no, sender_role, created_at),
      CONSTRAINT fk_order_messages_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_accounts (
      account VARCHAR(48) NOT NULL,
      owner_type VARCHAR(16) NOT NULL,
      owner_id VARCHAR(80) NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      balance DECIMAL(14,2) UNSIGNED NOT NULL DEFAULT 0.00,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (account, owner_type, owner_id),
      INDEX wallet_accounts_type_idx (account, owner_type, updated_at),
      CONSTRAINT fk_wallet_accounts_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      owner_type VARCHAR(16) NOT NULL,
      owner_id VARCHAR(80) NOT NULL,
      amount DECIMAL(14,2) NOT NULL,
      balance_after DECIMAL(14,2) UNSIGNED NOT NULL,
      transaction_type VARCHAR(32) NOT NULL DEFAULT 'merchant_credit',
      reference_no VARCHAR(80) NULL,
      note VARCHAR(200) NOT NULL DEFAULT '',
      operator_account VARCHAR(48) NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX wallet_transactions_owner_idx (account, owner_type, owner_id, created_at, id),
      CONSTRAINT fk_wallet_transactions_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [walletTransactionColumns] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'wallet_transactions'",
    [databaseName],
  );
  const walletTransactionColumnNames = new Set(walletTransactionColumns.map((row) => row.COLUMN_NAME));
  if (!walletTransactionColumnNames.has("transaction_type")) {
    await pool.query("ALTER TABLE wallet_transactions ADD COLUMN transaction_type VARCHAR(32) NOT NULL DEFAULT 'merchant_credit' AFTER balance_after");
  }
  if (!walletTransactionColumnNames.has("reference_no")) {
    await pool.query("ALTER TABLE wallet_transactions ADD COLUMN reference_no VARCHAR(80) NULL AFTER transaction_type");
  }
  await pool.query("ALTER TABLE wallet_transactions MODIFY COLUMN amount DECIMAL(14,2) NOT NULL");
  const [customerIdColumns] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'customer_id'",
    [databaseName],
  );
  if (!customerIdColumns.length) {
    await pool.query("ALTER TABLE orders ADD COLUMN customer_id VARCHAR(80) NULL AFTER order_no");
  }
  const [customerIdIndexes] = await pool.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' AND INDEX_NAME = 'orders_customer_created_idx'",
    [databaseName],
  );
  if (!customerIdIndexes.length) {
    await pool.query("CREATE INDEX orders_customer_created_idx ON orders (account, customer_id, created_at, id)");
  }
  const [orderNumberIndexes] = await pool.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'orders' AND INDEX_NAME = 'orders_account_order_no_uq'",
    [databaseName],
  );
  if (!orderNumberIndexes.length) {
    const [duplicateOrderNumbers] = await pool.query(
      "SELECT 1 FROM orders GROUP BY account, order_no HAVING COUNT(*) > 1 LIMIT 1",
    );
    if (duplicateOrderNumbers.length) throw new Error("存在重复商户订单编号，请备份并人工核对后再启动，不能跳过唯一约束");
    await pool.query("CREATE UNIQUE INDEX orders_account_order_no_uq ON orders (account, order_no)");
  }
  // 订单评价：只有下过单的客户能评，且必须商户审核通过才对外展示。
  // UNIQUE(account, order_no) 兜住"一个订单只能评价一次"——并发的重复提交会撞唯一键，
  // 服务端把它翻译成"已提交，等待审核"，不会产生第二条。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_reviews (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      customer_key VARCHAR(80) NOT NULL,
      product_id VARCHAR(80) NOT NULL DEFAULT '',
      product_title VARCHAR(120) NOT NULL DEFAULT '',
      rating TINYINT UNSIGNED NOT NULL DEFAULT 5,
      content VARCHAR(300) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      reject_reason VARCHAR(200) NOT NULL DEFAULT '',
      reviewed_by VARCHAR(48) NULL,
      reviewed_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE KEY order_reviews_order_uq (account, order_no),
      INDEX order_reviews_status_idx (account, status, created_at),
      INDEX order_reviews_product_idx (account, product_id, status, created_at),
      INDEX order_reviews_customer_idx (account, customer_key, created_at),
      CONSTRAINT fk_order_reviews_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      payload LONGTEXT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX logs_account_created_idx (account, created_at, id),
      CONSTRAINT fk_logs_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Idempotency receipts for balance adjustments. A retry reuses its request_id and gets the
  // stored result back instead of crediting twice. Do NOT add automatic pruning here: deleting
  // a receipt a client might still retry would silently reopen the double-credit window.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_credit_requests (
      account VARCHAR(48) NOT NULL,
      request_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result_payload LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (account, request_id),
      CONSTRAINT fk_wallet_credit_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 每一笔微信支付都有落库的支付意图：金额、客户、用途都以服务端记录为准，
  // 回调/查单只按 trade_no 找回来核销。这样即使回调乱序、重放或延迟，
  // 也能保证"金额对得上、只入账一次"，并且随时能对账。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      trade_no VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      account VARCHAR(48) NOT NULL,
      customer_key VARCHAR(80) NOT NULL,
      purpose VARCHAR(16) NOT NULL,
      reference_no VARCHAR(80) NOT NULL DEFAULT '',
      amount_fen BIGINT UNSIGNED NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      transaction_id VARCHAR(64) NULL,
      payload LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      paid_at BIGINT NULL,
      PRIMARY KEY (trade_no),
      INDEX payment_intents_owner_idx (account, customer_key, created_at),
      INDEX payment_intents_reference_idx (account, reference_no),
      CONSTRAINT fk_payment_intents_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash VARCHAR(64) PRIMARY KEY,
      role VARCHAR(20) NOT NULL,
      account VARCHAR(48) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX sessions_expiry_idx (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merchant_customers (
      account VARCHAR(48) NOT NULL,
      customer_key VARCHAR(80) NOT NULL,
      first_login_at BIGINT NOT NULL,
      last_login_at BIGINT NOT NULL,
      PRIMARY KEY (account, customer_key),
      INDEX merchant_customers_recent_idx (account, last_login_at),
      CONSTRAINT fk_merchant_customer_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE,
      CONSTRAINT fk_merchant_customer_customer FOREIGN KEY (customer_key) REFERENCES customers(customer_key) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash VARCHAR(64) PRIMARY KEY,
      customer_key VARCHAR(80) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX customer_sessions_customer_idx (customer_key),
      INDEX customer_sessions_expiry_idx (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_grants (
      account VARCHAR(48) NOT NULL,
      customer_key VARCHAR(80) NOT NULL,
      granted_by VARCHAR(48) NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (account, customer_key),
      CONSTRAINT fk_staff_grants_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 管事邀请码：商户在后台「员工管理 / 管事邀请码」生成，打手在小程序工作台输入兑换。
  // kind = 'steward' 后台发的码 → 兑换后本人升级为管事；
  // kind = 'staff'   管事自己在工作台生成的码 → 兑换后成为该管事名下的下级打手。
  // issuer_key 为空串表示"商户后台发的"，否则是发码管事的 customer_key。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS steward_invite_codes (
      account VARCHAR(48) NOT NULL,
      code VARCHAR(32) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      issuer_key VARCHAR(80) NOT NULL,
      issuer_name VARCHAR(80) NOT NULL,
      status VARCHAR(16) NOT NULL,
      used_by_key VARCHAR(80) NULL,
      used_by_name VARCHAR(80) NULL,
      used_by_numeric VARCHAR(32) NULL,
      created_at BIGINT NOT NULL,
      used_at BIGINT NULL,
      PRIMARY KEY (account, code),
      INDEX steward_invite_codes_issuer_idx (account, issuer_key),
      CONSTRAINT fk_steward_invite_codes_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 管事身份：能进这张表的人就是管事。redeemed_from 记录他是被哪个码升级上来的。
  // 「上级管事」不在这里存 —— 只有一处真源，就是下面的 steward_relations
  // （早先这里有个 superior_key，但代码从来没写过非空值，读取时也永远查不到行）。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stewards (
      account VARCHAR(48) NOT NULL,
      customer_key VARCHAR(80) NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      numeric_id VARCHAR(32) NOT NULL,
      redeemed_from VARCHAR(32) NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (account, customer_key),
      CONSTRAINT fk_stewards_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 上下级关系：下级打手是谁、挂在哪个管事名下。管事"查看下级打手"就是查这张表。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS steward_relations (
      account VARCHAR(48) NOT NULL,
      staff_key VARCHAR(80) NOT NULL,
      steward_key VARCHAR(80) NOT NULL,
      invite_code VARCHAR(32) NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (account, staff_key),
      INDEX steward_relations_steward_idx (account, steward_key),
      CONSTRAINT fk_steward_relations_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 提现单：打手/用户在小程序提交，商户在后台「提现审核」通过或驳回。
  // 手续费**在提交那一刻解算并冻结**（fee_snapshot 存当时的配置），之后商户改配置不影响已发出的单。
  // 钱的落账在 wallet_transactions 里：提交时按 money 扣本人口袋，驳回时再退回同一个口袋。
  // identity 决定「哪个口袋」：staff = 可用佣金（打手结单入账），user = 客户消费余额（提现不扣手续费）。
  // steward_cents / merchant_cents 是手续费的内部分账（管事拿多少 / 商户拿多少，单位「分」），
  // 打手只看 money / fee / actual_money，看不到这两个字段。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdraw_orders (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      order_no VARCHAR(64) NOT NULL,
      identity VARCHAR(8) NOT NULL DEFAULT 'staff',
      staff_key VARCHAR(80) NOT NULL,
      staff_name VARCHAR(80) NOT NULL DEFAULT '',
      staff_numeric VARCHAR(32) NOT NULL DEFAULT '',
      steward_key VARCHAR(80) NOT NULL DEFAULT '',
      channel VARCHAR(16) NOT NULL,
      account_name VARCHAR(80) NOT NULL,
      account_no VARCHAR(120) NOT NULL,
      bank_name VARCHAR(120) NOT NULL DEFAULT '',
      images VARCHAR(500) NOT NULL DEFAULT '',
      money DECIMAL(14,2) NOT NULL,
      fee DECIMAL(14,2) NOT NULL DEFAULT 0.00,
      actual_money DECIMAL(14,2) NOT NULL,
      steward_cents INT UNSIGNED NOT NULL DEFAULT 0,
      merchant_cents INT UNSIGNED NOT NULL DEFAULT 0,
      fee_snapshot VARCHAR(300) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      reject_reason VARCHAR(200) NOT NULL DEFAULT '',
      reviewed_by VARCHAR(48) NULL,
      reviewed_at BIGINT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE KEY withdraw_orders_no_uq (account, order_no),
      INDEX withdraw_orders_staff_idx (account, staff_key, created_at),
      INDEX withdraw_orders_status_idx (account, status, created_at),
      CONSTRAINT fk_withdraw_orders_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 本机已经建过 withdraw_orders 的库要补 identity 这一列（CREATE TABLE IF NOT EXISTS 不会改已有表）。
  const [withdrawColumns] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'withdraw_orders'",
    [databaseName],
  );
  if (withdrawColumns.length && !withdrawColumns.some((row) => row.COLUMN_NAME === "identity")) {
    await pool.query("ALTER TABLE withdraw_orders ADD COLUMN identity VARCHAR(8) NOT NULL DEFAULT 'staff' AFTER order_no");
  }
  // 罚单：商户在后台「功能 / 罚单」开单，打手在小程序端看到并从「可用佣金」里缴纳。
  // status 用**三态数字**（跟资金指标提示词的契约对齐）：0 = 待缴、1 = 已缴、>= 2 一律当"已撤销"。
  // 前端只认两条规则：status === 0 才出「立即缴纳」按钮；其余一律按已缴/已撤销显示。
  // 这里故意不用本项目常见的 VARCHAR 状态 —— 提示词把"3 态 + >=2 兜底"写死在契约里，
  // 以后要加 3 = 申诉中 之类的扩展态，前端一行都不用改。
  // 幂等两层：① 缴纳走 debitStaffWallet(transactionType='fine_payment', referenceNo=fine_no)，
  // 钱包层按 transaction_type + reference_no 去重；② 这里的 status 用 `WHERE status = 0` 原子更新，
  // 并发重复点只可能有一条成功。
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_fines (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      account VARCHAR(48) NOT NULL,
      fine_no VARCHAR(64) NOT NULL,
      staff_key VARCHAR(80) NOT NULL,
      staff_name VARCHAR(80) NOT NULL DEFAULT '',
      staff_numeric VARCHAR(32) NOT NULL DEFAULT '',
      amount DECIMAL(14,2) NOT NULL,
      reason VARCHAR(200) NOT NULL DEFAULT '',
      punish_text VARCHAR(200) NOT NULL DEFAULT '',
      order_no VARCHAR(64) NOT NULL DEFAULT '',
      status TINYINT UNSIGNED NOT NULL DEFAULT 0,
      fine_time BIGINT NOT NULL,
      pay_time BIGINT NULL,
      revoke_reason VARCHAR(200) NOT NULL DEFAULT '',
      created_by VARCHAR(48) NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      UNIQUE KEY staff_fines_no_uq (account, fine_no),
      INDEX staff_fines_staff_idx (account, staff_key, status, created_at),
      INDEX staff_fines_status_idx (account, status, created_at),
      CONSTRAINT fk_staff_fines_merchant FOREIGN KEY (account) REFERENCES merchants(account) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // 老库把 stewards.superior_key（连同它那条索引）摘掉。不摘的话，新代码的 INSERT 不再给这列
  // 赋值，而它是 NOT NULL 无默认值 —— 直接报错。新库建表时已经没有这列，所以要先查再加条件。
  const [stewardColumns] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'stewards'",
    [databaseName],
  );
  if (stewardColumns.some((row) => row.COLUMN_NAME === "superior_key")) {
    const [stewardIndexes] = await pool.query(
      "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'stewards' AND INDEX_NAME = 'stewards_superior_idx'",
      [databaseName],
    );
    if (stewardIndexes.length) await pool.query("ALTER TABLE stewards DROP INDEX stewards_superior_idx");
    await pool.query("ALTER TABLE stewards DROP COLUMN superior_key");
  }
  const [customerColumns] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers'",
    [databaseName],
  );
  const customerColumnNames = new Set(customerColumns.map((row) => row.COLUMN_NAME));
  if (!customerColumnNames.has("openid")) {
    await pool.query("ALTER TABLE customers ADD COLUMN openid VARCHAR(64) NULL AFTER customer_key");
    await pool.query("CREATE UNIQUE INDEX customers_openid_uq ON customers (openid)");
  }

  return pool;
}

function getPool() {
  if (!pool) throw new Error("数据库尚未初始化");
  return pool;
}

async function closeDatabase() {
  if (!pool) return;
  const activePool = pool;
  pool = null;
  await activePool.end();
}

module.exports = {
  closeDatabase,
  databaseName,
  getPool,
  initializeDatabase,
};
