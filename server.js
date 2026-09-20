"use strict";

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { closeDatabase, databaseName, getPool, initializeDatabase } = require("./database");
const { runtimeErrors, strongPassword, productionRouteBlock, publicFileTarget } = require("./security");
const { WalletCreditError, normalizeCredit, applyCredit } = require("./wallet-credit");
const wechatPay = require("./wechat-pay");
const { PAYMENT_WINDOW_MS, advanceOrder, displayStatus } = require("./order-flow");
// 算钱（提现手续费的继承/覆盖/封顶、打手分成）只有 shared.js 一份 —— 服务端也用同一份，
// 避免"前端算一遍、服务端再算一遍"两边分叉。shared.js 末尾有 typeof module 守卫，浏览器里是空操作。
const shared = require("./shared");

const root = path.resolve(__dirname);
const legacyDataFile = path.join(root, "data-store.json");
const merchantAssetRoot = path.join(root, "data", "merchant-assets");
const port = Number(process.env.PORT || 5180);
const host = process.env.HOST || "127.0.0.1";
const isProduction = process.env.NODE_ENV === "production";
const allowPublicTrade = process.env.ALLOW_PUBLIC_TRADE === "true";
// 页面批注（开发协作工具）：生产环境默认关闭，需显式 ENABLE_ANNOTATIONS=true 才开放
const annotationFile = path.join(root, "data", "dev-annotations.json");
// 批注收件箱：页面上点「发送给 AI」后，这一批批注会作为一条投递记录落在这里，AI 读它来动手改代码
const annotationInboxFile = path.join(root, "data", "dev-annotations.inbox.json");
const annotationsEnabled = !isProduction || process.env.ENABLE_ANNOTATIONS === "true";
const wxAppId = String(process.env.WX_APPID || "").trim();
const wxSecret = String(process.env.WX_SECRET || "").trim();
const customerSessionTtl = Math.max(24 * 60 * 60 * 1000, Number(process.env.CUSTOMER_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000));
const sessionTtl = Math.max(60 * 60 * 1000, Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000));
const maxBodyBytes = Math.max(1024 * 1024, Number(process.env.MAX_BODY_BYTES || 24 * 1024 * 1024));
const maxArrayItems = 500;
const maxImageAssetBytes = 8 * 1024 * 1024;
const loginAttempts = new Map();
const publicLoginAttempts = new Map();

// Periodically drop expired rate-limit entries so the maps cannot grow forever.
const rateLimitSweeper = setInterval(() => {
  const timestamp = now();
  for (const [key, state] of loginAttempts) if (state.resetAt < timestamp) loginAttempts.delete(key);
  for (const [key, state] of publicLoginAttempts) if (state.resetAt < timestamp) publicLoginAttempts.delete(key);
}, 10 * 60 * 1000);
rateLimitSweeper.unref();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function now() {
  return Date.now();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const digest = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${digest}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return actual.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function jsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isSafeAccount(value) {
  return /^[A-Za-z0-9_-]{3,48}$/.test(String(value || ""));
}

function imageAssetFromDataUrl(source) {
  const match = String(source || "").match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw new Error("仅支持 PNG、JPG 或 WEBP 图片");
  const extension = match[1].toLowerCase().replace("jpeg", "jpg");
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length || buffer.length > maxImageAssetBytes) throw new Error("图片大小无效或超过 8 MB");
  const signatures = {
    jpg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
    png: buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    webp: buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  };
  if (!signatures[extension]) throw new Error("图片内容与格式不匹配");
  return { buffer, extension };
}

async function saveMerchantHeroAsset(account, source, originalName = "") {
  if (!isSafeAccount(account)) throw new Error("商户账号无效");
  const { buffer, extension } = imageAssetFromDataUrl(source);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const directory = path.join(merchantAssetRoot, account);
  const fileName = `hero-${digest}.${extension}`;
  const target = path.join(directory, fileName);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(target, buffer);
  const relativePath = path.relative(root, target).split(path.sep).join("/");
  return {
    url: `/${relativePath}`,
    path: relativePath,
    fileName: path.basename(String(originalName || `轮播图片.${extension}`)).slice(0, 160),
  };
}

async function saveMerchantProductAsset(account, productId, source, originalName = "") {
  if (!isSafeAccount(account)) throw new Error("商户账号无效");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(productId || ""))) throw new Error("商品标识无效");
  const { buffer, extension } = imageAssetFromDataUrl(source);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const directory = path.join(merchantAssetRoot, account, "products");
  const fileName = `product-${productId}-${digest}.${extension}`;
  const target = path.join(directory, fileName);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(target, buffer);
  const relativePath = path.relative(root, target).split(path.sep).join("/");
  return {
    url: `/${relativePath}`,
    path: relativePath,
    fileName: path.basename(String(originalName || `商品图片.${extension}`)).slice(0, 160),
  };
}

async function saveMerchantLotteryPrizeAsset(account, prizeId, source, originalName = "") {
  if (!isSafeAccount(account)) throw new Error("商户账号无效");
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(prizeId || ""))) throw new Error("奖品标识无效");
  const { buffer, extension } = imageAssetFromDataUrl(source);
  const digest = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const directory = path.join(merchantAssetRoot, account, "lottery-prizes");
  const fileName = `prize-${prizeId}-${digest}.${extension}`;
  const target = path.join(directory, fileName);
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(target, buffer);
  const relativePath = path.relative(root, target).split(path.sep).join("/");
  return {
    url: `/${relativePath}`,
    path: relativePath,
    fileName: path.basename(String(originalName || `奖品图片.${extension}`)).slice(0, 160),
  };
}

function isSafeCustomerId(value) {
  return /^[A-Za-z0-9_-]{20,80}$/.test(String(value || ""));
}

function isSafeOrderNo(value) {
  return /^[A-Za-z0-9_-]{3,64}$/.test(String(value || ""));
}

function customerIdentity(row) {
  return {
    customerId: String(row.customer_key),
    numericId: String(row.numeric_id),
    displayName: String(row.display_name),
  };
}

async function findCustomerByOpenid(openid, executor = getPool()) {
  const [rows] = await executor.execute(
    "SELECT customer_key, numeric_id, display_name FROM customers WHERE openid = ?",
    [openid],
  );
  return rows[0] ? customerIdentity(rows[0]) : null;
}

// A device-provided legacy ID is not proof of ownership. Keep old records separate
// until an authenticated, audited migration workflow is available.
async function ensureCustomerByOpenid(openid, executor = getPool()) {
  const existing = await findCustomerByOpenid(openid, executor);
  if (existing) return existing;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const customerKey = `wxo_${crypto.randomBytes(24).toString("hex")}`;
    const numericId = crypto.randomInt(100000000, 1000000000);
    const displayName = defaultCustomerName(numericId);
    const timestamp = now();
    try {
      const [result] = await executor.execute(
        "INSERT INTO customers (customer_key, openid, numeric_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        [customerKey, openid, numericId, displayName, timestamp, timestamp],
      );
      if (result.affectedRows) return { customerId: customerKey, numericId: String(numericId), displayName };
    } catch (error) {
      if (error && error.code !== "ER_DUP_ENTRY") throw error;
    }
    const created = await findCustomerByOpenid(openid, executor);
    if (created) return created;
  }
  throw new Error("生成用户身份失败，请稍后重试");
}

async function issueCustomerSession(customerKey, executor = null) {
  const token = crypto.randomBytes(32).toString("hex");
  const timestamp = now();
  const run = executor || getPool();
  await run.execute("DELETE FROM customer_sessions WHERE expires_at <= ?", [timestamp]);
  await run.execute(
    "INSERT INTO customer_sessions (token_hash, customer_key, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [tokenHash(token), customerKey, timestamp + customerSessionTtl, timestamp],
  );
  return token;
}

async function getCustomerSession(req) {
  const header = String(req.headers["x-customer-token"] || req.headers.authorization || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = tokenHash(token);
  const [rows] = await getPool().execute(
    "SELECT customer_key, expires_at FROM customer_sessions WHERE token_hash = ? AND expires_at > ?",
    [hash, now()],
  );
  if (!rows[0]) {
    await getPool().execute("DELETE FROM customer_sessions WHERE token_hash = ?", [hash]);
    return null;
  }
  return { customerId: String(rows[0].customer_key), tokenHash: hash };
}

async function hasStaffGrant(account, customerKey, executor = getPool()) {
  const [rows] = await executor.execute(
    "SELECT 1 FROM staff_grants WHERE account = ? AND customer_key = ?",
    [account, customerKey],
  );
  return Boolean(rows[0]);
}

// —— 管事 / 管事邀请码 ——
// 码表里的 status 有四种含义，别混：
//   active   管事的「我的邀请码」，长期有效、可反复拉人（不消耗）
//   unused   一次性码：后台发的升级码、管事临时生成的拉人码
//   used     已被兑换的一次性码
//   disabled 被后台停用
// 码去掉容易看错的 0/O/1/I，方便口头发给打手。
const STEWARD_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function newStewardCode() {
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += STEWARD_CODE_ALPHABET[crypto.randomInt(STEWARD_CODE_ALPHABET.length)];
  }
  return code;
}

function stewardCodeView(row) {
  return {
    code: String(row.code),
    kind: String(row.kind) === "steward" ? "steward" : "staff",
    issuerKey: String(row.issuer_key || ""),
    status: String(row.status || "unused"),
    usedByName: String(row.used_by_name || ""),
    usedByNumeric: String(row.used_by_numeric || ""),
    usedAt: row.used_at == null ? 0 : Number(row.used_at),
    createdAt: Number(row.created_at || 0),
  };
}

async function listStewardCodes(account) {
  const [rows] = await getPool().execute(
    "SELECT * FROM steward_invite_codes WHERE account = ? ORDER BY created_at DESC",
    [account],
  );
  return rows.map(stewardCodeView);
}

// 同一商户内 code 唯一；撞码就重摇（8 位 32 进制，实际几乎不会撞）。
async function createStewardCode({ account, kind, status = "unused", issuerKey = "", issuerName = "", executor = null }) {
  const run = executor || getPool();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = newStewardCode();
    try {
      await run.execute(
        "INSERT INTO steward_invite_codes (account, code, kind, issuer_key, issuer_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [account, code, kind, issuerKey, issuerName, status, now()],
      );
      return code;
    } catch (error) {
      if (error && error.code === "ER_DUP_ENTRY") continue;
      throw error;
    }
  }
  throw new Error("邀请码生成失败，请重试");
}

// 兑换邀请码。整个流程放在一个事务里并把码行锁住（FOR UPDATE），
// 避免同一张一次性码被两个人同时兑换、或者一次兑换只写了一半。
async function redeemStewardCode({ account, code, customer }) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,32}$/.test(normalized)) {
    return { ok: false, message: "邀请码格式不对，请核对后重试" };
  }
  return runTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT * FROM steward_invite_codes WHERE account = ? AND code = ? FOR UPDATE",
      [account, normalized],
    );
    const row = rows[0];
    if (!row) return { ok: false, message: "邀请码不存在，请核对后重试" };
    if (row.status === "disabled") return { ok: false, message: "这个邀请码已被停用" };
    if (row.status === "used") return { ok: false, message: "这个邀请码已经被使用过了" };
    const consumed = row.status === "unused";
    const kind = String(row.kind) === "steward" ? "steward" : "staff";
    const displayName = String(customer.displayName || "");
    const numericId = String(customer.numericId || "");
    const timestamp = now();

    if (kind === "steward") {
      const [existing] = await connection.execute(
        "SELECT 1 FROM stewards WHERE account = ? AND customer_key = ?",
        [account, customer.customerId],
      );
      if (existing[0]) return { ok: false, message: "你已经是管事了，不需要再兑换" };
      await connection.execute(
        "INSERT INTO stewards (account, customer_key, display_name, numeric_id, redeemed_from, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [account, customer.customerId, displayName, numericId, normalized, timestamp],
      );
      // 管事到手就是一张长期有效的「我的邀请码」，不用再去点生成。
      await createStewardCode({
        account, kind: "staff", status: "active",
        issuerKey: customer.customerId, issuerName: displayName, executor: connection,
      });
    } else {
      const stewardKey = String(row.issuer_key || "");
      if (!stewardKey) return { ok: false, message: "这张邀请码的来源已失效，请联系商户" };
      if (stewardKey === customer.customerId) return { ok: false, message: "不能用自己的邀请码加入自己的下级" };
      await connection.execute(
        "INSERT INTO steward_relations (account, staff_key, steward_key, invite_code, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE steward_key = VALUES(steward_key), invite_code = VALUES(invite_code)",
        [account, customer.customerId, stewardKey, normalized, timestamp],
      );
    }

    // 兑换管事码的人也要能进工作台，所以顺手把打手权限补上（幂等）。
    await connection.execute(
      "INSERT IGNORE INTO staff_grants (account, customer_key, granted_by, created_at) VALUES (?, ?, ?, ?)",
      [account, customer.customerId, `code:${normalized}`, timestamp],
    );
    if (consumed) {
      await connection.execute(
        "UPDATE steward_invite_codes SET status = 'used', used_by_key = ?, used_by_name = ?, used_by_numeric = ?, used_at = ? WHERE account = ? AND code = ?",
        [customer.customerId, displayName, numericId, timestamp, account, normalized],
      );
    }
    return { ok: true, kind };
  });
}

// 小程序侧要看到的管事全貌：我是不是管事、我的码、我的上级、我的下级打手。
// 上级只有一处真源：steward_relations（谁用了谁的邀请码加入的）；stewards 表不另存上级。
async function stewardOverview(account, customer) {
  const pool = getPool();
  const [stewardRows] = await pool.execute(
    "SELECT * FROM stewards WHERE account = ? AND customer_key = ?",
    [account, customer.customerId],
  );
  const steward = stewardRows[0];
  const [relations] = await pool.execute(
    "SELECT s.display_name AS stewardName, s.numeric_id AS stewardNumeric FROM steward_relations r LEFT JOIN stewards s ON s.account = r.account AND s.customer_key = r.steward_key WHERE r.account = ? AND r.staff_key = ?",
    [account, customer.customerId],
  );
  const superior = relations[0]
    ? { displayName: String(relations[0].stewardName || ""), numericId: String(relations[0].stewardNumeric || "") }
    : null;
  if (!steward) return { isSteward: false, myCode: "", superior, subordinates: [] };
  const [subordinateRows] = await pool.execute(
    "SELECT r.invite_code AS inviteCode, c.display_name AS displayName, c.numeric_id AS numericId FROM steward_relations r LEFT JOIN customers c ON c.customer_key = r.staff_key WHERE r.account = ? AND r.steward_key = ? ORDER BY r.created_at DESC",
    [account, customer.customerId],
  );
  const [codeRows] = await pool.execute(
    "SELECT * FROM steward_invite_codes WHERE account = ? AND issuer_key = ? ORDER BY created_at DESC",
    [account, customer.customerId],
  );
  return {
    isSteward: true,
    myCode: String(codeRows.find((row) => row.status === "active")?.code || ""),
    superior,
    subordinates: subordinateRows.map((row) => ({
      displayName: String(row.displayName || "未知用户"),
      numericId: row.numericId == null ? "" : String(row.numericId),
      code: String(row.inviteCode || ""),
    })),
  };
}

// The numeric ID is the only user identifier shown anywhere (miniprogram, merchant
// console, order broadcasts), so the placeholder nickname is derived from it as well
// instead of random letters. Customers overwrite it themselves in the miniprogram.
function defaultCustomerName(numericId) {
  return `用户${String(numericId).slice(-6)}`;
}

const displayNameMaxLength = 16;

// Nicknames are display-only but `customers.display_name` carries a UNIQUE index, so two
// customers cannot share one; the numeric ID stays the unchangeable handle.
function normalizeDisplayName(raw) {
  const value = String(raw == null ? "" : raw)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return { ok: false, message: "昵称不能为空" };
  if (value.includes("<") || value.includes(">")) return { ok: false, message: "昵称不能包含 < 或 >" };
  if ([...value].length > displayNameMaxLength) return { ok: false, message: `昵称最多 ${displayNameMaxLength} 个字` };
  return { ok: true, value };
}

class DisplayNameTakenError extends Error {
  constructor(displayName) {
    super(`昵称「${displayName}」已经被别人用了，换一个试试`);
    this.name = "DisplayNameTakenError";
    this.status = 409;
  }
}

async function updateCustomerDisplayName(customerKey, displayName, executor = getPool()) {
  try {
    await executor.execute(
      "UPDATE customers SET display_name = ?, updated_at = ? WHERE customer_key = ?",
      [displayName, now(), customerKey],
    );
  } catch (error) {
    if (error && error.code === "ER_DUP_ENTRY") throw new DisplayNameTakenError(displayName);
    throw error;
  }
  // Mirror the new nickname onto existing balance rows so the merchant console shows it
  // immediately (staff wallets are keyed by the same customer_key). The ledger also joins
  // `customers`, so this is belt-and-braces rather than the only source of truth.
  await executor.execute(
    "UPDATE wallet_accounts SET display_name = ? WHERE owner_id = ?",
    [displayName, customerKey],
  );
  return displayName;
}

async function ensureCustomerIdentity(customerId, executor = getPool()) {
  const customerKey = String(customerId || "");
  if (!isSafeCustomerId(customerKey)) throw new Error("用户登录标识无效，请重新进入小程序");
  const [existing] = await executor.execute(
    "SELECT customer_key, numeric_id, display_name FROM customers WHERE customer_key = ?",
    [customerKey],
  );
  if (existing[0]) return customerIdentity(existing[0]);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const numericId = crypto.randomInt(100000000, 1000000000);
    const displayName = defaultCustomerName(numericId);
    const timestamp = now();
    const [result] = await executor.execute(
      "INSERT IGNORE INTO customers (customer_key, numeric_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [customerKey, numericId, displayName, timestamp, timestamp],
    );
    if (result.affectedRows) {
      return { customerId: customerKey, numericId: String(numericId), displayName };
    }
    const [created] = await executor.execute(
      "SELECT customer_key, numeric_id, display_name FROM customers WHERE customer_key = ?",
      [customerKey],
    );
    if (created[0]) return customerIdentity(created[0]);
  }
  throw new Error("生成用户身份失败，请稍后重试");
}

async function runTransaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function setMetadata(key, value, executor = getPool()) {
  await executor.execute(
    "INSERT INTO metadata (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)",
    [key, String(value)],
  );
}

async function ensureOwnerAccount() {
  const account = String(process.env.ADMIN_ACCOUNT || "admin").trim();
  const suppliedPassword = String(process.env.ADMIN_PASSWORD || "");
  if (isProduction && !suppliedPassword) throw new Error("生产环境首次启动必须设置 ADMIN_PASSWORD");
  const [rows] = await getPool().execute("SELECT account, password_hash FROM admins WHERE account = ?", [account]);
  const existing = rows[0];
  if (existing) {
    if (suppliedPassword && !verifyPassword(suppliedPassword, existing.password_hash)) {
      await runTransaction(async (connection) => {
        await connection.execute("UPDATE admins SET password_hash = ?, updated_at = ? WHERE account = ?", [hashPassword(suppliedPassword), now(), account]);
        await connection.execute("DELETE FROM sessions WHERE role = 'owner' AND account = ?", [account]);
      });
    }
    return;
  }
  const timestamp = now();
  await getPool().execute(
    "INSERT INTO admins (account, display_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
    [account, "总管理员", hashPassword(suppliedPassword || "admin123"), timestamp, timestamp],
  );
}

async function ensureMerchantExists(account, executor = getPool()) {
  const [rows] = await executor.execute("SELECT account FROM merchants WHERE account = ?", [account]);
  if (rows[0]) return;
  const timestamp = now();
  await executor.execute(
    "INSERT INTO merchants (account, club_name, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)",
    [account, "未命名俱乐部", hashPassword("123456"), timestamp, timestamp],
  );
}

async function seedLegacyStoreWhenEmpty() {
  if (isProduction || (process.env.SEED_LEGACY_DATA !== "true" && process.env.SEED_DEMO_DATA !== "true")) return;
  const [[countRow]] = await getPool().query("SELECT COUNT(*) AS count FROM merchants");
  if (Number(countRow.count) > 0 || !fs.existsSync(legacyDataFile)) return;
  const legacy = jsonParse(fs.readFileSync(legacyDataFile, "utf8"), null);
  if (!legacy || typeof legacy !== "object") throw new Error("初始数据文件无法读取，请检查 data-store.json");

  await runTransaction(async (connection) => {
    const timestamp = now();
    for (const merchant of Array.isArray(legacy.merchants) ? legacy.merchants : []) {
      const account = String(merchant?.account || "").trim();
      if (!isSafeAccount(account)) continue;
      await connection.execute(
        `INSERT INTO merchants (account, club_name, password_hash, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)
         ON DUPLICATE KEY UPDATE club_name = VALUES(club_name), password_hash = VALUES(password_hash), status = 'active', updated_at = VALUES(updated_at)`,
        [account, String(merchant.clubName || "未命名俱乐部").slice(0, 80), merchant.passwordHash || hashPassword(merchant.password || "123456"), timestamp, timestamp],
      );
    }
    for (const [account, config] of Object.entries(legacy.configs || {})) {
      if (!isSafeAccount(account)) continue;
      await ensureMerchantExists(account, connection);
      await connection.execute(
        `INSERT INTO configs (account, payload, version, updated_at) VALUES (?, ?, 1, ?)
         ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`,
        [account, JSON.stringify(normalizeStoredConfig(config || {})), timestamp],
      );
    }
    for (const [account, items] of Object.entries(legacy.orders || {})) {
      if (!isSafeAccount(account) || !Array.isArray(items)) continue;
      await ensureMerchantExists(account, connection);
      for (const [index, item] of items.slice(0, maxArrayItems).entries()) {
        await connection.execute(
          "INSERT INTO orders (account, order_no, customer_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
          [account, String(item?.no || `DD${timestamp}${index}`), isSafeCustomerId(item?.customerId) ? item.customerId : null, JSON.stringify(item || {}), timestamp - index],
        );
      }
    }
    for (const [account, items] of Object.entries(legacy.logs || {})) {
      if (!isSafeAccount(account) || !Array.isArray(items)) continue;
      await ensureMerchantExists(account, connection);
      for (const [index, item] of items.slice(0, maxArrayItems).entries()) {
        await connection.execute(
          "INSERT INTO logs (account, payload, created_at) VALUES (?, ?, ?)",
          [account, JSON.stringify(item || {}), timestamp - index],
        );
      }
    }
    await setMetadata("legacy_json_seeded", new Date().toISOString(), connection);
  });
}

function setSecurityHeaders(res, type = "application/json; charset=utf-8") {
  res.setHeader("Content-Type", type);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
}

function sendJson(res, data, status = 200) {
  setSecurityHeaders(res);
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

function parseCookies(req) {
  const entries = (req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim().split("="))
    .filter(([key]) => key)
    .map(([key, value]) => [key, decodeURIComponent(value || "")]);
  return Object.fromEntries(entries);
}

function cookieOptions(maxAgeSeconds) {
  return ["HttpOnly", "SameSite=Strict", "Path=/", `Max-Age=${maxAgeSeconds}`, ...(isProduction ? ["Secure"] : [])].join("; ");
}

async function getSession(req) {
  const token = parseCookies(req).club_session;
  if (!token) return null;
  const hash = tokenHash(token);
  const [rows] = await getPool().execute(
    "SELECT role, account, expires_at AS expiresAt FROM sessions WHERE token_hash = ? AND expires_at > ?",
    [hash, now()],
  );
  if (!rows[0]) {
    await getPool().execute("DELETE FROM sessions WHERE token_hash = ?", [hash]);
    return null;
  }
  const table = rows[0].role === "owner" ? "admins" : rows[0].role === "merchant" ? "merchants" : null;
  if (!table) return null;
  const [active] = await getPool().execute(`SELECT account FROM ${table} WHERE account = ? AND status = 'active'`, [rows[0].account]);
  if (!active[0]) {
    await getPool().execute("DELETE FROM sessions WHERE token_hash = ?", [hash]);
    return null;
  }
  return { ...rows[0], tokenHash: hash };
}

async function createSession(res, role, account) {
  const token = crypto.randomBytes(32).toString("hex");
  const timestamp = now();
  await runTransaction(async (connection) => {
    await connection.execute("DELETE FROM sessions WHERE expires_at <= ?", [timestamp]);
    await connection.execute(
      "INSERT INTO sessions (token_hash, role, account, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      [tokenHash(token), role, account, timestamp + sessionTtl, timestamp],
    );
  });
  res.setHeader("Set-Cookie", `club_session=${token}; ${cookieOptions(Math.floor(sessionTtl / 1000))}`);
}

async function clearSession(req, res) {
  const token = parseCookies(req).club_session;
  if (token) await getPool().execute("DELETE FROM sessions WHERE token_hash = ?", [tokenHash(token)]);
  res.setHeader("Set-Cookie", `club_session=; ${cookieOptions(0)}`);
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    if (isProduction) return new URL(origin).origin === new URL(process.env.PUBLIC_ORIGIN).origin;
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function canAccess(session, account) {
  return session && (session.role === "owner" || (session.role === "merchant" && session.account === account));
}

function isSafePayload(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBodyBytes;
}

function hasUnsafeContent(value, depth = 0) {
  if (depth > 16) return true;
  if (typeof value === "string") {
    return Buffer.byteLength(value, "utf8") > 8 * 1024 * 1024
      || /<\s*script/i.test(value)
      || /javascript\s*:/i.test(value)
      || /\son\w+\s*=/i.test(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return false;
  if (Array.isArray(value)) return value.length > maxArrayItems || value.some((item) => hasUnsafeContent(item, depth + 1));
  if (!value || typeof value !== "object") return true;
  return Object.entries(value).some(([key, item]) => ["__proto__", "constructor", "prototype"].includes(key) || hasUnsafeContent(item, depth + 1));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("请求格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function rateLimited(req) {
  const ip = req.socket.remoteAddress || "unknown";
  const timestamp = now();
  const state = loginAttempts.get(ip) || { count: 0, resetAt: timestamp + 10 * 60 * 1000 };
  if (state.resetAt < timestamp) {
    state.count = 0;
    state.resetAt = timestamp + 10 * 60 * 1000;
  }
  state.count += 1;
  loginAttempts.set(ip, state);
  return state.count > 10;
}

function resetRateLimit(req) {
  loginAttempts.delete(req.socket.remoteAddress || "unknown");
}

// Separate, tighter bucket for the miniprogram login endpoint (jscode2session costs a WeChat API call).
function publicLoginRateLimited(req) {
  const ip = req.socket.remoteAddress || "unknown";
  const timestamp = now();
  const state = publicLoginAttempts.get(ip) || { count: 0, resetAt: timestamp + 60 * 1000 };
  if (state.resetAt < timestamp) {
    state.count = 0;
    state.resetAt = timestamp + 60 * 1000;
  }
  state.count += 1;
  publicLoginAttempts.set(ip, state);
  return state.count > 30;
}

function exchangeWechatCode(code) {
  return new Promise((resolve, reject) => {
    if (!wxAppId || !wxSecret) return reject(new Error("服务器未配置微信登录"));
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(code || ""))) return reject(new Error("微信登录凭证无效"));
    const query = new URLSearchParams({
      appid: wxAppId,
      secret: wxSecret,
      js_code: String(code),
      grant_type: "authorization_code",
    });
    const request = https.get(`https://api.weixin.qq.com/sns/jscode2session?${query}`, { timeout: 8000 }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 64 * 1024) request.destroy(new Error("微信登录响应过大"));
      });
      response.on("end", () => {
        const payload = jsonParse(raw, null);
        if (!payload || typeof payload !== "object") return reject(new Error("微信登录服务响应异常"));
        if (payload.errcode) return reject(new Error(`微信登录失败（${payload.errcode}）`));
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(payload.openid || ""))) return reject(new Error("微信登录返回的身份无效"));
        resolve(String(payload.openid));
      });
    });
    request.on("timeout", () => request.destroy(new Error("微信登录服务超时")));
    request.on("error", (error) => reject(error instanceof Error ? error : new Error("微信登录服务不可用")));
  });
}

function publicMerchant(row) {
  return { account: row.account, clubName: row.club_name || row.clubName };
}

async function getActiveMerchants() {
  const [rows] = await getPool().query("SELECT account, club_name FROM merchants WHERE status = 'active' ORDER BY created_at ASC");
  return rows;
}

function isQuestionPlaceholder(value) {
  return typeof value === "string" && /^[?\uFFFD]+$/.test(value.trim());
}

function normalizeLotteryPools(source) {
  if (!Array.isArray(source)) return [];
  return source.slice(0, 50).map((pool, poolIndex) => {
    const prizes = Array.isArray(pool?.prizes) ? pool.prizes : [];
    return {
      id: String(pool?.id || `pool_${poolIndex + 1}`).slice(0, 80),
      name: String(pool?.name || `奖池 ${poolIndex + 1}`).trim().slice(0, 80),
      enabled: pool?.enabled !== false,
      prizes: prizes.slice(0, 100).map((prize, prizeIndex) => ({
        id: String(prize?.id || `prize_${prizeIndex + 1}`).slice(0, 80),
        name: String(prize?.name || "").trim().slice(0, 120),
        weight: Math.max(0.01, Math.min(1000000, Number(prize?.weight || 1))),
        productIds: Array.from(new Set((Array.isArray(prize?.productIds) ? prize.productIds : []).map((id) => String(id).slice(0, 80)))).slice(0, 500),
        imageUrl: String(prize?.imageUrl || "").slice(0, 500),
        imageName: String(prize?.imageName || "").slice(0, 160),
        imagePath: String(prize?.imagePath || "").slice(0, 500),
      })).filter((prize) => prize.name),
    };
  }).filter((pool) => pool.name && pool.prizes.length);
}

function normalizeStoredConfig(input) {
  const config = input && typeof input === "object" && !Array.isArray(input) ? { ...input } : {};
  shared.cleanObsoleteHomeConfig(config);
  if (config.activityFeatures && typeof config.activityFeatures === "object" && !Array.isArray(config.activityFeatures)) {
    config.activityFeatures = Object.fromEntries(
      Object.entries(config.activityFeatures).filter(([key]) => !isQuestionPlaceholder(key)),
    );
  }
  if (config.quickActions && typeof config.quickActions === "object" && !Array.isArray(config.quickActions)) {
    config.quickActions = Object.fromEntries(Object.entries(config.quickActions).map(([key, item]) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [key, item];
      return [key, {
        ...item,
        icon: isQuestionPlaceholder(item.icon) ? "客" : item.icon,
      }];
    }));
  }
  if (Object.prototype.hasOwnProperty.call(config, "productsPerRow")) {
    // Same 1-4 range enforced by the admin UI and the mini program,
    // so "what the merchant configured" is exactly what every client renders.
    config.productsPerRow = Math.min(4, Math.max(1, Math.floor(Number(config.productsPerRow || 1))));
  }
  config.staffBondRequirement = shared.staffBondRequirementValue(config.staffBondRequirement) ?? 0;
  config.lotteryPools = normalizeLotteryPools(config.lotteryPools);
  // 详情图飘屏在改成「客户真实评价」之后，这块商户手填文案就没有任何消费方了，
  // 但存量配置里还留着那批假文案（"苏老板刚购买新人体验单""陈老板评价：客服安排很快"……）。
  // 在这里统一抹掉：读出来就干净，repairStoredConfigs() 会在启动时把清理后的 payload 写回库里，
  // 旧备份/旧种子文件再被导入也不会让假评价复活。
  delete config.detailFloatTexts;
  // 分销管理那套编出来的分销名单（distributors）也一样：前端早没有消费方了，
  // 存量配置里却还挂着「陪玩A 抽 8%、totalWithdraw 2600」这种假人假账。
  // 必须在**这里**删（而不是只在后台保存时删）：后台要等商户点保存才跑，
  // 而公开配置接口每次读都会路过这个函数 —— 不然旧数据会一直发给小程序。
  delete config.distributors;
  return config;
}

async function repairStoredConfigs() {
  const [rows] = await getPool().query("SELECT account, payload FROM configs");
  for (const row of rows) {
    const current = jsonParse(row.payload, {});
    let migrated = current;
    if (/^data:image\//i.test(String(current.heroImageUrl || ""))) {
      const asset = await saveMerchantHeroAsset(row.account, current.heroImageUrl, current.heroImageName);
      migrated = {
        ...current,
        heroImageUrl: asset.url,
        heroImagePath: asset.path,
        heroImageName: asset.fileName,
      };
    } else if (/^\/data\/merchant-assets\//.test(String(current.heroImageUrl || "")) && !current.heroImagePath) {
      migrated = { ...current, heroImagePath: String(current.heroImageUrl).replace(/^\//, "") };
    }
    if (Array.isArray(migrated.products)) {
      const products = [];
      for (const product of migrated.products) {
        let nextProduct = { ...product };
        if (/^data:image\//i.test(String(nextProduct.imageUrl || ""))) {
          const asset = await saveMerchantProductAsset(row.account, nextProduct.id, nextProduct.imageUrl, nextProduct.imageName);
          nextProduct = { ...nextProduct, imageUrl: asset.url, imagePath: asset.path, imageName: asset.fileName };
        } else if (/^\/data\/merchant-assets\//.test(String(nextProduct.imageUrl || "")) && !nextProduct.imagePath) {
          nextProduct = { ...nextProduct, imagePath: String(nextProduct.imageUrl).replace(/^\//, "") };
        }
        products.push(nextProduct);
      }
      migrated = { ...migrated, products };
      if (migrated.product?.id) {
        const activeProduct = products.find((product) => product.id === migrated.product.id);
        if (activeProduct) migrated.product = { ...activeProduct };
      }
    }
    if (Array.isArray(migrated.lotteryPools)) {
      const lotteryPools = [];
      for (const pool of migrated.lotteryPools) {
        const prizes = [];
        for (const prize of Array.isArray(pool?.prizes) ? pool.prizes : []) {
          let nextPrize = { ...prize };
          if (/^data:image\//i.test(String(nextPrize.imageUrl || ""))) {
            const asset = await saveMerchantLotteryPrizeAsset(row.account, nextPrize.id, nextPrize.imageUrl, nextPrize.imageName);
            nextPrize = { ...nextPrize, imageUrl: asset.url, imagePath: asset.path, imageName: asset.fileName };
          } else if (/^\/data\/merchant-assets\//.test(String(nextPrize.imageUrl || "")) && !nextPrize.imagePath) {
            nextPrize = { ...nextPrize, imagePath: String(nextPrize.imageUrl).replace(/^\//, "") };
          }
          prizes.push(nextPrize);
        }
        lotteryPools.push({ ...pool, prizes });
      }
      migrated = { ...migrated, lotteryPools };
    }
    const normalized = normalizeStoredConfig(migrated);
    const nextPayload = JSON.stringify(normalized);
    if (nextPayload !== JSON.stringify(current)) {
      await getPool().execute(
        "UPDATE configs SET payload = ?, version = version + 1, updated_at = ? WHERE account = ?",
        [nextPayload, now(), row.account],
      );
    }
  }
}

async function getConfig(account, executor = getPool()) {
  const [rows] = await executor.execute("SELECT payload FROM configs WHERE account = ?", [account]);
  return rows[0] ? normalizeStoredConfig(jsonParse(rows[0].payload, {})) : null;
}

async function saveConfig(account, config) {
  const timestamp = now();
  const normalized = normalizeStoredConfig(config);
  await getPool().execute(
    `INSERT INTO configs (account, payload, version, updated_at) VALUES (?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), version = version + 1, updated_at = VALUES(updated_at)`,
    [account, JSON.stringify(normalized), timestamp],
  );
  return timestamp;
}

async function getOrders(account, executor = getPool()) {
  await expireUnpaidOrders(account, executor);
  const [rows] = await executor.execute(
    `SELECT payload FROM orders WHERE account = ? ORDER BY created_at DESC, id DESC LIMIT ${maxArrayItems}`,
    [account],
  );
  return rows.map((row) => jsonParse(row.payload, {}));
}

async function getCustomerOrders(account, customerId) {
  await expireUnpaidOrders(account);
  const [rows] = await getPool().execute(
    `SELECT payload FROM orders WHERE account = ? AND customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ${maxArrayItems}`,
    [account, customerId],
  );
  return rows.map((row) => jsonParse(row.payload, {}));
}

async function getOrderRecord(account, orderNo, executor = getPool(), lock = false) {
  const [rows] = await executor.execute(
    `SELECT id, customer_id AS customerId, payload FROM orders WHERE account = ? AND order_no = ? ORDER BY id DESC LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [account, orderNo],
  );
  if (!rows[0]) return null;
  const payload = jsonParse(rows[0].payload, {});
  return { id: rows[0].id, customerId: rows[0].customerId, payload };
}

async function updateOrderPayloadById(id, payload, executor = getPool()) {
  await executor.execute("UPDATE orders SET payload = ? WHERE id = ?", [JSON.stringify(payload || {}), id]);
}

async function expireUnpaidOrders(account, executor = getPool()) {
  await executor.execute(`UPDATE orders SET payload = JSON_SET(payload, '$.paymentExpiresAt', created_at + ?)
    WHERE account = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.paymentStatus')) = 'pending'
    AND JSON_EXTRACT(payload, '$.paymentExpiresAt') IS NULL`, [PAYMENT_WINDOW_MS, account]);
  await executor.execute(`UPDATE orders SET payload = JSON_SET(payload, '$.status', '已取消', '$.paymentStatus', 'cancelled', '$.cancelReason', '支付超时')
    WHERE account = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.paymentStatus')) = 'pending'
    AND CAST(JSON_EXTRACT(payload, '$.paymentExpiresAt') AS UNSIGNED) > 0
    AND CAST(JSON_EXTRACT(payload, '$.paymentExpiresAt') AS UNSIGNED) <= ?`, [account, now()]);
}

/* ---------------------------------------------------------------------------
 * 订单评价（order_reviews）
 *
 * 规则（产品要求，改之前先读）：
 *  1. 只有「下过单」的客户能评价——服务端按 orders.customer_id 与登录会话比对，
 *     绝不信任请求体里的客户标识；不是本人的订单一律按"没下过单"处理。
 *  2. 可评价的订单必须已经成立：已付款，或已进入服务流程（待接单/待抽奖/服务中/已完成）。
 *     **不按支付方式区分**——余额支付、微信支付、虚拟支付/后台赠送都能评。
 *  3. 评价默认 pending，商户在后台通过（approved）之后才会出现在店铺前台和飘屏；
 *     驳回（rejected）写原因、不上前台，客户可以改完重新提交（回到 pending）。
 * ------------------------------------------------------------------------- */
const reviewMaxLength = 300;
const reviewPublicLimit = 120;
const reviewRejectReasonMax = 200;
const reviewStatuses = new Set(["pending", "approved", "rejected"]);
// 这些状态说明订单已经进入服务流程（用于覆盖不产生真实收款的虚拟单/赠送单）。
const reviewableOrderStatuses = new Set(["待抽奖", "待接单", "服务中", "已完成"]);

function orderReviewability(order) {
  if (!order) return "订单不存在";
  if (String(order.paymentStatus || "") === "paid") return "";
  if (reviewableOrderStatuses.has(String(order.status || ""))) return "";
  return "订单尚未支付，暂不可评价";
}

function publicReview(row) {
  // 对外只给「数字 ID + 昵称」，不下发内部 customer_key 和审核人（它们只该留在服务端）。
  return {
    id: String(row.id),
    orderNo: String(row.orderNo || ""),
    productId: String(row.productId || ""),
    productTitle: String(row.productTitle || ""),
    numericId: row.numericId == null ? "" : String(row.numericId),
    displayName: String(row.displayName || "").trim() || "用户",
    rating: Number(row.rating || 5),
    content: String(row.content || ""),
    status: reviewStatuses.has(String(row.status)) ? String(row.status) : "pending",
    rejectReason: String(row.rejectReason || ""),
    createdAt: Number(row.createdAt || 0),
    reviewedAt: Number(row.reviewedAt || 0),
  };
}

// 昵称取 customers.display_name（改名即时可见，与余额账户同一口径），不回退到内部 customer_key。
async function listReviews(account, { status = "", productId = "", customerKey = "", orderNo = "", id = "", limit = reviewPublicLimit, executor = null } = {}) {
  const where = ["r.account = ?"];
  const params = [account];
  if (status) { where.push("r.status = ?"); params.push(status); }
  if (productId) { where.push("r.product_id = ?"); params.push(productId); }
  if (customerKey) { where.push("r.customer_key = ?"); params.push(customerKey); }
  if (orderNo) { where.push("r.order_no = ?"); params.push(orderNo); }
  if (id) { where.push("r.id = ?"); params.push(id); }
  const take = Math.min(Math.max(Number(limit) || reviewPublicLimit, 1), 500);
  const [rows] = await (executor || getPool()).execute(
    `SELECT r.id, r.order_no AS orderNo, r.product_id AS productId, r.product_title AS productTitle,
            r.customer_key AS customerKey, r.rating, r.content, r.status, r.reject_reason AS rejectReason,
            r.created_at AS createdAt, r.reviewed_at AS reviewedAt,
            c.numeric_id AS numericId, c.display_name AS displayName
     FROM order_reviews r LEFT JOIN customers c ON c.customer_key = r.customer_key
     WHERE ${where.join(" AND ")}
     ORDER BY r.created_at DESC, r.id DESC LIMIT ${take}`,
    params,
  );
  return rows.map(publicReview);
}

async function getOrderReview(account, orderNo, executor = null) {
  const [rows] = await (executor || getPool()).execute(
    "SELECT id, status, reject_reason AS rejectReason FROM order_reviews WHERE account = ? AND order_no = ? LIMIT 1",
    [account, orderNo],
  );
  return rows[0] || null;
}

// 提交（或驳回后重新提交）。天然幂等：
//  - 已通过的再提交 → 拒绝，不会出现第二条；
//  - 待审核的重复提交 → 覆盖内容但仍只有一条；
//  - 并发首次提交 → 撞 UNIQUE(account, order_no)，翻译成"已提交，等待审核"。
async function submitOrderReview(account, customerId, input) {
  const orderNo = String(input?.orderNo ?? "").trim().slice(0, 64);
  if (!isSafeOrderNo(orderNo)) return { error: "订单编号无效", status: 400 };
  if (!isSafeCustomerId(customerId)) return { error: "登录状态已失效，请重新进入小程序", status: 400 };
  const rawRating = Math.round(Number(input?.rating));
  const rating = Number.isFinite(rawRating) ? Math.min(5, Math.max(1, rawRating)) : 5;
  // 评价内容是客户输入、会渲染到店铺前台和老板端，落库前先收口：去掉控制字符和尖括号，
  // 这样任何一端都不会因为把内容塞进 HTML 而出现脚本注入。
  const content = String(input?.content ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, reviewMaxLength);
  if (content.length < 2) return { error: "请先写下你的评价（至少 2 个字）", status: 400 };

  const record = await getOrderRecord(account, orderNo);
  if (!record || String(record.customerId || "") !== String(customerId)) {
    return { error: "只有下过这个订单的客户才能评价", status: 403 };
  }
  const blocked = orderReviewability(record.payload);
  if (blocked) return { error: blocked, status: 409 };

  const existing = await getOrderReview(account, orderNo);
  if (existing && String(existing.status) === "approved") {
    return { error: "这条评价已经通过审核，每个订单只能评价一次", status: 409 };
  }

  const config = await getConfig(account) || {};
  const productId = String(record.payload?.productId || "").slice(0, 80);
  const products = Array.isArray(config.products) ? config.products : [];
  const product = products.find((item) => String(item?.id ?? "") === productId);
  const productTitle = String(product?.title || record.payload?.product || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const timestamp = now();

  if (existing) {
    await getPool().execute(
      "UPDATE order_reviews SET rating = ?, content = ?, product_id = ?, product_title = ?, status = 'pending', reject_reason = '', reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?",
      [rating, content, productId, productTitle, timestamp, existing.id],
    );
  } else {
    try {
      await getPool().execute(
        `INSERT INTO order_reviews (account, order_no, customer_key, product_id, product_title, rating, content, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [account, orderNo, String(customerId), productId, productTitle, rating, content, timestamp, timestamp],
      );
    } catch (error) {
      if (error && error.code === "ER_DUP_ENTRY") {
        return { error: "这条订单的评价已经提交过了", status: 409 };
      }
      throw error;
    }
  }

  // 注意 listReviews 返回的是数组（不是 mysql 的 [rows, fields] 元组），别写 const [x] = ...
  // 返回给客户端的提示语不能提"审核"：客户不该知道评价还要过一道商户审核才展示
  // （2026-09-17 用户要求）。审核仍然在后台照常做，只是不告诉客户。
  const rows = await listReviews(account, { orderNo, limit: 1 });
  return { ok: true, review: rows[0] || null, message: "评价已提交，感谢你的反馈" };
}

// 商户审核。通过 → 前台/飘屏可见；驳回 → 写原因、不上前台，客户可改后重提。
async function reviewOrderReview(account, reviewerAccount, input) {
  const id = Number(input?.id);
  if (!Number.isInteger(id) || id <= 0) return { error: "评价编号无效", status: 400 };
  const action = input?.action === "reject" ? "reject" : (input?.action === "approve" ? "approve" : "");
  if (!action) return { error: "请选择通过或驳回", status: 400 };

  const timestamp = now();
  if (action === "approve") {
    await getPool().execute(
      "UPDATE order_reviews SET status = 'approved', reject_reason = '', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE account = ? AND id = ? AND status = 'pending'",
      [String(reviewerAccount || ""), timestamp, timestamp, account, id],
    );
  } else {
    const reason = String(input?.reason ?? "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .replace(/[<>]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, reviewRejectReasonMax)
      || "内容不符合展示要求，请修改后重新提交";
    await getPool().execute(
      "UPDATE order_reviews SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE account = ? AND id = ? AND status = 'pending'",
      [reason, String(reviewerAccount || ""), timestamp, timestamp, account, id],
    );
  }

  const updated = await listReviews(account, { id, limit: 1 });
  if (!updated[0]) return { error: "没有找到这条评价", status: 404 };
  if (updated[0].status !== (action === "approve" ? "approved" : "rejected")) {
    return { error: "这条评价的状态已变化，请刷新列表后查看", status: 409 };
  }
  return { ok: true, review: updated[0] };
}

function canAccessOrderChat(order, actor) {
  if (!order || !actor) return false;
  if (actor.role === "boss") return isSafeCustomerId(actor.id) && order.customerId === actor.id;
  // Staff identity is matched by server-issued customer id only — never by display name,
  // which clients could otherwise spoof to read other workers' chats.
  const payload = order.payload || {};
  return Boolean(actor.id && payload.staffId && payload.staffId === actor.id);
}

function publicChatMessage(row, viewerRole) {
  const senderRole = String(row.sender_role || "");
  const isMine = senderRole === viewerRole;
  const readAt = senderRole === "boss" ? row.read_by_staff_at : row.read_by_boss_at;
  return {
    id: String(row.id),
    role: senderRole,
    senderName: String(row.sender_name || (senderRole === "boss" ? "客户" : "打手")),
    body: String(row.body || ""),
    time: row.created_at,
    isMine,
    read: Boolean(!isMine || readAt),
  };
}

async function markOrderMessagesRead(account, orderNo, readerRole, executor = getPool()) {
  const timestamp = now();
  if (readerRole === "boss") {
    await executor.execute(
      "UPDATE order_messages SET read_by_boss_at = COALESCE(read_by_boss_at, ?) WHERE account = ? AND order_no = ? AND sender_role = 'staff'",
      [timestamp, account, orderNo],
    );
  } else {
    await executor.execute(
      "UPDATE order_messages SET read_by_staff_at = COALESCE(read_by_staff_at, ?) WHERE account = ? AND order_no = ? AND sender_role = 'boss'",
      [timestamp, account, orderNo],
    );
  }
}

async function getOrderMessages(account, orderNo, viewerRole) {
  const [rows] = await getPool().execute(
    "SELECT * FROM (SELECT id, sender_role, sender_name, body, read_by_boss_at, read_by_staff_at, created_at FROM order_messages WHERE account = ? AND order_no = ? ORDER BY created_at DESC, id DESC LIMIT 200) recent ORDER BY created_at ASC, id ASC",
    [account, orderNo],
  );
  return rows.map((row) => publicChatMessage(row, viewerRole));
}

async function getChatUnreadSummary(account, role, orderNos = [], viewerId = "") {
  const normalizedOrderNos = orderNos.filter(isSafeOrderNo).slice(0, maxArrayItems);
  if (!normalizedOrderNos.length) return {};
  const column = role === "boss" ? "read_by_boss_at" : "read_by_staff_at";
  const senderRole = role === "boss" ? "staff" : "boss";
  const placeholders = normalizedOrderNos.map(() => "?").join(",");
  // When a viewer id is given, only count orders that actually belong to the viewer,
  // so the endpoint cannot be used to probe other customers' orders.
  const ownerJoin = viewerId
    ? "JOIN orders o ON o.account = m.account AND o.order_no = m.order_no"
    : "";
  const ownerFilter = viewerId
    ? role === "boss" ? " AND o.customer_id = ?" : " AND JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.staffId')) = ?"
    : "";
  const params = [account, ...normalizedOrderNos, senderRole];
  if (viewerId) params.push(viewerId);
  const [rows] = await getPool().query(
    `SELECT m.order_no AS orderNo, COUNT(*) AS unread
     FROM order_messages m ${ownerJoin}
     WHERE m.account = ? AND m.order_no IN (${placeholders}) AND m.sender_role = ? AND m.${column} IS NULL${ownerFilter}
     GROUP BY m.order_no`,
    params,
  );
  return Object.fromEntries(rows.map((row) => [String(row.orderNo), Number(row.unread || 0)]));
}

async function getRecentOrderBroadcasts(account) {
  const [rows] = await getPool().execute(
    "SELECT customer_id, payload, created_at FROM orders WHERE account = ? AND customer_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 12",
    [account],
  );
  const broadcasts = [];
  for (const row of rows) {
    if (!isSafeCustomerId(row.customer_id)) continue;
    const identity = await ensureCustomerIdentity(row.customer_id);
    const order = jsonParse(row.payload, {});
    if (order.paymentStatus !== "paid") continue;
    broadcasts.push({
      orderNo: String(order.no || ""),
      userId: identity.numericId,
      user: identity.displayName,
      product: String(order.product || "订单"),
      time: String(order.time || row.created_at || ""),
    });
  }
  return broadcasts;
}

// 打手订单的**模糊搜索**：把一条订单里"人认得出这单"的字段拼成一段可搜索文本。
// 关键词按空格拆成多个词，**全部命中**才算匹配（AND），大小写不敏感 —— 所以
// 输「王者 12345」能同时收窄到商品和游戏 ID，输「DD1789」这种半截订单号也能命中。
function staffOrderSearchText(order) {
  return [
    order.no, order.product, order.title,
    order.gameName, order.gameId, order.server,
    order.user, order.remark,
    order.status, order.mainCategory,
  ].filter((value) => value != null && value !== "").join(" ").toLowerCase();
}

function normalizeSearchTerms(value) {
  return String(value || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

async function getStaffOrders(account, staffId, keyword = "") {
  const terms = normalizeSearchTerms(keyword);
  const orders = await getOrders(account);
  return orders.flatMap((order) => {
    if (order.paymentStatus !== "paid") return [];
    const isMine = Boolean(staffId && order.staffId === staffId);
    if (isMine) {
      // ⚠️ 关键词**只过滤「我的订单」**：接单大厅没有搜索框，同一个接口同时喂两个 tab，
      // 要是把大厅也一起过滤，打手搜完切回大厅会看到一份残缺的待接单列表。
      if (terms.length) {
        const haystack = staffOrderSearchText(order);
        if (!terms.every((term) => haystack.includes(term))) return [];
      }
      return [order];
    }
    const lotteryReady = !order.lottery || order.lottery.status === "completed";
    const canAccept = ["待服务", "待接单"].includes(order.status) && lotteryReady && !order.staffId;
    if (!canAccept) return [];
    const hallOrder = { ...order, gameId: "", gameName: "", customerId: "" };
    if (!order.lottery) return [hallOrder];
    return [{
      ...hallOrder,
      lottery: {
        poolId: order.lottery.poolId,
        poolName: order.lottery.poolName,
        totalDraws: order.lottery.totalDraws,
        completedDraws: order.lottery.completedDraws,
        status: order.lottery.status,
      },
    }];
  });
}

function normalizeWalletOwnerType(value) {
  return value === "staff" ? "staff" : value === "customer" ? "customer" : "";
}

function normalizeWalletAmount(value) {
  const amount = Math.round(Number(value || 0) * 100) / 100;
  return Number.isFinite(amount) && amount > 0 && amount <= 1000000 ? amount : 0;
}

function publicWalletAccount(row) {
  return {
    ownerType: String(row.owner_type),
    ownerId: String(row.owner_id),
    userId: row.numeric_id == null ? "" : String(row.numeric_id),
    displayName: String(row.customer_name || row.display_name || ""),
    balance: Number(row.balance || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function getWalletAccounts(account, ownerType) {
  const [rows] = await getPool().execute(
    `SELECT a.owner_type, a.owner_id, a.display_name, a.balance, a.updated_at,
            c.numeric_id AS numeric_id, c.display_name AS customer_name
     FROM wallet_accounts a
     LEFT JOIN customers c ON c.customer_key = a.owner_id
     WHERE a.account = ? AND a.owner_type = ?
     ORDER BY a.updated_at DESC, a.display_name ASC`,
    [account, ownerType],
  );
  return rows.map(publicWalletAccount);
}

function publicWalletTransaction(row) {
  return {
    id: Number(row.id || 0),
    ownerType: String(row.owner_type || ""),
    ownerId: String(row.owner_id || ""),
    userId: row.numeric_id == null ? "" : String(row.numeric_id),
    displayName: String(row.customer_name || row.display_name || ""),
    amount: Number(row.amount || 0),
    balanceAfter: Number(row.balance_after || 0),
    transactionType: String(row.transaction_type || ""),
    referenceNo: row.reference_no == null ? "" : String(row.reference_no),
    note: String(row.note || ""),
    operatorAccount: String(row.operator_account || ""),
    createdAt: Number(row.created_at || 0),
  };
}

// Balance ledger for the merchant console. `balance_after` on the newest row already
// equals the owner's remaining balance, but we also return the live wallet rows so the
// page still shows a correct balance for an account whose only record is an opening row.
async function getWalletTransactions(account, { ownerType = "", ownerId = "" } = {}) {
  const conditions = ["t.account = ?"];
  const params = [account];
  if (ownerType) { conditions.push("t.owner_type = ?"); params.push(ownerType); }
  if (ownerId) { conditions.push("t.owner_id = ?"); params.push(ownerId); }
  const [rows] = await getPool().execute(
    `SELECT t.id, t.owner_type, t.owner_id, t.amount, t.balance_after, t.transaction_type,
            t.reference_no, t.note, t.operator_account, t.created_at, a.display_name, c.numeric_id, c.display_name AS customer_name
     FROM wallet_transactions t
     LEFT JOIN wallet_accounts a
       ON a.account = t.account AND a.owner_type = t.owner_type AND a.owner_id = t.owner_id
     LEFT JOIN customers c ON c.customer_key = t.owner_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY t.created_at DESC, t.id DESC
     LIMIT ${maxArrayItems}`,
    params,
  );
  return rows.map(publicWalletTransaction);
}

// 累计消费只认「已支付」订单：余额付款和微信付款都算，未付款/已取消的不算。
// 口径就是后台会员权益里写的「累计消费满 X 元」，之前只写在文案里、从没真算过。
// 金额一律走整数分（orders.payload.price 存的是元，这里 SUM 完只做一次换算），不和元混用。
async function getCustomerTotalSpentFen(account, customerId, executor = getPool()) {
  const [rows] = await executor.execute(
    `SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.price')) AS DECIMAL(12,2))), 0) AS spent_yuan
     FROM orders
     WHERE account = ? AND customer_id = ?
       AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.paymentStatus')) = 'paid'`,
    [account, customerId],
  );
  return Math.round(Number(rows[0]?.spent_yuan || 0) * 100);
}

async function getCustomerWallet(account, customerId, executor = getPool()) {
  const [rows] = await executor.execute(
    `SELECT owner_type, owner_id, display_name, balance, updated_at
     FROM wallet_accounts
     WHERE account = ? AND owner_type = 'customer' AND owner_id = ?`,
    [account, customerId],
  );
  // 余额和累计消费一起下发：「我的」页三栏卡要同时显示这两个数字，避免再开一个接口。
  const totalSpentFen = await getCustomerTotalSpentFen(account, customerId, executor);
  if (rows[0]) return { ...publicWalletAccount(rows[0]), totalSpentFen };
  const identity = await ensureCustomerIdentity(customerId, executor);
  return {
    ownerType: "customer",
    ownerId: customerId,
    displayName: identity.displayName,
    balance: 0,
    updatedAt: 0,
    totalSpentFen,
  };
}

// 充值入口的两种模式：微信支付（商用）与直连到账（开发/演示用，不经过微信支付，生产禁用）。
async function rechargeCustomerWallet(account, customerId, input, payConfig = wechatPay.wechatPayConfig(), directRecharge = false) {
  if (payConfig.configured) {
    const intent = await createRechargePayment(account, customerId, input, payConfig);
    return { mode: "wechat", tradeNo: intent.tradeNo, amount: intent.amount, payment: intent.payment,
      wallet: await getCustomerWallet(account, customerId) };
  }
  if (!directRecharge) throw new wechatPay.WechatPayError("真实充值尚未接通，暂不支持充值", { status: 503, code: "PAYMENT_NOT_CONFIGURED" });
  return { mode: "direct", wallet: await directRechargeCustomerWallet(account, customerId, input) };
}

async function directRechargeCustomerWallet(account, customerId, input) {
  const amount = normalizeWalletAmount(input?.amount);
  if (!amount) throw new Error("充值金额需大于 0，且不超过 1000000 元");
  return runTransaction(async (connection) => {
    const identity = await ensureCustomerIdentity(customerId, connection);
    const timestamp = now();
    await connection.execute(
      `INSERT INTO wallet_accounts
       (account, owner_type, owner_id, display_name, balance, created_at, updated_at)
       VALUES (?, 'customer', ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         balance = balance + VALUES(balance),
         updated_at = VALUES(updated_at)`,
      [account, customerId, identity.displayName, amount, timestamp, timestamp],
    );
    const wallet = await getCustomerWallet(account, customerId, connection);
    await connection.execute(
      `INSERT INTO wallet_transactions
       (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
       VALUES (?, 'customer', ?, ?, ?, 'customer_recharge', ?, ?, 'customer_self', ?)`,
      [account, customerId, amount, wallet.balance, `CZ${timestamp}`, String(input?.note || "客户充值").slice(0, 200), timestamp],
    );
    return wallet;
  });
}

// options.transactionType / options.note 让「提现扣款」复用同一条扣款逻辑（默认还是订单支付）。
async function debitCustomerWallet(connection, account, customerId, amount, orderNo, options = {}) {
  const [rows] = await connection.execute(
    `SELECT owner_type, owner_id, display_name, balance, updated_at
     FROM wallet_accounts
     WHERE account = ? AND owner_type = 'customer' AND owner_id = ? FOR UPDATE`,
    [account, customerId],
  );
  const currentBalance = Number(rows[0]?.balance || 0);
  if (currentBalance < amount) throw new Error(`余额不足，当前可用余额 ¥${currentBalance.toFixed(2)}`);
  const nextBalance = Math.round((currentBalance - amount) * 100) / 100;
  const timestamp = now();
  await connection.execute(
    `UPDATE wallet_accounts SET balance = ?, updated_at = ?
     WHERE account = ? AND owner_type = 'customer' AND owner_id = ?`,
    [nextBalance, timestamp, account, customerId],
  );
  await connection.execute(
    `INSERT INTO wallet_transactions
     (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
     VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, 'customer_self', ?)`,
    [account, customerId, -amount, nextBalance, options.transactionType || "order_payment",
      orderNo, options.note || `订单 ${orderNo} 余额支付`, timestamp],
  );
  return nextBalance;
}

// 客户余额入账（提现被驳回时把钱退回客户余额）。打手那侧走 creditStaffWallet，两条路不共用。
async function creditCustomerWallet(connection, account, customerId, amount, { transactionType, referenceNo, note }) {
  const value = Math.round(Number(amount || 0) * 100) / 100;
  if (!(value > 0)) return null;
  const timestamp = now();
  await connection.execute(
    `INSERT INTO wallet_accounts (account, owner_type, owner_id, display_name, balance, created_at, updated_at)
     VALUES (?, 'customer', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance), updated_at = VALUES(updated_at)`,
    [account, customerId, (await ensureCustomerIdentity(customerId, connection)).displayName, value, timestamp, timestamp],
  );
  const wallet = await getCustomerWallet(account, customerId, connection);
  await connection.execute(
    `INSERT INTO wallet_transactions
     (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
     VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, 'system', ?)`,
    [account, customerId, value, wallet.balance, transactionType, referenceNo, String(note || "").slice(0, 200), timestamp],
  );
  return wallet;
}

// ---------- 打手佣金与提现 ----------
// 三本账：保证金 / 可用佣金 / 冻结佣金。这里只有「可用佣金」能动 ——
// 它就是 wallet_accounts 里 owner_type='staff' 的那条余额（跟客户钱包同一张表，靠 owner_type 区分，
// 所以「客户消费余额」永远不会被当成打手佣金）。钱的四个动作：
//   商户结单        → 按打手分成入账（凭 order_no 幂等，重复结单不会入两次）
//   提交提现        → 从可用佣金扣走，生成 pending 提现单（pending 的单本身就是「冻结佣金」）
//   审核通过        → 手续费里属于管事的那部分，这时才落到管事账上
//   审核驳回        → 整笔退回可用佣金（对应文案「如提现失败，提现金额将退回可用佣金」）
// 手续费在**提交那一刻**由 shared.js 解算，解算结果连同分账一起冻结进提现单 ——
// 之后商户改配置不影响已经发出去的单。
const WITHDRAW_STATUS_TEXT = { pending: "审核中", approved: "已通过", rejected: "已驳回" };
// 渠道 key 只能这三个（label 在 shared.js 的 WITHDRAW_CHANNELS，别在这里再抄一份名字）。
const WITHDRAW_CHANNEL_KEYS = shared.WITHDRAW_CHANNELS.map((channel) => channel.key);
const WITHDRAW_REJECT_REASON_MAX = 60;

function withdrawChannelText(channel) {
  const found = shared.WITHDRAW_CHANNELS.find((item) => item.key === channel);
  return found ? found.label : String(channel || "");
}

function newWithdrawNo() {
  return `WD${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// 商户在后台「分销管理」里调的三个运营项（最低提现额 / 开放渠道 / 打手端说明文案）。
// 归一化交给 shared.js —— 缺项、非法值一律退回兜底，服务端和前端看到的是同一份结果。
async function withdrawSettingsOf(account) {
  const config = await getConfig(account);
  return shared.normalizeWithdrawSettings(config && config.withdrawSettings);
}

// 打手的「可用佣金」钱包。没有记录时返回 0，不偷偷建一条（开户留给第一次入账）。
async function getStaffWallet(account, staffKey, executor = getPool()) {
  const [rows] = await executor.execute(
    `SELECT a.owner_type, a.owner_id, a.display_name, a.balance, a.updated_at,
            c.numeric_id AS numeric_id, c.display_name AS customer_name
     FROM wallet_accounts a
     LEFT JOIN customers c ON c.customer_key = a.owner_id
     WHERE a.account = ? AND a.owner_type = 'staff' AND a.owner_id = ?`,
    [account, staffKey],
  );
  if (rows[0]) return publicWalletAccount(rows[0]);
  const [customers] = await executor.execute(
    "SELECT numeric_id, display_name FROM customers WHERE customer_key = ?",
    [staffKey],
  );
  return {
    ownerType: "staff", ownerId: staffKey,
    userId: customers[0]?.numeric_id == null ? "" : String(customers[0].numeric_id),
    displayName: String(customers[0]?.display_name || ""),
    balance: 0, updatedAt: 0,
  };
}

// 给打手/管事的可用佣金入账。transaction_type + reference_no 双条件查重：
// 同一个来源重复调用只入账一次（结单佣金、管事抽成、驳回退回都靠它兜住重复提交）。
// ponytail: 查重不是原子的，靠调用方所在事务已经锁住来源行（订单行 / 提现单行）来串行化；
//           真要跨来源并发入账，再升级成 wallet_credit_requests 那张幂等回执表。
async function creditStaffWallet(connection, { account, ownerId, amount, transactionType, referenceNo, note }) {
  const value = Math.round(Number(amount || 0) * 100) / 100;
  const staffKey = String(ownerId || "");
  if (!staffKey || !(value > 0)) return null;
  const [existing] = await connection.execute(
    `SELECT id FROM wallet_transactions
     WHERE account = ? AND owner_type = 'staff' AND owner_id = ? AND transaction_type = ? AND reference_no = ?
     LIMIT 1`,
    [account, staffKey, transactionType, referenceNo],
  );
  if (existing.length) return null;
  const timestamp = now();
  const [customers] = await connection.execute(
    "SELECT display_name FROM customers WHERE customer_key = ?",
    [staffKey],
  );
  const displayName = String(customers[0]?.display_name || "");
  await connection.execute(
    `INSERT INTO wallet_accounts (account, owner_type, owner_id, display_name, balance, created_at, updated_at)
     VALUES (?, 'staff', ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       balance = balance + VALUES(balance),
       updated_at = VALUES(updated_at)`,
    [account, staffKey, displayName, value, timestamp, timestamp],
  );
  const wallet = await getStaffWallet(account, staffKey, connection);
  await connection.execute(
    `INSERT INTO wallet_transactions
     (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
     VALUES (?, 'staff', ?, ?, ?, ?, ?, ?, 'system', ?)`,
    [account, staffKey, value, wallet.balance, transactionType, referenceNo, String(note || "").slice(0, 200), timestamp],
  );
  return wallet;
}

// 结单收尾：订单进「已完成」+ 打手佣金入账。
// 商户后台点「结单」和老板端点「确认结单」走的是同一段收尾，抽出来共用 ——
// 两条路各写一遍的话，哪天漏了入账那一边，打手就白干这单。
// 幂等：重复点结单 / 网络重试都只入一次（creditStaffWallet 按
// owner + transaction_type + reference_no 查重；已完成的单再进来 advanceOrder 原样返回）。
async function completeOrderAndCreditStaff(connection, { account, orderNo, record, action, actor, proof }) {
  const payload = advanceOrder(record.payload, action, actor, now(), proof);
  await updateOrderPayloadById(record.id, payload, connection);
  // 结单＝打手佣金入账（打手端「可用佣金」就是从这里来的，提现只能提这一笔）。
  // ponytail: 结单之后再退款不会把佣金收回（没有负向入账）；要做的话按 order_refund 冲一笔。
  if (String(payload.status) === "已完成" && payload.staffId) {
    await creditStaffWallet(connection, {
      account, ownerId: String(payload.staffId), amount: shared.getOrderStaffIncome(payload),
      transactionType: "order_commission", referenceNo: orderNo, note: `订单 ${orderNo} 结单佣金`,
    });
  }
  return payload;
}

// 从可用佣金扣一笔（提交提现时）。余额不足直接抛错，整个事务回滚，不会留下半张单。
async function debitStaffWallet(connection, account, staffKey, amount, { transactionType, referenceNo, note }) {
  const [rows] = await connection.execute(
    "SELECT balance FROM wallet_accounts WHERE account = ? AND owner_type = 'staff' AND owner_id = ? FOR UPDATE",
    [account, staffKey],
  );
  const current = Number(rows[0]?.balance || 0);
  if (current < amount) throw new Error(`可用佣金不足，当前 ¥${current.toFixed(2)}`);
  const next = Math.round((current - amount) * 100) / 100;
  const timestamp = now();
  await connection.execute(
    `UPDATE wallet_accounts SET balance = ?, updated_at = ?
     WHERE account = ? AND owner_type = 'staff' AND owner_id = ?`,
    [next, timestamp, account, staffKey],
  );
  await connection.execute(
    `INSERT INTO wallet_transactions
     (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
     VALUES (?, 'staff', ?, ?, ?, ?, ?, ?, 'system', ?)`,
    [account, staffKey, -amount, next, transactionType, referenceNo, String(note || "").slice(0, 200), timestamp],
  );
  return next;
}

// 这个人提现时被收多少手续费。两类身份走两条路：
//   管事本人（stewards 里有他）→ resolveStewardSelfFee，收上来整笔归商户，不分给谁
//   普通打手 → resolveWithdrawFee：按打手专项/全局默认取总手续费，再在管事和商户之间分
async function resolveWithdrawFeeFor(account, staffKey, amountCents) {
  const config = await getConfig(account);
  const feeConfig = shared.normalizeWithdrawFee(config && config.withdrawFee);
  const [stewardRows] = await getPool().execute(
    "SELECT 1 FROM stewards WHERE account = ? AND customer_key = ?",
    [account, staffKey],
  );
  if (stewardRows.length) {
    const self = feeConfig.stewardSelf;
    const totalCents = self.enabled ? shared.withdrawFeeCents(self, amountCents) : 0;
    return {
      isSteward: true, stewardKey: "", totalCents, stewardCents: 0, merchantCents: totalCents,
      part: { mode: self.mode, value: self.value },
      snapshot: { self: self.enabled === true, totalCents },
    };
  }
  const [relations] = await getPool().execute(
    "SELECT steward_key FROM steward_relations WHERE account = ? AND staff_key = ?",
    [account, staffKey],
  );
  const stewardKey = String(relations[0]?.steward_key || "");
  const resolved = shared.resolveWithdrawFee(config, { staffKey, stewardKey, amountCents });
  // 打手被收的是「总手续费」：先看有没有按这个打手配的专项，没有就用全局默认。
  const part = feeConfig.staffOverrides[staffKey] || feeConfig.staff;
  return {
    isSteward: false, stewardKey,
    totalCents: resolved.totalCents, stewardCents: resolved.stewardCents, merchantCents: resolved.merchantCents,
    part: { mode: part.mode, value: part.value },
    snapshot: {
      staffSource: resolved.staffSource, stewardSource: resolved.stewardSource,
      stewardShareRate: resolved.stewardShareRate, totalCents: resolved.totalCents,
      stewardCents: resolved.stewardCents, merchantCents: resolved.merchantCents,
    },
  };
}

// 提交提现。服务端把身份、最低提现额、渠道开关、手续费全部重算一遍 ——
// 前端传上来的 money/fee/actual 一个都不看（只认 channel + 收款信息 + money）。
// 身份由服务端判定（有没有打手授权），客户端递上来的身份一律不看：
//   打手 → 扣「可用佣金」，按商户配的手续费收一笔，管事那份等审核通过才入账
//   用户 → 扣「客户消费余额」，不扣手续费（文档第三节：用户身份抽成恒为 0）
async function createWithdrawOrder(account, customer, input, identity) {
  const settings = await withdrawSettingsOf(account);
  const amount = Math.round(Number(input?.money || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error("提现金额不能为空");
  if (amount < settings.minAmount) throw new Error(`最低提现金额为${settings.minAmount}元`);
  const channel = String(input?.channel || "");
  if (!WITHDRAW_CHANNEL_KEYS.includes(channel) || !settings.channels.includes(channel)) throw new Error("该通道未开放提现");
  const accountName = String(input?.name || "").trim();
  const accountNo = String(input?.account || "").trim();
  if (!accountName || !accountNo) throw new Error("请先设置提现信息");

  const staffIdentity = identity === "staff";
  const amountCents = Math.round(amount * 100);
  const feeInfo = staffIdentity
    ? await resolveWithdrawFeeFor(account, customer.customerId, amountCents)
    : { isSteward: false, stewardKey: "", totalCents: 0, stewardCents: 0, merchantCents: 0, snapshot: { identity: "user", totalCents: 0 } };
  const feeYuan = Math.round(feeInfo.totalCents) / 100;
  const actualYuan = Math.round(amountCents - feeInfo.totalCents) / 100;
  const orderNo = newWithdrawNo();

  return runTransaction(async (connection) => {
    // 先扣钱（余额不足会在这里抛错并整体回滚），再落单 —— 顺序反了就会出现"有钱的单没扣钱"。
    if (staffIdentity) {
      await debitStaffWallet(connection, account, customer.customerId, amount, {
        transactionType: "withdraw_apply", referenceNo: orderNo, note: `提现申请 ${orderNo}`,
      });
    } else {
      await debitCustomerWallet(connection, account, customer.customerId, amount, orderNo, {
        transactionType: "withdraw_apply", note: `提现申请 ${orderNo}`,
      });
    }
    const timestamp = now();
    await connection.execute(
      `INSERT INTO withdraw_orders
       (account, order_no, identity, staff_key, staff_name, staff_numeric, steward_key, channel, account_name, account_no,
        bank_name, images, money, fee, actual_money, steward_cents, merchant_cents, fee_snapshot, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        account, orderNo, staffIdentity ? "staff" : "user",
        customer.customerId, customer.displayName, customer.numericId || "",
        feeInfo.stewardKey || "", channel, accountName, accountNo,
        channel === "bank" ? String(input?.bankName || "").trim() : "", String(input?.images || "").slice(0, 500),
        amount, feeYuan, actualYuan, feeInfo.stewardCents, feeInfo.merchantCents,
        JSON.stringify(feeInfo.snapshot).slice(0, 300), timestamp, timestamp,
      ],
    );
    return { orderNo, money: amount, fee: feeYuan, actualMoney: actualYuan, status: "pending", statusText: WITHDRAW_STATUS_TEXT.pending };
  });
}

function withdrawOrderView(row) {
  const status = String(row.status || "pending");
  return {
    kind: "withdraw",
    orderNo: String(row.order_no || ""),
    identity: String(row.identity || "staff") === "user" ? "user" : "staff",
    createtime: Number(row.created_at || 0),
    staffKey: String(row.staff_key || ""),
    staffName: String(row.staff_name || ""),
    staffNumeric: String(row.staff_numeric || ""),
    channel: String(row.channel || ""),
    channelText: withdrawChannelText(row.channel),
    name: String(row.account_name || ""),
    account: String(row.account_no || ""),
    bankName: String(row.bank_name || ""),
    images: String(row.images || ""),
    money: Number(row.money || 0),
    fee: Number(row.fee || 0),
    actualMoney: Number(row.actual_money || 0),
    stewardCents: Number(row.steward_cents || 0),
    merchantCents: Number(row.merchant_cents || 0),
    status,
    statusText: WITHDRAW_STATUS_TEXT[status] || status,
    rejectReason: String(row.reject_reason || ""),
    createdAt: Number(row.created_at || 0),
    reviewedAt: row.reviewed_at == null ? 0 : Number(row.reviewed_at),
  };
}

async function listWithdrawOrders(account, { staffKey = "", status = "" } = {}) {
  const conditions = ["account = ?"];
  const params = [account];
  if (staffKey) { conditions.push("staff_key = ?"); params.push(staffKey); }
  if (status === "pending" || status === "approved" || status === "rejected") {
    conditions.push("status = ?");
    params.push(status);
  }
  const [rows] = await getPool().execute(
    `SELECT * FROM withdraw_orders WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC, id DESC LIMIT ${maxArrayItems}`,
    params,
  );
  return rows.map(withdrawOrderView);
}

// 商户审核。只能审一次（状态必须是 pending），并发重复点会被行锁挡在第二条上。
async function reviewWithdrawOrder(account, orderNo, { decision, reason }, operatorAccount) {
  const approve = decision === "approve";
  if (!approve && decision !== "reject") throw new Error("审核结果无效");
  const rejectReason = String(reason || "").trim().slice(0, WITHDRAW_REJECT_REASON_MAX);
  if (!approve && !rejectReason) throw new Error("请填写驳回原因");
  return runTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT * FROM withdraw_orders WHERE account = ? AND order_no = ? FOR UPDATE",
      [account, orderNo],
    );
    const row = rows[0];
    if (!row) throw new Error("提现单不存在");
    if (String(row.status) !== "pending") throw new Error("这张提现单已经审核过了");
    if (approve) {
      // 通过了才把手续费里管事那一份记到管事账上；驳回就当这笔提现没发生，一分不抽。
      const stewardCents = Number(row.steward_cents || 0);
      const stewardKey = String(row.steward_key || "");
      if (stewardCents > 0 && stewardKey) {
        await creditStaffWallet(connection, {
          account, ownerId: stewardKey, amount: stewardCents / 100,
          transactionType: "steward_commission", referenceNo: orderNo,
          note: `下级提现抽成 ${orderNo}`,
        });
      }
    } else if (String(row.identity || "staff") === "user") {
      await creditCustomerWallet(connection, account, String(row.staff_key), Number(row.money || 0), {
        transactionType: "withdraw_refund", referenceNo: orderNo, note: `提现驳回退回 ${orderNo}`,
      });
    } else {
      await creditStaffWallet(connection, {
        account, ownerId: String(row.staff_key), amount: Number(row.money || 0),
        transactionType: "withdraw_refund", referenceNo: orderNo,
        note: `提现驳回退回 ${orderNo}`,
      });
    }
    const timestamp = now();
    const status = approve ? "approved" : "rejected";
    await connection.execute(
      `UPDATE withdraw_orders
       SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE account = ? AND order_no = ?`,
      [status, approve ? "" : rejectReason, String(operatorAccount || ""), timestamp, timestamp, account, orderNo],
    );
    return withdrawOrderView({ ...row, status, reject_reason: approve ? "" : rejectReason, reviewed_at: timestamp });
  });
}

// 提现页进页拉一次的那份配置（不是 70KB 的全量公开配置，只要这三项 + 本人的余额和费率）。
// identity 由服务端判（有没有打手授权）：打手提「可用佣金」，用户提「客户消费余额」且不扣手续费。
async function withdrawPagePayload(account, customer, identity) {
  const settings = await withdrawSettingsOf(account);
  const staffIdentity = identity === "staff";
  const wallet = staffIdentity
    ? await getStaffWallet(account, customer.customerId)
    : await getCustomerWallet(account, customer.customerId);
  const feeInfo = staffIdentity
    ? await resolveWithdrawFeeFor(account, customer.customerId, 0)
    : { isSteward: false, part: { mode: "rate", value: 0 } };
  return {
    ok: true,
    identity: staffIdentity ? "staff" : "user",
    minAmount: settings.minAmount,
    channels: settings.channels,
    notice: settings.notice,
    available: Number(wallet.balance || 0),
    isSteward: feeInfo.isSteward === true,
    // 下发给打手的是**他本人**被收的那一档（有专项用专项，没有用全局默认）；用户恒为 0。
    fee: { mode: feeInfo.part?.mode === "amount" ? "amount" : "rate", value: Number(feeInfo.part?.value || 0) },
  };
}

// 提现记录页：把「收入」（打手佣金入账流水）和「提现」（提现单）合到一起，
// 前端按 kind 分「全部 / 收入 / 提现」三个 tab，不用再开第二个接口。
async function withdrawRecords(account, customer) {
  const [incomeRows] = await getPool().execute(
    `SELECT amount, transaction_type, reference_no, note, created_at
     FROM wallet_transactions
     WHERE account = ? AND owner_type = 'staff' AND owner_id = ? AND amount > 0
     ORDER BY created_at DESC, id DESC LIMIT ${maxArrayItems}`,
    [account, customer.customerId],
  );
  const income = incomeRows.map((row) => ({
    kind: "income",
    orderNo: String(row.reference_no || ""),
    channelText: row.transaction_type === "steward_commission" ? "下级提现抽成" : "订单结单佣金",
    name: "", account: "",
    createtime: Number(row.created_at || 0),
    actualMoney: Number(row.amount || 0),
    status: "approved",
    statusText: "已入账",
  }));
  const withdraw = await listWithdrawOrders(account, { staffKey: customer.customerId });
  return [...income, ...withdraw].sort((left, right) => right.createtime - left.createtime).slice(0, maxArrayItems);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 资金指标（打手端「我的账单」）：8 格指标 + 保证金充值 + 罚单 + 佣金流水
//
// 契约来自《资金指标开发提示词》：字段名 / 状态取值 / 金额精度规则一律照它，不自创。
// **三本账不能混**（提示词第 12 节的红线）：
//   ① 可用佣金  owner_type='staff'      —— 结单入账 / 提现扣款 / 缴罚款 只动这本，也是唯一能提现的
//   ② 冻结佣金  不落表，按「待结单」订单实时聚合（见 staffFrozenCommission）
//   ③ 保证金    owner_type='staff_bond' —— 只增不减；打手侧没有任何扣减/解冻/退还动作
// 订单生命周期与账的对应：
//   打手上传结单截图 → 订单「待结单」→ 此时佣金算 ② 冻结
//   商户结单        → 订单「已完成」→ 入账 order_commission → ② 变成 ①（提示词里叫「完成解冻」）
// 所以「可提现 = 可用 + 冻结」是错的，提现只看 ①（withdraw 那条路本来就只认 owner_type='staff'）。
// ═══════════════════════════════════════════════════════════════════════════════

const FUND_BOND_OWNER_TYPE = "staff_bond";
// 保证金档位固定四档，20 是推荐档（提示词第 5 节）。自定义金额另收，不走这两个常量。
const FUND_BOND_TIERS = [10, 20, 50, 100];
const FUND_BOND_RECOMMENDED = 20;
const FUND_BOND_MAX = 100000;
const FINE_LIMIT = 15;
const FINE_REASON_MAX = 200;

// ── 时间口径 ──────────────────────────────────────────────────────────────────
// 全程按 Asia/Shanghai（UTC+8，无夏令时 —— 用固定偏移算，不引时区库也不会错）。
// 提示词第 8 节：月/上月/累计三个口径**全部由服务端算**，前端一行日期代码都不该有。

// 返回 [起, 止) 毫秒区间。offsetMonths = 0 本月 / -1 上月。
function shanghaiMonthRange(offsetMonths, timestamp = now()) {
  const shifted = new Date(Number(timestamp) + 8 * 3600 * 1000);
  const start = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + offsetMonths, 1) - 8 * 3600 * 1000;
  const end = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + offsetMonths + 1, 1) - 8 * 3600 * 1000;
  return [start, end];
}

// 罚单的时间字段按提示词要求**由服务端格式化成字符串**，前端直接输出、不做 new Date()。
function shanghaiText(timestamp) {
  const value = Number(timestamp || 0);
  if (!(value > 0)) return "";
  const shifted = new Date(value + 8 * 3600 * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
    + ` ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

function clampInt(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

// ── 8 格指标（全部服务端聚合，前端零计算 —— 提示词第 1 / 11 节）──────────────

// 冻结佣金 = 这个打手「已上传结单截图、商户还没结单」的订单佣金合计。
// 不落表：它本来就是「待结单」这个状态的函数，实时算才永远和订单列表对得上
// （落表就得在结单/返回大厅/退款各写一遍同步逻辑，漏一处就永久对不平）。
async function staffFrozenCommission(account, staffKey) {
  const orders = await getOrders(account);
  let total = 0;
  for (const order of orders) {
    if (order.paymentStatus !== "paid") continue;
    if (String(order.staffId || "") !== String(staffKey)) continue;
    if (displayStatus(order) !== "待结单") continue;
    total += shared.getOrderStaffIncome(order);
  }
  return Math.round(total * 100) / 100;
}

// 「排行榜」的接单流水：按打手聚合「接过多少单」+「这些单的成交额合计」。
// 口径与 staffFrozenCommission 对齐 —— 只认 paymentStatus === 'paid' 且订单上还挂着打手的单：
//   · 未付款 / 已取消 / 超时释放的订单压根没成交，不算接单；
//   · 商户点「返回大厅」时 order-flow 会把 staffId 删掉，那一单自然就不算在任何打手头上。
// 订单正文在 MySQL `orders.payload`（JSON）里，**聚合只能在服务端做**：
// 后台别的页面拿全量订单是为了显示列表，排行榜只为两个数字把几千条订单拉下来不划算。
async function staffOrderStats(account) {
  const orders = await getOrders(account);
  const stats = new Map();
  for (const order of orders) {
    if (order.paymentStatus !== "paid") continue;
    const staffKey = String(order.staffId || "");
    if (!staffKey) continue;
    const entry = stats.get(staffKey) || { staff_key: staffKey, order_count: 0, order_amount: 0 };
    entry.order_count += 1;
    entry.order_amount += Number(order.price || 0);
    stats.set(staffKey, entry);
  }
  return [...stats.values()].map((entry) => ({
    staff_key: entry.staff_key,
    order_count: entry.order_count,
    order_amount: Math.round(entry.order_amount * 100) / 100,
  }));
}

// 累计 / 本月 / 上月结算：**一条 SQL 出三个互相独立的值**（提示词明确不许拿 total - month 推导）。
// 口径 = wallet_transactions 里 transaction_type='order_commission'（结单那笔入账）的金额合计，
// 按 Asia/Shanghai 自然月切。管事的下级提现抽成（steward_commission）不算「结算」，不计入。
// 小程序「排行榜」：与后台「员工管理 / 排行榜」同一份口径（接单流水），
// 按接单笔数 → 成交额 → 昵称排序，默认只返回前 20 名。
async function staffRanking(account, limit = 20) {
  const [grants] = await getPool().execute(
    "SELECT customer_key FROM staff_grants WHERE account = ? ORDER BY created_at",
    [account],
  );
  const keys = grants.map((row) => String(row.customer_key || "")).filter(Boolean);
  const customerMap = new Map();
  if (keys.length) {
    const placeholders = keys.map(() => "?").join(",");
    const [customers] = await getPool().execute(
      `SELECT customer_key, numeric_id, display_name FROM customers WHERE customer_key IN (${placeholders})`,
      keys,
    );
    for (const c of customers) customerMap.set(c.customer_key, c);
  }
  const statsMap = new Map();
  for (const s of await staffOrderStats(account)) statsMap.set(s.staff_key, s);
  const list = keys.map((key) => {
    const c = customerMap.get(key) || {};
    const s = statsMap.get(key) || { order_count: 0, order_amount: 0 };
    return {
      staff_key: key,
      name: String(c.display_name || "—"),
      numeric_id: c.numeric_id == null ? "" : String(c.numeric_id),
      order_count: Number(s.order_count || 0),
      order_amount: Math.round(Number(s.order_amount || 0) * 100) / 100,
    };
  });
  list.sort((a, b) => {
    if (b.order_count !== a.order_count) return b.order_count - a.order_count;
    if (b.order_amount !== a.order_amount) return b.order_amount - a.order_amount;
    return String(a.name).localeCompare(String(b.name));
  });
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  return list.slice(0, n);
}

async function staffSettledTotals(account, staffKey) {
  const [monthStart, monthEnd] = shanghaiMonthRange(0);
  const [lastStart, lastEnd] = shanghaiMonthRange(-1);
  const [rows] = await getPool().execute(
    `SELECT COALESCE(SUM(amount), 0) AS total,
            COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN amount ELSE 0 END), 0) AS month,
            COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN amount ELSE 0 END), 0) AS last_month
     FROM wallet_transactions
     WHERE account = ? AND owner_type = 'staff' AND owner_id = ? AND transaction_type = 'order_commission'`,
    [monthStart, monthEnd, lastStart, lastEnd, account, staffKey],
  );
  const row = rows[0] || {};
  return { total: Number(row.total || 0), month: Number(row.month || 0), lastMonth: Number(row.last_month || 0) };
}

// 罚单合计：总已交（status=1）/ 待交（status=0）。
// status>=2 是「已撤销」，**两边都不算** —— 撤销意味着这笔罚款不成立，留着待缴会让打手一直看到
// 一笔永远交不掉的单子。这也是提示词「撤销后金额是否回滚」的答案：回滚到"两边都不计"。
async function staffFineTotals(account, staffKey) {
  const [rows] = await getPool().execute(
    `SELECT COALESCE(SUM(CASE WHEN status = 1 THEN amount ELSE 0 END), 0) AS paid,
            COALESCE(SUM(CASE WHEN status = 0 THEN amount ELSE 0 END), 0) AS unpaid
     FROM staff_fines WHERE account = ? AND staff_key = ?`,
    [account, staffKey],
  );
  const row = rows[0] || {};
  return { paid: Number(row.paid || 0), unpaid: Number(row.unpaid || 0) };
}

async function getBondBalance(account, staffKey, executor = getPool()) {
  const [rows] = await executor.execute(
    "SELECT balance FROM wallet_accounts WHERE account = ? AND owner_type = ? AND owner_id = ?",
    [account, FUND_BOND_OWNER_TYPE, staffKey],
  );
  return Number(rows[0]?.balance || 0);
}

async function staffBondShortfall(account, staffKey, executor) {
  const requiredFen = yuanToFen((await getConfig(account, executor))?.staffBondRequirement);
  if (!requiredFen) return "";
  const balanceFen = yuanToFen(await getBondBalance(account, staffKey, executor));
  return balanceFen < requiredFen
    ? `保证金不足：需 ${fenToYuan(requiredFen)} 元，当前 ${fenToYuan(balanceFen)} 元`
    : "";
}

// 8 格指标一次返回。field 名严格照提示词第 1 节的 data 契约（下划线命名，别改成驼峰）。
async function staffFundIndicators(account, staffKey) {
  const [bond, frozen, settled, fines, wallet, feeInfo] = await Promise.all([
    getBondBalance(account, staffKey),
    staffFrozenCommission(account, staffKey),
    staffSettledTotals(account, staffKey),
    staffFineTotals(account, staffKey),
    getStaffWallet(account, staffKey),
    resolveWithdrawFeeFor(account, staffKey, 0),
  ]);
  return {
    bond,
    available_money: Number(wallet.balance || 0),
    frozen_money: frozen,
    total_settled: settled.total,
    month_settled: settled.month,
    last_month_settled: settled.lastMonth,
    fine_paid_total: fines.paid,
    fine_unpaid_total: fines.unpaid,
    // 保证金基准值：提示词里充值页读它做档位参考。本项目没有单独的"基准"概念，就是当前余额。
    bond_money: bond,
    bond_tiers: FUND_BOND_TIERS,
    bond_recommended: FUND_BOND_RECOMMENDED,
    // jd_status（"1" = 接单中）本项目没有这个开关，返回空串（前端 `=== "1"` 判定为 false）。
    jd_status: "",
    // 提现抽成率（%）：给的是**他本人**那一档（有专项用专项，没有用全局默认）；按金额收时返回 0。
    manager_withdraw_rate: feeInfo.part?.mode === "rate" ? Number(feeInfo.part.value || 0) : 0,
  };
}

// ── 保证金充值 ────────────────────────────────────────────────────────────────
// ⚠️ 目前**不接真实支付**（用户 2026-09-18 定：整个项目要全面接入虚拟支付，先不做支付）。
// 开发/本机环境直接把钱记进保证金并留一条 bond_recharge 流水，前端拿到 mode='direct' 即视为成功；
// 生产环境一律拒绝，免得线上白送保证金。接虚拟支付时只需要把这里换成
// 「建支付意图 → 回调成功再入账」，前端判断 mode 的分支不用动。
function newBondNo() {
  return `BD${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function rechargeStaffBond(account, staffKey, input) {
  const money = Math.round(Number(input?.money || 0) * 100) / 100;
  if (!(money > 0)) throw new Error("请输入充值金额");
  if (money > FUND_BOND_MAX) throw new Error(`单次充值金额不能超过 ${FUND_BOND_MAX} 元`);
  const bondNo = newBondNo();
  const bond = await runTransaction(async (connection) => {
    const [customers] = await connection.execute(
      "SELECT display_name FROM customers WHERE customer_key = ?",
      [staffKey],
    );
    const timestamp = now();
    await connection.execute(
      `INSERT INTO wallet_accounts (account, owner_type, owner_id, display_name, balance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         balance = balance + VALUES(balance),
         updated_at = VALUES(updated_at)`,
      [account, FUND_BOND_OWNER_TYPE, staffKey, String(customers[0]?.display_name || ""), money, timestamp, timestamp],
    );
    const balance = await getBondBalance(account, staffKey, connection);
    await connection.execute(
      `INSERT INTO wallet_transactions
       (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
       VALUES (?, ?, ?, ?, ?, 'bond_recharge', ?, ?, 'system', ?)`,
      [account, FUND_BOND_OWNER_TYPE, staffKey, money, balance, bondNo, `保证金充值 ${money.toFixed(2)} 元`, timestamp],
    );
    return balance;
  });
  return { bondNo, money, bond, mode: "direct", message: "保证金充值成功" };
}

// 保证金汇总（后台「功能 / 保证金」只读）。
// 一条 SQL 出「余额 + 累计充值 + 笔数 + 最后充值时间」—— 用 LEFT JOIN 子查询聚合，
// 不要对每一行再查一次流水（打手几十上百个时 N+1 会把页面拖死）。
// ⚠️ 这里**只读**：保证金是第三本账，本项目没有任何扣减路径（罚单扣的是可用佣金），
//    所以后台只有 GET，没有加减接口 —— 想加"扣保证金"入口之前先读 AGENTS.md §18.4。
const BOND_LIST_LIMIT = 200;

async function listStaffBonds(account, limit = BOND_LIST_LIMIT) {
  const size = clampInt(limit, 1, maxArrayItems, BOND_LIST_LIMIT);
  const [rows] = await getPool().execute(
    `SELECT w.owner_id AS staff_key, w.balance, w.updated_at,
            c.display_name, c.numeric_id,
            COALESCE(t.recharge_total, 0) AS recharge_total,
            COALESCE(t.recharge_count, 0) AS recharge_count,
            t.last_recharge_at
     FROM wallet_accounts w
     LEFT JOIN customers c ON c.customer_key = w.owner_id
     LEFT JOIN (
       SELECT owner_id, SUM(amount) AS recharge_total, COUNT(*) AS recharge_count, MAX(created_at) AS last_recharge_at
       FROM wallet_transactions
       WHERE account = ? AND owner_type = ? AND transaction_type = 'bond_recharge'
       GROUP BY owner_id
     ) t ON t.owner_id = w.owner_id
     WHERE w.account = ? AND w.owner_type = ?
     ORDER BY w.balance DESC, w.updated_at DESC
     LIMIT ${size}`,
    [account, FUND_BOND_OWNER_TYPE, account, FUND_BOND_OWNER_TYPE],
  );
  return rows.map((row) => ({
    staff_key: String(row.staff_key || ""),
    staff_name: String(row.display_name || ""),
    staff_numeric: row.numeric_id == null ? "" : String(row.numeric_id),
    bond: Number(row.balance || 0),
    recharge_total: Number(row.recharge_total || 0),
    recharge_count: Number(row.recharge_count || 0),
    updated_text: shanghaiText(row.updated_at),
    last_recharge_text: shanghaiText(row.last_recharge_at),
  }));
}

// ── 罚单 ──────────────────────────────────────────────────────────────────────
// status 是三态数字（提示词第 6.2 节）：0 待缴 / 1 已缴 / **>=2 一律「已撤销」**。
// 前端只认两条：status === 0 才出「缴纳」按钮；其余按已缴/已撤销显示，不细分撤销原因。
function fineStatusText(status) {
  const value = Number(status || 0);
  if (value === 0) return "待缴";
  if (value === 1) return "已缴";
  return "已撤销";
}

function fineView(row) {
  const status = Number(row.status || 0);
  return {
    id: Number(row.id || 0),
    fine_no: String(row.fine_no || ""),
    status,
    status_text: fineStatusText(status),
    // reason 兜底文案「罚款」（提示词 6.3）。
    reason: String(row.reason || "").trim() || "罚款",
    amount: Number(row.amount || 0),
    fine_time_text: shanghaiText(row.fine_time),
    pay_time_text: shanghaiText(row.pay_time),
    punish_text: String(row.punish_text || ""),
    order_no: String(row.order_no || ""),
    staff_key: String(row.staff_key || ""),
    staff_name: String(row.staff_name || ""),
    staff_numeric: String(row.staff_numeric || ""),
    created_at: Number(row.created_at || 0),
  };
}

function newFineNo() {
  return `FN${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

// 罚单列表。status: -1/缺省 = 全部，0 = 待缴，1 = 已缴，2 = 已撤销。
// ⚠️ 「已撤销」筛选用 `>= 2` 而不是 `= 2` —— 前端的三态判定就是 >=2，筛选用 = 2 会导致
// 以后出现 3（比如"申诉中"的升级态）时这一条在列表里凭空消失。
async function listStaffFines(account, staffKey, { status = -1, page = 1, limit = FINE_LIMIT } = {}) {
  const conditions = ["account = ?"];
  const params = [account];
  if (staffKey) { conditions.push("staff_key = ?"); params.push(staffKey); }
  const wanted = Number(status);
  if (wanted === 0 || wanted === 1) { conditions.push("status = ?"); params.push(wanted); }
  else if (wanted >= 2) conditions.push("status >= 2");
  const size = clampInt(limit, 1, maxArrayItems, FINE_LIMIT);
  const offset = (clampInt(page, 1, 100000, 1) - 1) * size;
  const [rows] = await getPool().execute(
    `SELECT * FROM staff_fines WHERE ${conditions.join(" AND ")}
     ORDER BY fine_time DESC, id DESC LIMIT ${size} OFFSET ${offset}`,
    params,
  );
  return rows.map(fineView);
}

// 商户开罚单。打手身份必须先在后台员工列表里存在（有 staff_grants），否则就是给一个
// 不存在的人开单 —— 他永远看不到，商户也永远收不到。
async function createStaffFine(account, input, operatorAccount) {
  const staffKey = String(input?.staffKey || "").trim();
  if (!staffKey || staffKey.length > 80) throw new Error("请选择要开罚单的打手");
  const amount = Math.round(Number(input?.amount || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error("罚款金额必须大于 0");
  if (amount > FUND_BOND_MAX) throw new Error("罚款金额过大");
  const reason = String(input?.reason || "").trim().slice(0, FINE_REASON_MAX);
  const punishText = String(input?.punishText || "").trim().slice(0, FINE_REASON_MAX);
  const orderNo = String(input?.orderNo || "").trim().slice(0, 64);
  if (!(await hasStaffGrant(account, staffKey))) throw new Error("这个人已经不在员工列表里了，请刷新后重试");
  const [customers] = await getPool().execute(
    "SELECT numeric_id, display_name FROM customers WHERE customer_key = ?",
    [staffKey],
  );
  const fineNo = newFineNo();
  const timestamp = now();
  await getPool().execute(
    `INSERT INTO staff_fines
     (account, fine_no, staff_key, staff_name, staff_numeric, amount, reason, punish_text, order_no,
      status, fine_time, pay_time, revoke_reason, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, '', ?, ?, ?)`,
    [
      account, fineNo, staffKey, String(customers[0]?.display_name || ""),
      customers[0]?.numeric_id == null ? "" : String(customers[0].numeric_id),
      amount, reason, punishText, orderNo, timestamp, String(operatorAccount || ""), timestamp, timestamp,
    ],
  );
  return fineView({
    fine_no: fineNo, staff_key: staffKey, staff_name: String(customers[0]?.display_name || ""),
    staff_numeric: customers[0]?.numeric_id == null ? "" : String(customers[0].numeric_id),
    amount, reason, punish_text: punishText, order_no: orderNo, status: 0,
    fine_time: timestamp, pay_time: null, created_at: timestamp,
  });
}

// 撤销罚单。**只能撤还没交的** —— 已经交过钱的罚单要退钱，那是另一条资金路径
// （本项目目前没有打手侧退款接口，提示词第 9 节也明确"这套接口里不存在退款/冲正"），
// 硬撤会让罚单显示"已撤销"但钱已经扣了，账对不上。所以这里直接拦住。
async function revokeStaffFine(account, fineNo, reason, operatorAccount) {
  const revokeReason = String(reason || "").trim().slice(0, FINE_REASON_MAX);
  return runTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT * FROM staff_fines WHERE account = ? AND fine_no = ? FOR UPDATE",
      [account, fineNo],
    );
    const row = rows[0];
    if (!row) throw new Error("罚单不存在");
    const status = Number(row.status || 0);
    if (status >= 2) throw new Error("这张罚单已经撤销过了");
    if (status === 1) throw new Error("这张罚单已经缴纳过了，撤销要先退钱，暂不支持");
    const timestamp = now();
    await connection.execute(
      "UPDATE staff_fines SET status = 2, revoke_reason = ?, updated_at = ? WHERE account = ? AND fine_no = ?",
      [revokeReason, timestamp, account, fineNo],
    );
    return fineView({ ...row, status: 2, revoke_reason: revokeReason });
  });
}

// 打手缴罚款。**从「可用佣金」扣**，不碰保证金、不碰冻结佣金。
// 并发兜底：FOR UPDATE 锁住这一行 + 状态必须还是 0，重复点/网络重试第二次进来直接判"已处理"，
// 不会出现"扣两次钱"。扣款走 debitStaffWallet（余额不足会抛错并整体回滚）。
async function payStaffFine(account, staffKey, fineNo, input) {
  const result = await runTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT * FROM staff_fines WHERE account = ? AND staff_key = ? AND fine_no = ? FOR UPDATE",
      [account, staffKey, fineNo],
    );
    const row = rows[0];
    if (!row) throw new Error("罚单不存在");
    if (Number(row.status || 0) !== 0) throw new Error("这张罚单已经处理过了");
    const amount = Math.round(Number(row.amount || 0) * 100) / 100;
    if (!(amount > 0)) throw new Error("罚单金额异常，请联系商户");
    const balance = await debitStaffWallet(connection, account, staffKey, amount, {
      transactionType: "fine_payment", referenceNo: fineNo,
      note: `罚款缴纳 ${fineNo}`,
    });
    const timestamp = now();
    await connection.execute(
      "UPDATE staff_fines SET status = 1, pay_time = ?, updated_at = ? WHERE account = ? AND fine_no = ?",
      [timestamp, timestamp, account, fineNo],
    );
    return { amount, available: balance, paidAt: timestamp };
  });
  return { fineNo, ...result, mode: "direct", message: "缴纳成功" };
}

// ── 佣金流水 ──────────────────────────────────────────────────────────────────
// 只取佣金这本账（owner_type='staff'）—— 保证金（staff_bond）的流水不混进来。
// 收支方向由 **amount_text 是否以 "-" 开头** 决定（提示词第 7 / 11 条：不要靠 type 猜）。
// 「完成解冻」就是本项目的结单入账（冻结→可用那一刻），要额外带 goods_name。
const COMMISSION_TYPE_TEXT = {
  order_commission: "完成解冻",
  withdraw_apply: "提现",
  withdraw_refund: "提现驳回退回",
  fine_payment: "罚款",
  steward_commission: "下级提现抽成",
  // 后台加余额现在只进客户钱包，但历史上（2026-09-14）有过误入打手钱包的记录，
  // 冲正后两条要成对留痕，别显示成「其他」。
  merchant_credit: "后台加款",
  merchant_credit_reversal: "后台冲正",
};

function commissionAmountText(amount) {
  const value = Math.round(Number(amount || 0) * 100) / 100;
  return `${value < 0 ? "-" : ""}${Math.abs(value).toFixed(2)}`;
}

async function orderGoodsNameMap(account, orderNos) {
  const map = new Map();
  if (!orderNos.length) return map;
  const [rows] = await getPool().execute(
    `SELECT order_no, payload FROM orders WHERE account = ? AND order_no IN (${orderNos.map(() => "?").join(",")})`,
    [account, ...orderNos],
  );
  for (const row of rows) {
    const order = jsonParse(row.payload, {});
    map.set(String(row.order_no || ""), String(order.product || ""));
  }
  return map;
}

async function fineReasonMap(account, fineNos) {
  const map = new Map();
  if (!fineNos.length) return map;
  const [rows] = await getPool().execute(
    `SELECT fine_no, reason FROM staff_fines WHERE account = ? AND fine_no IN (${fineNos.map(() => "?").join(",")})`,
    [account, ...fineNos],
  );
  for (const row of rows) {
    map.set(String(row.fine_no || ""), String(row.reason || "").trim() || "罚款");
  }
  return map;
}

async function staffCommissionLog(account, staffKey, { page = 1, limit = FINE_LIMIT } = {}) {
  const size = clampInt(limit, 1, maxArrayItems, FINE_LIMIT);
  const offset = (clampInt(page, 1, 100000, 1) - 1) * size;
  const [rows] = await getPool().execute(
    `SELECT id, amount, balance_after, transaction_type, reference_no, created_at
     FROM wallet_transactions
     WHERE account = ? AND owner_type = 'staff' AND owner_id = ?
     ORDER BY created_at DESC, id DESC LIMIT ${size} OFFSET ${offset}`,
    [account, staffKey],
  );
  const orderNos = [...new Set(rows.filter((row) => row.transaction_type === "order_commission")
    .map((row) => String(row.reference_no || "")).filter(Boolean))];
  const fineNos = [...new Set(rows.filter((row) => row.transaction_type === "fine_payment")
    .map((row) => String(row.reference_no || "")).filter(Boolean))];
  const [goodsNames, fineReasons] = await Promise.all([
    orderGoodsNameMap(account, orderNos),
    fineReasonMap(account, fineNos),
  ]);
  return rows.map((row) => {
    const type = String(row.transaction_type || "");
    const referenceNo = String(row.reference_no || "");
    return {
      id: Number(row.id || 0),
      type,
      type_text: COMMISSION_TYPE_TEXT[type] || "其他",
      amount_text: commissionAmountText(row.amount),
      available_after: Number(row.balance_after || 0),
      goods_name: goodsNames.get(referenceNo) || "",
      fine_reason: fineReasons.get(referenceNo) || "",
      createtime: Number(row.created_at || 0),
      // 时间同样由服务端格式化：前端一行日期代码都不写（提示词第 8 / 11 节）。
      // createtime 原样保留，前端拿不到 _text 时可以退回自己格式化。
      createtime_text: shanghaiText(row.created_at),
    };
  });
}

// ---------- 微信支付：真实充值 / 真实订单付款 ----------
// 统一原则：金额、客户、用途一律以服务端落库的 payment_intents 为准；小程序里
// wx.requestPayment 成功只代表"可能付了"，真正入账以微信回调或主动查单为准。

function yuanToFen(value) {
  return Math.round(Number(value || 0) * 100);
}

function fenToYuan(fen) {
  const total = Math.max(0, Math.floor(Number(fen) || 0));
  return `${Math.floor(total / 100)}.${String(total % 100).padStart(2, "0")}`;
}

// out_trade_no 上限 32 位。充值单号同时充当幂等回执 id（重复回调只入账一次）。
function newPaymentTradeNo(prefix) {
  return `${prefix}${Date.now()}${crypto.randomBytes(6).toString("hex")}`;
}

function orderTradeNo(orderNo) {
  const text = String(orderNo || "");
  return isSafeOrderNo(text) && text.length <= 32 ? text : newPaymentTradeNo("OD");
}

async function createPaymentIntent(account, customerKey, { purpose, referenceNo = "", amountFen, tradeNo, payload = {} }) {
  // 同一个单号重复下单（用户关掉支付又重开）复用同一条意图，不能重复建单。
  await getPool().execute(
    `INSERT INTO payment_intents (trade_no, account, customer_key, purpose, reference_no, amount_fen, status, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON DUPLICATE KEY UPDATE payload = IF(status = 'paid', payload, VALUES(payload))`,
    [tradeNo, account, customerKey, purpose, referenceNo, amountFen, JSON.stringify(payload), now()],
  );
}

async function loadPaymentIntent(account, tradeNo, executor = getPool()) {
  const [rows] = await executor.execute(
    "SELECT trade_no, account, customer_key, purpose, reference_no, amount_fen, status, transaction_id FROM payment_intents WHERE account = ? AND trade_no = ?",
    [account, tradeNo],
  );
  return rows[0] || null;
}

async function findPaymentAccount(tradeNo) {
  const [rows] = await getPool().execute("SELECT trade_no, account FROM payment_intents WHERE trade_no = ?", [tradeNo]);
  return rows[0] || null;
}

// 订单支付成功：把待付款订单改成已支付。重复回调只会命中已支付分支，不会重复推进状态。
async function markOrderPaid(connection, account, orderNo, transactionId = "") {
  const [rows] = await connection.execute(
    "SELECT customer_id, payload FROM orders WHERE account = ? AND order_no = ? LIMIT 1 FOR UPDATE",
    [account, orderNo],
  );
  if (!rows[0]) throw new Error("订单不存在，无法确认支付");
  const order = jsonParse(rows[0].payload, {}) || {};
  if (order.paymentStatus === "paid") return order;
  order.paymentMethod = "wechat";
  order.paymentStatus = "paid";
  order.channel = "微信支付";
  order.paidAt = now();
  order.transactionId = String(transactionId || "");
  order.status = order.lottery && order.lottery.status === "pending" ? "待抽奖" : "待接单";
  await connection.execute(
    "UPDATE orders SET payload = ? WHERE account = ? AND order_no = ?",
    [JSON.stringify(order), account, orderNo],
  );
  return order;
}

// 回调与查单共用的核销入口：金额必须一致，且只核销一次。
async function settlePaymentIntent(account, tradeNo, transaction) {
  const paidFen = Number(transaction?.amount?.total ?? 0);
  const transactionId = String(transaction?.transaction_id || "");
  return runTransaction(async (connection) => {
    const [rows] = await connection.execute(
      "SELECT trade_no, customer_key, purpose, reference_no, amount_fen, status FROM payment_intents WHERE account = ? AND trade_no = ? FOR UPDATE",
      [account, tradeNo],
    );
    const intent = rows[0];
    if (!intent) throw new Error("这不是本商户发起的支付单，已忽略");
    const amount = fenToYuan(intent.amount_fen);
    if (intent.status === "paid") {
      return {
        alreadySettled: true, purpose: String(intent.purpose), referenceNo: String(intent.reference_no),
        amount, wallet: await getCustomerWallet(account, intent.customer_key, connection), order: null,
      };
    }
    if (paidFen !== Number(intent.amount_fen)) {
      throw new Error(`支付金额 ¥${fenToYuan(paidFen)} 与下单金额 ¥${amount} 不一致，已拒绝入账`);
    }
    let wallet = null;
    let order = null;
    if (intent.purpose === "recharge") {
      // 复用后台加款同一条幂等链路：回执存在就直接返回，绝不重复入账。
      const credit = normalizeCredit(account, "wechat_pay", {
        requestId: String(intent.trade_no),
        ownerType: "customer",
        ownerId: String(intent.customer_key),
        amount,
        note: "微信支付充值",
      });
      credit.transactionType = "customer_recharge";
      wallet = await applyCredit(connection, account, "wechat_pay", credit,
        () => resolveWalletOwner(account, "customer", String(intent.customer_key), "", connection));
    } else {
      order = await markOrderPaid(connection, account, String(intent.reference_no), transactionId);
    }
    await connection.execute(
      "UPDATE payment_intents SET status = 'paid', transaction_id = ?, paid_at = ? WHERE account = ? AND trade_no = ?",
      [transactionId || null, now(), account, tradeNo],
    );
    return { alreadySettled: false, purpose: String(intent.purpose), referenceNo: String(intent.reference_no), amount, wallet, order };
  });
}

function refundAmountFen(order) {
  const value = Number(order.price);
  const fen = yuanToFen(value);
  if (!Number.isFinite(value) || !Number.isSafeInteger(fen) || fen < 1 || Math.abs(value * 100 - fen) > 0.001) {
    throw new Error("订单金额无效，无法自动退款");
  }
  return fen;
}

async function applyWechatRefundState(account, orderNo, remote) {
  return runTransaction(async (connection) => {
    const record = await getOrderRecord(account, orderNo, connection, true);
    if (!record?.payload.refund || record.payload.refund.method !== "wechat") throw new Error("退款记录不存在");
    const order = { ...record.payload };
    const refund = { ...order.refund };
    if (String(remote.out_refund_no || "") !== refund.outRefundNo
      || String(remote.out_trade_no || "") !== refund.tradeNo
      || Number(remote.amount?.refund) !== refund.amountFen
      || Number(remote.amount?.total) !== refund.amountFen) throw new Error("微信退款单号或金额与本地记录不一致");
    const state = String(remote.status || "");
    if (!["SUCCESS", "PROCESSING", "ABNORMAL", "CLOSED"].includes(state)) throw new Error("微信返回了未知退款状态，订单已锁定，请核对");
    if (order.paymentStatus === "refunded") return order;
    refund.status = state;
    refund.lastCheckedAt = now();
    if (state === "SUCCESS") {
      order.paymentStatus = "refunded";
      order.status = "已退款";
      refund.completedAt = now();
    } else if (state === "CLOSED") {
      order.paymentStatus = "refund_closed";
      order.status = "退款失败";
    } else {
      order.paymentStatus = "refund_pending";
      order.status = state === "ABNORMAL" ? "退款异常" : "退款中";
    }
    order.refund = refund;
    await updateOrderPayloadById(record.id, order, connection);
    return order;
  });
}

async function reconcileWechatRefund(account, orderNo, config = wechatPay.wechatPayConfig()) {
  const record = await getOrderRecord(account, orderNo);
  if (!record?.payload.refund?.outRefundNo) throw new Error("退款记录不存在");
  if (record.payload.paymentStatus === "refunded" || record.payload.paymentStatus === "refund_closed") return record.payload;
  const remote = await wechatPay.queryRefund(config, record.payload.refund.outRefundNo);
  return applyWechatRefundState(account, orderNo, remote);
}

async function customerOpenid(customerKey, executor = getPool()) {
  const [rows] = await executor.execute("SELECT openid FROM customers WHERE customer_key = ?", [customerKey]);
  return String(rows[0]?.openid || "");
}

// 向微信下单失败时不能留下悬空的支付意图，否则对账时会对不上、也可能被重复核销。
async function createPrepayOrCleanup(account, tradeNo, config, params) {
  try {
    return await wechatPay.createJsapiPrepay(config, params);
  } catch (error) {
    await getPool().execute(
      "DELETE FROM payment_intents WHERE account = ? AND trade_no = ? AND status = 'pending'",
      [account, tradeNo],
    ).catch(() => {});
    throw error;
  }
}

async function createRechargePayment(account, customerId, input, config) {
  const amount = normalizeWalletAmount(input?.amount);
  if (!amount) throw new Error("充值金额需大于 0，且不超过 1000000 元");
  const identity = await ensureCustomerIdentity(customerId);
  const openid = await customerOpenid(identity.customerId);
  if (!openid) {
    throw new wechatPay.WechatPayError("微信支付需要小程序内的微信登录，请退出小程序重新进入后再试", { status: 400, code: "OPENID_REQUIRED" });
  }
  const tradeNo = newPaymentTradeNo("CZ");
  await createPaymentIntent(account, identity.customerId, {
    purpose: "recharge", amountFen: yuanToFen(amount), tradeNo, payload: { amount },
  });
  const { payment } = await createPrepayOrCleanup(account, tradeNo, config, {
    outTradeNo: tradeNo, amountFen: yuanToFen(amount), description: "会员余额充值", openid, attach: "recharge",
  });
  return { tradeNo, amount, payment };
}

async function createOrderPayment(account, order, config) {
  const openid = await customerOpenid(order.customerId);
  if (!openid) {
    throw new wechatPay.WechatPayError("微信支付需要小程序内的微信登录，请退出小程序重新进入后再试", { status: 400, code: "OPENID_REQUIRED" });
  }
  const amountFen = yuanToFen(order.price);
  if (amountFen < 1) throw new wechatPay.WechatPayError("订单金额异常，无法发起微信支付", { status: 400 });
  const tradeNo = orderTradeNo(order.no);
  await createPaymentIntent(account, order.customerId, {
    purpose: "order", referenceNo: String(order.no), amountFen, tradeNo,
    payload: { productId: order.productId, quantity: order.quantity },
  });
  const { payment } = await createPrepayOrCleanup(account, tradeNo, config, {
    outTradeNo: tradeNo, amountFen, description: String(order.product || "订单支付").slice(0, 100), openid, attach: "order", expiresAt: order.paymentExpiresAt,
  });
  return { tradeNo, amountFen, payment };
}

async function registerMerchantCustomer(account, customerId, executor = getPool()) {
  if (!isSafeAccount(account)) return;
  await executor.execute(
    `INSERT INTO merchant_customers (account, customer_key, first_login_at, last_login_at)
     SELECT account, ?, ?, ? FROM merchants WHERE account = ? AND status = 'active'
     ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at)`,
    [customerId, now(), now(), account],
  );
}

async function searchMerchantCustomers(account, keyword, executor = getPool()) {
  const search = String(keyword || "").trim().slice(0, 80);
  const pattern = `%${search.replace(/[!%_]/g, "!$&")}%`;
  const [rows] = await executor.execute(
    `SELECT c.customer_key, c.numeric_id, c.display_name
     FROM customers c
     WHERE (EXISTS (SELECT 1 FROM merchant_customers m WHERE m.account = ? AND m.customer_key = c.customer_key)
       OR EXISTS (SELECT 1 FROM orders o WHERE o.account = ? AND o.customer_id = c.customer_key)
       OR EXISTS (SELECT 1 FROM wallet_accounts w WHERE w.account = ? AND w.owner_id = c.customer_key)
       OR EXISTS (SELECT 1 FROM staff_grants s WHERE s.account = ? AND s.customer_key = c.customer_key))
       AND (CAST(c.numeric_id AS CHAR) LIKE ? ESCAPE '!' OR c.display_name LIKE ? ESCAPE '!' OR c.customer_key LIKE ? ESCAPE '!')
     ORDER BY (CAST(c.numeric_id AS CHAR) = ?) DESC, c.updated_at DESC, c.customer_key
     LIMIT 100`,
    [account, account, account, account, pattern, pattern, pattern, search],
  );
  return rows.map((row) => ({ customerId: String(row.customer_key), numericId: String(row.numeric_id), displayName: String(row.display_name || "") }));
}

async function resolveWalletOwner(account, ownerType, ownerId, requestedName, executor = getPool()) {
  if (ownerType === "customer") {
    // 1) 下过单的客户。沿用原查询：早期订单可能没有对应的 customers 行，仍按订单认人。
    const [rows] = await executor.execute(
      `SELECT c.display_name AS displayName
       FROM orders o
       LEFT JOIN customers c ON c.customer_key = o.customer_id
       WHERE o.account = ? AND o.customer_id = ?
       ORDER BY o.created_at DESC, o.id DESC LIMIT 1`,
      [account, ownerId],
    );
    if (rows[0]) return String(rows[0].displayName || requestedName || "微信客户").slice(0, 80);
    // 2) 还没下单、但在本商户已经有客户钱包的客户（例如先充值后下单）。
    //    同样要求与该商户有关联，租户隔离不放宽。
    const [walleted] = await executor.execute(
      `SELECT c.display_name AS displayName
       FROM wallet_accounts w JOIN customers c ON c.customer_key = w.owner_id
       WHERE w.account = ? AND w.owner_type = 'customer' AND w.owner_id = ?
       LIMIT 1`,
      [account, ownerId],
    );
    if (walleted[0]) return String(walleted[0].displayName || requestedName || "微信客户").slice(0, 80);
    const [registered] = await executor.execute(
      "SELECT c.display_name FROM merchant_customers m JOIN customers c ON c.customer_key = m.customer_key WHERE m.account = ? AND m.customer_key = ?",
      [account, ownerId],
    );
    if (registered[0]) return String(registered[0].display_name || requestedName || "微信客户").slice(0, 80);
    // Authorized staff are also customers; keep the merchant association check
    // while crediting their customer wallet, even before their first order.
    const [authorized] = await executor.execute(
      "SELECT c.display_name FROM staff_grants s JOIN customers c ON c.customer_key = s.customer_key WHERE s.account = ? AND s.customer_key = ?",
      [account, ownerId],
    );
    if (authorized[0]) return String(authorized[0].display_name || requestedName || "微信客户").slice(0, 80);
    throw new Error("这个客户不属于当前商户");
  }

  const [grants] = await executor.execute(
    "SELECT c.display_name FROM staff_grants s JOIN customers c ON c.customer_key = s.customer_key WHERE s.account = ? AND s.customer_key = ?",
    [account, ownerId],
  );
  if (grants[0]) return String(grants[0].display_name).slice(0, 80);
  const config = await getConfig(account, executor) || {};
  const configuredStaff = Array.isArray(config.staffGrabbers) ? config.staffGrabbers : [];
  const orders = await getOrders(account, executor);
  const knownStaff = configuredStaff.some((item) => String(item?.name || "") === ownerId)
    || orders.some((order) => String(order?.staffId || "") === ownerId || String(order?.staff || "") === ownerId);
  if (!knownStaff) throw new Error("这个打手不属于当前商户");
  return String(requestedName || ownerId).slice(0, 80);
}

// 后台加余额只有「客户」一种身份。现实中同一个人可能既是客户又是打手（有 staff_grants），
// 旧逻辑允许把后台加的余额记进打手钱包，结果钱进了打手账户，客户在小程序里看到的是 0，
// 对账时就像"加了钱但没到账"。这里统一收口到 owner_type='customer'（客户钱包）；
// 打手钱包只保留打手端自己产生的流水，后台不再写入。
// 幂等指纹在 normalizeCredit 里按收口后的 ownerType 计算，重试语义不变。
async function creditWallet(account, operatorAccount, input) {
  const credit = normalizeCredit(account, operatorAccount, { ...input, ownerType: "customer" });
  return runTransaction((connection) => applyCredit(connection, account, operatorAccount, credit,
    () => resolveWalletOwner(account, credit.ownerType, credit.ownerId, input?.displayName, connection)));
}

async function replaceOrders(account, orders) {
  await runTransaction(async (connection) => {
    await connection.execute("DELETE FROM orders WHERE account = ?", [account]);
    const timestamp = now();
    for (const [index, item] of orders.slice(0, maxArrayItems).entries()) {
      await connection.execute(
        "INSERT INTO orders (account, order_no, customer_id, payload, created_at) VALUES (?, ?, ?, ?, ?)",
        [account, String(item?.no || `DD${timestamp}${index}`), isSafeCustomerId(item?.customerId) ? item.customerId : null, JSON.stringify(item || {}), timestamp - index],
      );
    }
  });
}

async function getLogs(account) {
  const [rows] = await getPool().execute(
    `SELECT payload FROM logs WHERE account = ? ORDER BY created_at DESC, id DESC LIMIT ${maxArrayItems}`,
    [account],
  );
  return rows.map((row) => jsonParse(row.payload, {}));
}

async function replaceLogs(account, logs) {
  await runTransaction(async (connection) => {
    await connection.execute("DELETE FROM logs WHERE account = ?", [account]);
    const timestamp = now();
    for (const [index, item] of logs.slice(0, maxArrayItems).entries()) {
      await connection.execute(
        "INSERT INTO logs (account, payload, created_at) VALUES (?, ?, ?)",
        [account, JSON.stringify(item || {}), timestamp - index],
      );
    }
  });
}

function sanitizePublicConfig(value) {
  if (Array.isArray(value)) return value.map(sanitizePublicConfig);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(password|secret|private.?key|access.?token|api.?key)/i.test(key)) continue;
    if (key === "broadcasts" || key === "homeBroadcasts") continue;
    result[key] = sanitizePublicConfig(item);
  }
  return result;
}

function configuredServerNames(source) {
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => (typeof item === "string" ? { name: item, enabled: true } : item))
    .filter((item) => item && item.enabled !== false && String(item.name || "").trim())
    .map((item) => String(item.name).trim());
}

function allowedServersForProduct(config, productId) {
  const products = Array.isArray(config?.products) ? config.products : [];
  const product = products.find((item) => String(item?.id) === String(productId || ""));
  const tree = Array.isArray(config?.categoryTree) ? config.categoryTree : [];
  const group = tree.find((item) => item && String(item.name) === String(product?.mainCategory || ""));
  const categoryServers = configuredServerNames(group?.gameServers);
  if (categoryServers.length) return categoryServers;
  const productServers = configuredServerNames(product?.gameServers);
  if (productServers.length) return productServers;
  return configuredServerNames(config?.gameServers);
}

// Staff commission is derived from the merchant's product configuration only.
// Client-supplied staffShare/staffIncome values are never trusted.
function configuredStaffShare(product, totalPrice) {
  const fixed = Number(product?.staffShare);
  if (Number.isFinite(fixed) && fixed > 0) return Math.min(Math.round(fixed * 100) / 100, totalPrice);
  const text = String(product?.staffShareText || product?.share || "");
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Math.min(Number((totalPrice * Number(percentMatch[1]) / 100).toFixed(2)), totalPrice);
  const moneyMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (moneyMatch) return Math.min(Number(Number(moneyMatch[1]).toFixed(2)), totalPrice);
  return Number((totalPrice * 0.7).toFixed(2));
}

function applyConfiguredProductPricing(config, order) {
  const products = Array.isArray(config?.products) ? config.products : [];
  const product = products.find((item) => String(item?.id) === String(order.productId || ""));
  if (!product || product.status === "hidden") throw new Error("商品不存在或已下架，请刷新后重试");
  const unitPrice = Math.max(0, Math.min(Number(product.orderPrice ?? product.price ?? 0), 1000000));
  const displayPrice = Math.max(0, Math.min(Number(product.price ?? unitPrice), 1000000));
  if (!Number.isFinite(unitPrice)) throw new Error("商品价格配置无效");
  order.product = String(product.orderTitle || product.title || order.product || "订单商品").slice(0, 500);
  order.unitPrice = Math.round(unitPrice * 100) / 100;
  order.displayPrice = Math.round(displayPrice * 100) / 100;
  order.price = Math.round(order.unitPrice * order.quantity * 100) / 100;
  order.increasePrice = Math.max(0, Math.round((order.unitPrice - order.displayPrice) * 100) / 100);
  order.staffShare = configuredStaffShare(product, order.price);
  order.staffIncome = order.staffShare;
  return product;
}

function lotteryForProduct(config, productId, quantity) {
  const products = Array.isArray(config?.products) ? config.products : [];
  const product = products.find((item) => String(item?.id) === String(productId || ""));
  if (!product?.lotteryEnabled) return null;
  const pool = normalizeLotteryPools(config?.lotteryPools).find((item) => item.id === product.lotteryPoolId && item.enabled);
  if (!pool?.prizes?.length) throw new Error("该抽奖商品尚未配置可用奖池，请联系商户");
  const prizes = pool.prizes.filter((prize) => prize.productIds.includes(String(product.id)));
  if (!prizes.length) throw new Error("该抽奖商品尚未关联奖品，请联系商户");
  return {
    poolId: pool.id,
    poolName: pool.name,
    totalDraws: Math.max(1, Math.min(99, Number(quantity || 1))),
    completedDraws: 0,
    status: "pending",
    prizes: prizes.map((prize) => ({ ...prize })),
    results: [],
  };
}

function drawLotteryPrize(prizes) {
  const normalized = Array.isArray(prizes) ? prizes.filter((prize) => prize?.name && Number(prize.weight) > 0) : [];
  if (!normalized.length) throw new Error("该订单的奖池没有可抽取奖品");
  const units = normalized.map((prize) => Math.max(1, Math.round(Number(prize.weight) * 100)));
  const totalWeight = units.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight >= 2 ** 48) throw new Error("奖品概率配置无效");
  let cursor = crypto.randomInt(totalWeight);
  for (let index = 0; index < normalized.length; index++) {
    cursor -= units[index];
    if (cursor < 0) return normalized[index];
  }
  return normalized[normalized.length - 1];
}

function publicOrder(input, account) {
  // staffShare/staffIncome/paymentStatus are deliberately NOT accepted from the client;
  // they are recomputed by the server from the merchant's product configuration.
  const allowed = ["no", "merchant", "customerId", "productId", "product", "price", "unitPrice", "displayPrice", "increasePrice", "quantity", "status", "channel", "paymentMethod", "staff", "receiveMode", "gameName", "gameId", "server", "remark", "time"];
  const order = {};
  for (const key of allowed) {
    if (["string", "number"].includes(typeof input?.[key])) order[key] = input[key];
  }
  order.no = String(order.no || `DD${crypto.randomBytes(16).toString("hex")}`);
  if (!isSafeOrderNo(order.no)) throw new Error("订单编号格式无效");
  order.merchant = account;
  if (!isSafeCustomerId(order.customerId)) throw new Error("客户设备标识无效，请重新进入小程序");
  order.price = Math.max(0, Math.min(Number(order.price || 0), 1000000));
  order.unitPrice = Math.max(0, Math.min(Number(order.unitPrice || order.price), 1000000));
  order.displayPrice = Math.max(0, Math.min(Number(order.displayPrice || order.unitPrice), 1000000));
  order.increasePrice = Math.max(0, Math.min(Number(order.increasePrice || 0), 1000000));
  order.quantity = Number(order.quantity ?? 1);
  if (!Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > 99) throw new Error("下单数量必须为 1 到 99 的整数");
  order.status = "待付款";
  order.time = new Date().toLocaleString("zh-CN", { hour12: false });
  for (const key of ["product", "channel", "staff", "receiveMode", "gameName", "gameId", "server", "remark"]) {
    order[key] = String(order[key] || "").slice(0, 500);
  }
  order.paymentMethod = input?.paymentMethod === "balance" ? "balance" : "wechat";
  order.paymentStatus = "pending";
  order.paymentExpiresAt = now() + PAYMENT_WINDOW_MS;
  order.channel = order.paymentMethod === "balance" ? "余额支付" : (order.channel || "微信支付");
  if (hasUnsafeContent(order)) throw new Error("提交内容包含不允许的字符");
  return order;
}

async function ownerBootstrap() {
  const merchants = await getActiveMerchants();
  const configs = {};
  const orders = {};
  const logs = {};
  await Promise.all(merchants.map(async (merchant) => {
    const account = merchant.account;
    [configs[account], orders[account], logs[account]] = await Promise.all([getConfig(account), getOrders(account), getLogs(account)]);
    configs[account] ||= {};
  }));
  return { merchants: merchants.map(publicMerchant), configs, orders, logs };
}

async function merchantBootstrap(account) {
  const [rows] = await getPool().execute("SELECT account, club_name FROM merchants WHERE account = ? AND status = 'active'", [account]);
  const [config, orders, logs] = await Promise.all([getConfig(account), getOrders(account), getLogs(account)]);
  return {
    merchants: rows[0] ? [publicMerchant(rows[0])] : [],
    configs: { [account]: config || {} },
    orders: { [account]: orders },
    logs: { [account]: logs },
  };
}

const annotationMaxNotes = 200;

function readAnnotationNotes() {
  try {
    const list = JSON.parse(fs.readFileSync(annotationFile, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAnnotationNotes(notes) {
  fs.mkdirSync(path.dirname(annotationFile), { recursive: true });
  const temporary = `${annotationFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(notes, null, 2), "utf8");
  fs.renameSync(temporary, annotationFile);
}

const annotationMaxBatches = 50;
const annotationBatchPattern = /^b-[A-Za-z0-9_-]{1,40}$/;

function newAnnotationBatchId() {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function readAnnotationInbox() {
  try {
    const list = JSON.parse(fs.readFileSync(annotationInboxFile, "utf8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAnnotationInbox(batches) {
  fs.mkdirSync(path.dirname(annotationInboxFile), { recursive: true });
  const temporary = `${annotationInboxFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(batches, null, 2), "utf8");
  fs.renameSync(temporary, annotationInboxFile);
}

function annotationBatchSummary(batch) {
  return {
    id: batch.id,
    page: batch.scope,
    count: batch.count,
    createdAt: batch.createdAt,
    status: batch.status || "pending",
    ackedAt: batch.ackedAt || null,
  };
}

function markAnnotationBatch(batches, id, status) {
  const now = new Date().toISOString();
  let updated = 0;
  for (const batch of batches) {
    const hit = id === "all" ? batch.status !== status : batch.id === id;
    if (!hit) continue;
    batch.status = status;
    batch.ackedAt = status === "ack" ? now : null;
    updated += 1;
  }
  return updated;
}

function sanitizeAnnotation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (value, limit) => String(value == null ? "" : value).slice(0, limit);
  const id = text(raw.id, 64);
  const comment = text(raw.comment, 1000).trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !comment) return null;
  const round = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);
  const rect = raw.rect && typeof raw.rect === "object" ? raw.rect : {};
  const viewport = raw.viewport && typeof raw.viewport === "object" ? raw.viewport : {};
  const attrs = {};
  if (raw.attrs && typeof raw.attrs === "object") {
    for (const [key, value] of Object.entries(raw.attrs).slice(0, 8)) attrs[text(key, 60)] = text(value, 120);
  }
  // 客户端重新上传已发送过的批注时，保留它的投递标记，别把「已发送」状态抹掉
  const submittedAt = text(raw.submittedAt, 40);
  const batchId = text(raw.batchId, 64);
  return {
    id,
    comment,
    page: text(raw.page, 80) || "admin.html",
    url: text(raw.url, 300),
    selector: text(raw.selector, 400),
    tag: text(raw.tag, 40),
    classes: text(raw.classes, 200),
    text: text(raw.text, 200),
    html: text(raw.html, 600),
    attrs,
    rect: { x: round(rect.x), y: round(rect.y), w: round(rect.w), h: round(rect.h) },
    viewport: { w: round(viewport.w), h: round(viewport.h) },
    createdAt: text(raw.createdAt, 40) || new Date().toISOString(),
    ...(submittedAt ? { submittedAt } : {}),
    ...(annotationBatchPattern.test(batchId) ? { batchId } : {}),
  };
}

// 写入一条批注。已发送过的批注被重新上传时保留它的投递标记：
// 「保存并发送」会同时发出"上传批注"和"发送批次"两个请求，后到的上传若把
// batchId 抹掉，收件箱里的那条就会变成"孤儿"，页面上也不显示已发送。
function upsertAnnotation(notes, note) {
  const index = notes.findIndex((item) => item.id === note.id);
  if (index < 0) {
    notes.push(note);
    return;
  }
  const previous = notes[index];
  const merged = {
    ...note,
    batchId: note.batchId || previous.batchId,
    submittedAt: note.submittedAt || previous.submittedAt,
  };
  if (!merged.batchId) delete merged.batchId;
  if (!merged.submittedAt) delete merged.submittedAt;
  notes[index] = merged;
}

async function handleApi(req, res, urlPath) {
  if (!["GET", "HEAD"].includes(req.method || "GET") && !isSameOrigin(req)) {
    return sendJson(res, { ok: false, message: "请求来源校验失败" }, 403);
  }

  if (productionRouteBlock(req.method, urlPath, isProduction, allowPublicTrade)) {
    return sendJson(res, { ok: false, code: "SERVICE_NOT_READY", message: "客户交易服务尚未完成安全验收，暂未开放" }, 503);
  }

  if (req.method === "GET" && urlPath === "/api/health") {
    await getPool().query("SELECT 1");
    return sendJson(res, { ok: true, database: "mysql", ...(!isProduction ? { databaseName } : {}), time: new Date().toISOString() });
  }

  if (urlPath === "/api/dev-annotations") {
    if (!annotationsEnabled) {
      // 生产环境默认关闭：前端探测到 enabled=false 后不会构建批注 UI
      if (req.method === "GET" || req.method === "HEAD") return sendJson(res, { ok: true, enabled: false, notes: [] });
      return sendJson(res, { ok: false, message: "接口不存在" }, 404);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      return sendJson(res, {
        ok: true,
        enabled: true,
        notes: readAnnotationNotes(),
        batches: readAnnotationInbox().map(annotationBatchSummary),
      });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const incoming = Array.isArray(body.notes) ? body.notes : [body.note];
      const cleaned = incoming.map(sanitizeAnnotation).filter(Boolean);
      if (!cleaned.length) return sendJson(res, { ok: false, message: "批注内容为空" }, 400);
      const notes = readAnnotationNotes();
      for (const note of cleaned) upsertAnnotation(notes, note);
      const kept = notes.slice(-annotationMaxNotes);
      writeAnnotationNotes(kept);
      return sendJson(res, { ok: true, count: kept.length });
    }
    if (req.method === "DELETE") {
      const query = new URLSearchParams(String(req.url || "").split("?")[1] || "");
      const id = query.get("id") || "";
      const page = query.get("page") || "";
      const existing = readAnnotationNotes();
      let notes;
      if (id) {
        notes = existing.filter((note) => note.id !== id);
      } else if (page) {
        // 只清一个页面的批注，避免在客户端清空时误删后台的批注
        if (!/^[A-Za-z0-9._-]{1,80}$/.test(page)) return sendJson(res, { ok: false, message: "页面标识不合法" }, 400);
        notes = existing.filter((note) => note.page !== page);
      } else {
        notes = [];
      }
      writeAnnotationNotes(notes);
      return sendJson(res, { ok: true, count: notes.length });
    }
    return sendJson(res, { ok: false, message: "不支持的请求方法" }, 405);
  }

  // 点「发送给 AI」：把当前页（或全部）批注打包成一条投递记录写进收件箱
  if (urlPath === "/api/dev-annotations/send") {
    if (!annotationsEnabled) return sendJson(res, { ok: false, message: "接口不存在" }, 404);
    if (req.method !== "POST") return sendJson(res, { ok: false, message: "不支持的请求方法" }, 405);
    const body = await readBody(req);
    const scope = String(body.page == null ? "" : body.page).slice(0, 80).trim();
    const ids = (Array.isArray(body.ids) ? body.ids : [])
      .map((value) => String(value).slice(0, 64))
      .filter((value) => /^[A-Za-z0-9_-]{1,64}$/.test(value));
    if (scope && scope !== "all" && !/^[A-Za-z0-9._-]{1,80}$/.test(scope)) {
      return sendJson(res, { ok: false, message: "页面标识不合法" }, 400);
    }
    const notes = readAnnotationNotes();
    // 客户端「保存并发送」是点一下就发的，批注上传和发送会是两个并发请求。
    // 所以发送请求里自带这批批注，先落地再打包，避免"批注还没到就先发送"的空发。
    const provided = (Array.isArray(body.notes) ? body.notes : []).map(sanitizeAnnotation).filter(Boolean);
    for (const note of provided) upsertAnnotation(notes, note);
    const targets = ids.length
      ? notes.filter((note) => ids.includes(note.id))
      : (scope && scope !== "all" ? notes.filter((note) => note.page === scope) : notes.slice());
    if (!targets.length) return sendJson(res, { ok: false, message: "这一页还没有批注" }, 400);
    const now = new Date().toISOString();
    const batch = {
      id: newAnnotationBatchId(),
      scope: scope || "all",
      createdAt: now,
      count: targets.length,
      status: "pending",
      ackedAt: null,
      noteIds: targets.map((note) => note.id),
      notes: targets,
    };
    const targetIds = new Set(batch.noteIds);
    const marked = notes.map((note) => (targetIds.has(note.id) ? { ...note, submittedAt: now, batchId: batch.id } : note));
    writeAnnotationNotes(marked.slice(-annotationMaxNotes));
    const batches = readAnnotationInbox();
    batches.push(batch);
    writeAnnotationInbox(batches.slice(-annotationMaxBatches));
    return sendJson(res, { ok: true, batch: annotationBatchSummary(batch) });
  }

  if (urlPath === "/api/dev-annotations/inbox") {
    if (!annotationsEnabled) {
      if (req.method === "GET" || req.method === "HEAD") return sendJson(res, { ok: true, enabled: false, batches: [] });
      return sendJson(res, { ok: false, message: "接口不存在" }, 404);
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const query = new URLSearchParams(String(req.url || "").split("?")[1] || "");
      const batches = readAnnotationInbox();
      const include = query.get("include") || "";
      const wantNotes = include === "notes" || include === "full";
      const payload = batches.map((batch) => (wantNotes
        ? { ...annotationBatchSummary(batch), notes: Array.isArray(batch.notes) ? batch.notes : [] }
        : annotationBatchSummary(batch)));
      return sendJson(res, { ok: true, enabled: true, batches: payload });
    }
    if (req.method === "POST") {
      // 标记某一批（或全部）已处理完毕，页面上的角标会跟着变
      const body = await readBody(req);
      const id = String(body.id || "").slice(0, 64);
      const status = String(body.status || "ack").slice(0, 20);
      if (id !== "all" && !annotationBatchPattern.test(id)) return sendJson(res, { ok: false, message: "批次编号不合法" }, 400);
      if (!["ack", "pending"].includes(status)) return sendJson(res, { ok: false, message: "状态不合法" }, 400);
      const batches = readAnnotationInbox();
      const updated = markAnnotationBatch(batches, id, status);
      if (!updated) return sendJson(res, { ok: false, message: "没有找到这一批" }, 404);
      writeAnnotationInbox(batches);
      return sendJson(res, { ok: true, updated });
    }
    return sendJson(res, { ok: false, message: "不支持的请求方法" }, 405);
  }

  if (urlPath === "/api/dev-annotations/clear") {
    if (!annotationsEnabled) return sendJson(res, { ok: false, message: "接口不存在" }, 404);
    if (req.method !== "POST") return sendJson(res, { ok: false, message: "不支持的请求方法" }, 405);
    const body = await readBody(req);
    const id = String(body.id || "").slice(0, 64);
    if (id !== "all" && !annotationBatchPattern.test(id)) return sendJson(res, { ok: false, message: "批次编号不合法" }, 400);
    const batches = readAnnotationInbox();
    const kept = id === "all" ? [] : batches.filter((batch) => batch.id !== id);
    writeAnnotationInbox(kept);
    return sendJson(res, { ok: true, removed: batches.length - kept.length });
  }

  if (req.method === "POST" && urlPath === "/api/auth/login") {
    if (rateLimited(req)) return sendJson(res, { ok: false, message: "登录尝试过多，请十分钟后再试" }, 429);
    const body = await readBody(req);
    const account = String(body.account || "").trim();
    const password = String(body.password || "");
    const [ownerRows] = await getPool().execute("SELECT account, password_hash FROM admins WHERE account = ? AND status = 'active'", [account]);
    if (ownerRows[0] && verifyPassword(password, ownerRows[0].password_hash)) {
      resetRateLimit(req);
      await createSession(res, "owner", ownerRows[0].account);
      return sendJson(res, { ok: true, role: "owner", account: ownerRows[0].account });
    }
    const [merchantRows] = await getPool().execute("SELECT account, club_name, password_hash FROM merchants WHERE account = ? AND status = 'active'", [account]);
    const merchant = merchantRows[0];
    if (!merchant || !verifyPassword(password, merchant.password_hash)) {
      return sendJson(res, { ok: false, message: "账号或密码错误" }, 401);
    }
    resetRateLimit(req);
    await createSession(res, "merchant", merchant.account);
    return sendJson(res, { ok: true, role: "merchant", account: merchant.account, merchant: publicMerchant(merchant) });
  }

  if (req.method === "POST" && urlPath === "/api/auth/logout") {
    await clearSession(req, res);
    return sendJson(res, { ok: true });
  }

  if (req.method === "GET" && urlPath === "/api/auth/session") {
    const session = await getSession(req);
    if (!session) return sendJson(res, { ok: false }, 401);
    return sendJson(res, { ok: true, role: session.role, account: session.account });
  }

  if (req.method === "POST" && urlPath === "/api/public/customer/session") {
    if (publicLoginRateLimited(req)) return sendJson(res, { ok: false, message: "登录过于频繁，请稍后再试" }, 429);
    const body = await readBody(req);
    try {
      let customer;
      const code = String(body.code || "").trim();
      if (wxAppId && wxSecret) {
        // Real identity path: exchange the wx.login code for an openid on the server.
        if (!code) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "缺少微信登录凭证" }, 400);
        const openid = await exchangeWechatCode(code);
        customer = await ensureCustomerByOpenid(openid);
      } else {
        // Local development only (no WeChat credentials configured). A wx.login code cannot be
        // exchanged without appid/secret, so it is ignored and a stable device identity is issued
        // instead; the client persists the returned customerId and reuses it on later launches.
        if (isProduction) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "服务器未配置微信登录" }, 503);
        const legacyId = String(body.customerId || "").trim();
        customer = await ensureCustomerIdentity(
          isSafeCustomerId(legacyId) ? legacyId : `dev_${crypto.randomBytes(16).toString("hex")}`,
        );
      }
      const token = await issueCustomerSession(customer.customerId);
      const account = String(body.account || "");
      await registerMerchantCustomer(account, customer.customerId);
      const staffGranted = isSafeAccount(account) ? await hasStaffGrant(account, customer.customerId) : false;
      return sendJson(res, { ok: true, customer, token, staffGranted });
    } catch (error) {
      return sendJson(res, { ok: false, message: error.message }, 400);
    }
  }

  // Lets the miniprogram re-check its own staff permission after the merchant grants or revokes it,
  // without forcing a full re-login (the grant flag baked into the session response goes stale).
  const publicStaffGrantMatch = urlPath.match(/^\/api\/public\/customer\/grant\/([^/]+)$/);
  if (req.method === "GET" && publicStaffGrantMatch) {
    const account = decodeURIComponent(publicStaffGrantMatch[1]);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    return sendJson(res, { ok: true, staffGranted: await hasStaffGrant(account, session.customerId) });
  }

  // 管事：兑换邀请码 / 查看自己的管事身份 / 生成下级邀请码。
  // 和打手授权一样，身份只认会话令牌，客户端传上来的 id 一律不看。
  const publicStewardMatch = urlPath.match(/^\/api\/public\/steward\/([^/]+)(?:\/(redeem|codes))?$/);
  if (publicStewardMatch) {
    const account = decodeURIComponent(publicStewardMatch[1]);
    const action = publicStewardMatch[2] || "";
    const stewardSession = await getCustomerSession(req);
    if (!stewardSession) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    const [stewardCustomerRows] = await getPool().execute(
      "SELECT customer_key, numeric_id, display_name FROM customers WHERE customer_key = ?",
      [stewardSession.customerId],
    );
    if (!stewardCustomerRows[0]) return sendJson(res, { ok: false, message: "没有找到这个用户，请重新进入小程序" }, 404);
    const stewardCustomer = customerIdentity(stewardCustomerRows[0]);
    if (req.method === "GET" && !action) {
      return sendJson(res, {
        ok: true,
        staffGranted: await hasStaffGrant(account, stewardSession.customerId),
        ...(await stewardOverview(account, stewardCustomer)),
      });
    }
    if (req.method === "POST" && action === "redeem") {
      const body = await readBody(req);
      const redeemed = await redeemStewardCode({ account, code: body.code, customer: stewardCustomer });
      if (!redeemed.ok) return sendJson(res, { ok: false, message: redeemed.message }, 400);
      return sendJson(res, {
        ok: true,
        kind: redeemed.kind,
        staffGranted: true,
        ...(await stewardOverview(account, stewardCustomer)),
      });
    }
    if (req.method === "POST" && action === "codes") {
      const overview = await stewardOverview(account, stewardCustomer);
      if (!overview.isSteward) return sendJson(res, { ok: false, message: "只有管事才能生成下级邀请码" }, 403);
      const code = await createStewardCode({
        account, kind: "staff",
        issuerKey: stewardSession.customerId, issuerName: stewardCustomer.displayName,
      });
      return sendJson(res, { ok: true, code });
    }
    return sendJson(res, { ok: false, message: "不支持的操作" }, 405);
  }

  // 提现：进页配置 / 可用余额 / 提交 / 我的提现记录。
  // 身份由服务端判（有没有打手授权）：打手提「可用佣金」，用户提「客户消费余额」且不扣手续费。
  // 客户端只负责报金额、渠道和收款信息，钱怎么扣、手续费多少一律服务端算。
  const publicWithdrawMatch = urlPath.match(/^\/api\/public\/withdraw\/([^/]+)(?:\/(records))?$/);
  if (publicWithdrawMatch) {
    const account = decodeURIComponent(publicWithdrawMatch[1]);
    const action = publicWithdrawMatch[2] || "";
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [activeMerchants] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!activeMerchants[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    const [withdrawCustomers] = await getPool().execute(
      "SELECT customer_key, numeric_id, display_name FROM customers WHERE customer_key = ?",
      [session.customerId],
    );
    if (!withdrawCustomers[0]) return sendJson(res, { ok: false, message: "没有找到这个用户，请重新进入小程序" }, 404);
    const withdrawCustomer = customerIdentity(withdrawCustomers[0]);
    const withdrawIdentity = (await hasStaffGrant(account, session.customerId)) ? "staff" : "user";
    try {
      if (req.method === "GET") {
        if (action === "records") return sendJson(res, { ok: true, items: await withdrawRecords(account, withdrawCustomer) });
        return sendJson(res, await withdrawPagePayload(account, withdrawCustomer, withdrawIdentity));
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { ok: false, message: "请求内容无效" }, 400);
        const fields = [body.name, body.account, body.bankName || body.bank_name].map((text) => String(text || "").trim());
        const images = String(body.images || "");
        if (fields.some((text) => text.length > 120 || hasUnsafeContent(text)) || images.length > 500 || hasUnsafeContent(images)) {
          return sendJson(res, { ok: false, message: "收款信息无效或过长" }, 400);
        }
        const result = await createWithdrawOrder(account, withdrawCustomer, { ...body, name: fields[0], account: fields[1], bankName: fields[2], images }, withdrawIdentity);
        // message 给小程序直接 toast（文档第八节：res.msg），前端不再自己编一句成功文案。
        return sendJson(res, { ok: true, message: "提现申请已提交，请等待平台审核", ...result });
      }
      return sendJson(res, { ok: false, message: "不支持的操作" }, 405);
    } catch (error) {
      return sendJson(res, { ok: false, message: error.message }, 409);
    }
  }

  // 打手端「我的账单」：8 格资金指标 / 保证金充值 / 罚单列表与缴纳 / 佣金流水。
  // 契约字段名照《资金指标开发提示词》，但**身份一律只认会话令牌** ——
  // 提示词里 thugMsg 要传 thug_id，那是原版后端的口径；这里客户端传上来的 id 一律不看，
  // 免得改个 id 就能看别人的钱（本项目所有打手/客户侧接口都是这个规矩）。
  // 打手身份由服务端判（有没有员工授权），不是打手的人一律 403。
  const publicFundsMatch = urlPath.match(/^\/api\/public\/funds\/([^/]+)(?:\/(bond))?$/);
  if (publicFundsMatch) {
    const account = decodeURIComponent(publicFundsMatch[1]);
    const action = publicFundsMatch[2] || "";
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    const fundsSession = await getCustomerSession(req);
    if (!fundsSession) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [fundsMerchants] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!fundsMerchants[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    if (!(await hasStaffGrant(account, fundsSession.customerId))) {
      return sendJson(res, { ok: false, message: "只有打手可以查看自己的账单" }, 403);
    }
    try {
      if (req.method === "GET" && !action) {
        return sendJson(res, { ok: true, funds: await staffFundIndicators(account, fundsSession.customerId) });
      }
      if (req.method === "POST" && action === "bond") {
        // 不接真实支付：生产环境直接挡住，别在线上白送保证金。
        if (isProduction) {
          return sendJson(res, { ok: false, message: "保证金充值正在接入虚拟支付，暂未开放" }, 503);
        }
        const body = await readBody(req);
        return sendJson(res, { ok: true, ...(await rechargeStaffBond(account, fundsSession.customerId, body)) });
      }
      return sendJson(res, { ok: false, message: "不支持的操作" }, 405);
    } catch (error) {
      return sendJson(res, { ok: false, message: error.message }, 409);
    }
  }

  const publicFinesMatch = urlPath.match(/^\/api\/public\/fines\/([^/]+)(?:\/(pay))?$/);
  if (publicFinesMatch) {
    const account = decodeURIComponent(publicFinesMatch[1]);
    const action = publicFinesMatch[2] || "";
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    const finesSession = await getCustomerSession(req);
    if (!finesSession) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [finesMerchants] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!finesMerchants[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    if (!(await hasStaffGrant(account, finesSession.customerId))) {
      return sendJson(res, { ok: false, message: "只有打手可以查看自己的罚单" }, 403);
    }
    try {
      if (req.method === "GET" && !action) {
        const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        const list = await listStaffFines(account, finesSession.customerId, {
          status: requestUrl.searchParams.get("status") ?? -1,
          page: requestUrl.searchParams.get("page") || 1,
          // limit 固定 15（提示词 6.1）：返回条数 < 15 就代表没有更多了。
          limit: requestUrl.searchParams.get("limit") || FINE_LIMIT,
        });
        return sendJson(res, {
          ok: true,
          list,
          unpaid_total: (await staffFineTotals(account, finesSession.customerId)).unpaid,
        });
      }
      if (req.method === "POST" && action === "pay") {
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { ok: false, message: "请求内容无效" }, 400);
        // 提示词传的是 { id, pay_type, methods }；本项目罚单还有个人可读的 fine_no，
        // 两个都认，id 优先 —— 这样照提示词写的前端代码不用改一个字。
        let fineNo = "";
        if (Number(body.id) > 0) {
          const [rows] = await getPool().execute(
            "SELECT fine_no FROM staff_fines WHERE account = ? AND staff_key = ? AND id = ?",
            [account, finesSession.customerId, Number(body.id)],
          );
          fineNo = String(rows[0]?.fine_no || "");
        } else if (body.fine_no) {
          fineNo = String(body.fine_no).slice(0, 64);
        }
        if (!fineNo) return sendJson(res, { ok: false, message: "罚单不存在" }, 404);
        return sendJson(res, { ok: true, ...(await payStaffFine(account, finesSession.customerId, fineNo, body)) });
      }
      return sendJson(res, { ok: false, message: "不支持的操作" }, 405);
    } catch (error) {
      return sendJson(res, { ok: false, message: error.message }, 409);
    }
  }

  const publicCommissionLogMatch = urlPath.match(/^\/api\/public\/commission-log\/([^/]+)$/);
  if (req.method === "GET" && publicCommissionLogMatch) {
    const account = decodeURIComponent(publicCommissionLogMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    const logSession = await getCustomerSession(req);
    if (!logSession) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [logMerchants] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!logMerchants[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    if (!(await hasStaffGrant(account, logSession.customerId))) {
      return sendJson(res, { ok: false, message: "只有打手可以查看自己的佣金流水" }, 403);
    }
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    return sendJson(res, {
      ok: true,
      list: await staffCommissionLog(account, logSession.customerId, {
        page: requestUrl.searchParams.get("page") || 1,
        limit: requestUrl.searchParams.get("limit") || FINE_LIMIT,
      }),
    });
  }

  // 打手端「排行榜」：与后台「员工管理 / 排行榜」同一份数据，按接单流水排序，默认前 20 名。
  const publicRankingMatch = urlPath.match(/^\/api\/public\/staff-ranking\/([^/]+)$/);
  if (req.method === "GET" && publicRankingMatch) {
    const account = decodeURIComponent(publicRankingMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户标识无效" }, 400);
    const rankingSession = await getCustomerSession(req);
    if (!rankingSession) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [rankingMerchants] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rankingMerchants[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    if (!(await hasStaffGrant(account, rankingSession.customerId))) {
      return sendJson(res, { ok: false, message: "只有打手可以查看排行榜" }, 403);
    }
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = Math.min(100, Math.max(1, Number(requestUrl.searchParams.get("limit")) || 20));
    return sendJson(res, { ok: true, ranking: await staffRanking(account, limit) });
  }

  // Lets the customer pick their own nickname ("我的" → 修改昵称). The numeric ID stays the
  // unique handle, so the nickname is display-only and may repeat across customers.
  if (req.method === "POST" && urlPath === "/api/public/customer/profile") {
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    try {
      const parsed = normalizeDisplayName((await readBody(req)).displayName);
      if (!parsed.ok) return sendJson(res, { ok: false, message: parsed.message }, 400);
      const displayName = await updateCustomerDisplayName(session.customerId, parsed.value);
      const [rows] = await getPool().execute(
        "SELECT customer_key, numeric_id, display_name FROM customers WHERE customer_key = ?",
        [session.customerId],
      );
      if (!rows[0]) return sendJson(res, { ok: false, message: "没有找到这个用户，请重新进入小程序" }, 404);
      return sendJson(res, { ok: true, customer: { ...customerIdentity(rows[0]), displayName } });
    } catch (error) {
      if (error instanceof DisplayNameTakenError) return sendJson(res, { ok: false, code: "NAME_TAKEN", message: error.message }, error.status);
      return sendJson(res, { ok: false, message: error.message || "昵称保存失败" }, 400);
    }
  }

  const publicWalletMatch = urlPath.match(/^\/api\/public\/wallets\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && publicWalletMatch) {
    const account = decodeURIComponent(publicWalletMatch[1]);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    if (!isSafeAccount(account)) {
      return sendJson(res, { ok: false, message: "余额账户标识无效" }, 400);
    }
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    // 余额只有「客户」一种身份：同一个人的打手身份不单独记余额。
    // 公开钱包接口只返回客户钱包，不再附带一份打手余额，避免前端又按身份把钱拆成两份。
    const wallet = await getCustomerWallet(account, session.customerId);
    return sendJson(res, { ok: true, wallet });
  }

  const publicWalletRechargeMatch = urlPath.match(/^\/api\/public\/wallets\/([^/]+)\/([^/]+)\/recharge$/);
  if (req.method === "POST" && publicWalletRechargeMatch) {
    const payConfig = wechatPay.wechatPayConfig();
    // 只有本机演示才允许"不付钱直接到账"；生产环境永远走微信支付。
    const directRecharge = !isProduction && (process.env.ALLOW_DIRECT_RECHARGE === "true" || process.env.ENABLE_DEMO_RECHARGE === "true");
    if (!payConfig.configured && !directRecharge) {
      // 未开通支付时要在碰数据库之前就说清楚缺什么，不能留下"点了没反应"。
      return sendJson(res, {
        ok: false,
        code: "PAYMENT_NOT_CONFIGURED",
        message: `真实充值尚未接通，服务器缺少配置：${payConfig.missing.join("、")}。配好微信支付后客户就能直接充值付款。`,
      }, 503);
    }
    const account = decodeURIComponent(publicWalletRechargeMatch[1]);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    if (!isSafeAccount(account)) {
      return sendJson(res, { ok: false, message: "余额账户标识无效" }, 400);
    }
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    try {
      const body = await readBody(req);
      return sendJson(res, { ok: true, ...(await rechargeCustomerWallet(account, session.customerId, body, payConfig, directRecharge)) });
    } catch (error) {
      const status = error instanceof wechatPay.WechatPayError ? error.status : 400;
      return sendJson(res, { ok: false, code: error.code, message: error.message }, status);
    }
  }

  // 微信支付结果回调：公网 HTTPS、不带会话。来源可信性靠 APIv3 密钥解密密文来确认
  // （只有微信持有该密钥），金额与商户号再逐项核对，最后按单号幂等核销。
  if (req.method === "POST" && urlPath === "/api/pay/wechat/notify") {
    const config = wechatPay.wechatPayConfig();
    if (!config.configured) return sendJson(res, { code: "FAIL", message: "微信支付未配置" }, 503);
    try {
      const raw = await readRawBody(req);
      wechatPay.verifyNotificationSignature({
        headers: req.headers, rawBody: raw, platformPublicKey: wechatPay.loadPlatformPublicKey(config),
      });
      const body = JSON.parse(raw || "{}");
      const transaction = wechatPay.decryptNotificationResource(config.apiV3Key, body.resource);
      if (String(transaction.appid || "") !== config.appId || String(transaction.mchid || "") !== config.mchId) {
        throw new Error("回调的商户号或 AppID 不匹配");
      }
      const tradeNo = String(transaction.out_trade_no || "");
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(tradeNo)) throw new Error("回调单号格式无效");
      const intent = await findPaymentAccount(tradeNo);
      if (!intent) throw new Error("找不到对应的支付单，已忽略");
      if (String(transaction.trade_state) === "SUCCESS") {
        await settlePaymentIntent(String(intent.account), tradeNo, transaction);
      }
      return sendJson(res, { code: "SUCCESS", message: "成功" });
    } catch (error) {
      console.error("WeChat pay notify rejected:", error.message);
      return sendJson(res, { code: "FAIL", message: error.message || "处理失败" }, 400);
    }
  }

  // 小程序 wx.requestPayment 成功后的兜底：主动向微信查单再入账，
  // 这样即使回调延迟或丢失，客户也不会"付了钱却显示没到账"。
  const publicPaymentConfirmMatch = urlPath.match(/^\/api\/public\/payments\/([^/]+)\/([^/]+)\/confirm$/);
  if (req.method === "POST" && publicPaymentConfirmMatch) {
    const account = decodeURIComponent(publicPaymentConfirmMatch[1]);
    const tradeNo = decodeURIComponent(publicPaymentConfirmMatch[2]);
    if (!isSafeAccount(account) || !/^[A-Za-z0-9_-]{6,64}$/.test(tradeNo)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const config = wechatPay.wechatPayConfig();
    if (!config.configured) return sendJson(res, { ok: false, code: "PAYMENT_NOT_CONFIGURED", message: "微信支付尚未开通" }, 503);
    const intent = await loadPaymentIntent(account, tradeNo);
    if (!intent || String(intent.customer_key) !== session.customerId) {
      return sendJson(res, { ok: false, message: "支付单不存在" }, 404);
    }
    const pending = { ok: true, status: "pending", purpose: String(intent.purpose), referenceNo: String(intent.reference_no) };
    try {
      const remote = await wechatPay.queryTransaction(config, tradeNo);
      if (String(remote.trade_state) !== "SUCCESS") {
        return sendJson(res, { ...pending, status: String(remote.trade_state || "pending") });
      }
      const settled = await settlePaymentIntent(account, tradeNo, remote);
      return sendJson(res, {
        ok: true, status: "paid", purpose: settled.purpose, referenceNo: settled.referenceNo, amount: settled.amount,
        wallet: settled.wallet || await getCustomerWallet(account, session.customerId),
        order: settled.order || null,
      });
    } catch (error) {
      // 还没支付时微信返回 ORDER_NOT_EXIST，这不是错误，只是"还没付"。
      if (error instanceof wechatPay.WechatPayError && ["ORDER_NOT_EXIST", "ORDERNOTEXIST"].includes(error.code)) {
        return sendJson(res, pending);
      }
      const status = error instanceof wechatPay.WechatPayError ? error.status : 400;
      return sendJson(res, { ok: false, code: error.code, message: error.message }, status);
    }
  }

  // Lightweight change probe so the mini-program can poll for config updates without
  // downloading the whole payload (which can reach hundreds of KB with images).
  const publicConfigMetaMatch = urlPath.match(/^\/api\/public\/config\/([^/]+)\/meta$/);
  if (req.method === "GET" && publicConfigMetaMatch) {
    const account = decodeURIComponent(publicConfigMetaMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false }, 400);
    const [rows] = await getPool().execute(
      "SELECT m.account AS account, c.version AS version, c.updated_at AS updatedAt FROM merchants m LEFT JOIN configs c ON c.account = m.account WHERE m.account = ? AND m.status = 'active'",
      [account],
    );
    if (!rows[0]) return sendJson(res, { ok: false }, 404);
    return sendJson(res, {
      ok: true,
      account,
      version: Number(rows[0].version || 0),
      updatedAt: Number(rows[0].updatedAt || 0),
    });
  }

  const publicConfigMatch = urlPath.match(/^\/api\/public\/config\/([^/]+)$/);
  if (req.method === "GET" && publicConfigMatch) {
    const account = decodeURIComponent(publicConfigMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false }, 400);
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, null, 404);
    const config = sanitizePublicConfig(await getConfig(account) || {});
    // 店铺前台只拿得到「审核通过」的评价：待审核和被驳回的绝不出现在这里。
    // 商户自己的审核列表走鉴权接口 /api/reviews/:account。
    config.reviews = await listReviews(account, { status: "approved", limit: reviewPublicLimit });
    return sendJson(res, config);
  }

  const publicBroadcastsMatch = urlPath.match(/^\/api\/public\/broadcasts\/([^/]+)$/);
  if (req.method === "GET" && publicBroadcastsMatch) {
    const account = decodeURIComponent(publicBroadcastsMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false, message: "商户账号无效" }, 400);
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    return sendJson(res, { ok: true, broadcasts: await getRecentOrderBroadcasts(account) });
  }

  const publicOrdersMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)$/);
  if (req.method === "GET" && publicOrdersMatch) {
    const account = decodeURIComponent(publicOrdersMatch[1]);
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const scope = String(requestUrl.searchParams.get("scope") || "");
    if (!isSafeAccount(account)) {
      return sendJson(res, { ok: false, message: "订单查询标识无效" }, 400);
    }
    if (scope === "recent") {
      // Legacy path kept for older clients; prefer /api/public/broadcasts/:account.
      const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
      if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
      return sendJson(res, { ok: true, broadcasts: await getRecentOrderBroadcasts(account) });
    }
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    if (scope === "staff") {
      if (!(await hasStaffGrant(account, session.customerId))) {
        return sendJson(res, { ok: false, code: "STAFF_FORBIDDEN", message: "打手权限未开通，请联系商户授权" }, 403);
      }
      // q = 打手工作台的搜索词（走服务端模糊匹配，不是前端在已加载列表里过滤）。
      const keyword = String(requestUrl.searchParams.get("q") || "").slice(0, 60);
      return sendJson(res, { ok: true, orders: await getStaffOrders(account, session.customerId, keyword) });
    }
    return sendJson(res, { ok: true, orders: await getCustomerOrders(account, session.customerId) });
  }
  if (req.method === "POST" && publicOrdersMatch) {
    const account = decodeURIComponent(publicOrdersMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    const body = await readBody(req);
    // The authenticated session decides who the order belongs to — never the request body.
    const checkoutOnly = body.checkoutOnly === true;
    const order = publicOrder({ ...(body.order || {}), customerId: session.customerId }, account);
    if (checkoutOnly && (!order.gameName.trim() || !order.gameId.trim())) return sendJson(res, { ok: false, message: "请填写游戏昵称和 ID" }, 400);
    order.customerId = session.customerId;
    const payByBalance = order.paymentMethod === "balance";
    // 余额支付的资金在本地钱包，微信支付要先去微信下单。未开通就在创建订单之前说清楚，
    // 避免留下一条永远付不掉的待付款订单。
    const payConfig = payByBalance ? null : wechatPay.wechatPayConfig();
    if (!checkoutOnly && !payByBalance && !payConfig.configured) {
      return sendJson(res, { ok: false, code: "PAYMENT_NOT_CONFIGURED", message: `微信支付尚未开通，服务器缺少配置：${payConfig.missing.join("、")}。本次没有扣款，也未创建订单。` }, 503);
    }
    const config = await getConfig(account) || {};
    try {
      applyConfiguredProductPricing(config, order);
    } catch (error) {
      return sendJson(res, { ok: false, message: error.message }, 400);
    }
    const allowedServers = allowedServersForProduct(config, order.productId);
    if (!order.server && allowedServers.length) order.server = allowedServers[0];
    if (allowedServers.length && !allowedServers.includes(order.server)) {
      return sendJson(res, { ok: false, message: "该游戏区服不属于商品的大分类，请刷新后重新选择" }, 400);
    }
    const lottery = lotteryForProduct(config, order.productId, order.quantity);
    order.productImage = String(config.products?.find((item) => String(item.id) === String(order.productId))?.imageUrl || "");
    order.productDescription = String(config.products?.find((item) => String(item.id) === String(order.productId))?.desc || "");
    if (checkoutOnly) { order.paymentMethod = ""; order.channel = ""; }
    if (lottery) {
      order.lottery = lottery;
    }
    let savedOrder;
    try {
      savedOrder = await runTransaction(async (connection) => {
      const [existingRows] = await connection.execute(
        "SELECT customer_id, payload FROM orders WHERE account = ? AND order_no = ? LIMIT 1 FOR UPDATE",
        [account, order.no],
      );
      if (existingRows[0]) {
        const existing = jsonParse(existingRows[0].payload, {});
        if (existingRows[0].customer_id !== order.customerId
          || ["productId", "quantity", "gameId", "server", "receiveMode"].some((key) => String(existing[key] ?? "") !== String(order[key] ?? ""))
          || (!checkoutOnly && existing.paymentMethod !== order.paymentMethod)) {
          throw new Error("订单编号已使用，请重新提交");
        }
        return existing;
      }
      const identity = await ensureCustomerIdentity(order.customerId, connection);
      order.user = identity.displayName;
      order.userId = identity.numericId;
      order.avatar = "";
      order.avatarUrl = "";
      if (!checkoutOnly && order.paymentMethod === "balance") {
        order.balanceAfter = await debitCustomerWallet(connection, account, order.customerId, order.price, order.no);
        order.paymentStatus = "paid";
        order.paidAt = now();
        order.status = lottery ? "待抽奖" : "待接单";
      }
      await connection.execute("INSERT INTO orders (account, order_no, customer_id, payload, created_at) VALUES (?, ?, ?, ?, ?)", [account, order.no, order.customerId, JSON.stringify(order), now()]);
        return order;
      });
    } catch (error) {
      return sendJson(res, { ok: false, message: error.message || "订单提交失败" }, 400);
    }
    if (checkoutOnly) return sendJson(res, { ok: true, order: savedOrder });
    if (!payByBalance) {
      // 订单已保存为待付款，这里只负责向微信要预支付参数；付款结果以回调/查单为准。
      try {
        const pay = await createOrderPayment(account, savedOrder, payConfig);
        return sendJson(res, { ok: true, order: savedOrder, payment: pay.payment, tradeNo: pay.tradeNo });
      } catch (error) {
        const status = error instanceof wechatPay.WechatPayError ? error.status : 502;
        return sendJson(res, { ok: false, code: error.code, message: error.message, order: savedOrder }, status);
      }
    }
    return sendJson(res, { ok: true, order: savedOrder });
  }

  const customerOrderActionMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)\/(cancel|complaint)$/);
  if (req.method === "POST" && customerOrderActionMatch) {
    const account = decodeURIComponent(customerOrderActionMatch[1]), orderNo = decodeURIComponent(customerOrderActionMatch[2]);
    const action = customerOrderActionMatch[3];
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const customer = await getCustomerSession(req);
    if (!customer) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "请先登录" }, 401);
    const body = action === "complaint" ? await readBody(req) : {};
    const content = String(body.content || "").trim();
    if (action === "complaint" && (content.length < 5 || content.length > 500 || hasUnsafeContent(content))) {
      return sendJson(res, { ok: false, message: "投诉内容请填写 5 到 500 个有效字符" }, 400);
    }
    await expireUnpaidOrders(account);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record || record.customerId !== customer.customerId) throw new Error("无权操作该订单");
        const payload = { ...record.payload };
        if (action === "cancel") {
          if (payload.paymentStatus === "cancelled") return payload;
          if (payload.paymentStatus !== "pending" || payload.status !== "待付款") throw new Error("只有待付款订单可以取消");
          if (payload.paymentMethod === "wechat" || payload.channel === "微信支付") throw new Error("微信支付已发起，暂不能取消，请等待支付结果或超时");
          const [intents] = await connection.execute(
            "SELECT trade_no FROM payment_intents WHERE account = ? AND purpose = 'order' AND reference_no = ? LIMIT 1 FOR UPDATE",
            [account, orderNo],
          );
          if (intents.length) throw new Error("支付已发起，暂不能取消，请等待支付结果或超时");
          Object.assign(payload, { status: "已取消", paymentStatus: "cancelled", cancelReason: "客户主动取消", cancelledAt: now() });
        } else {
          if (payload.paymentStatus === "cancelled") throw new Error("已取消订单不能提交投诉");
          if (payload.complaint) {
            if (payload.complaint.content === content) return payload;
            throw new Error("这笔订单已经提交过投诉，请查看处理状态");
          }
          payload.complaint = { content, status: "pending", submittedAt: now() };
        }
        await updateOrderPayloadById(record.id, payload, connection);
        return payload;
      });
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  const orderPayMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)\/pay$/);
  if (req.method === "POST" && orderPayMatch) {
    const account = decodeURIComponent(orderPayMatch[1]), orderNo = decodeURIComponent(orderPayMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const customer = await getCustomerSession(req);
    if (!customer) return sendJson(res, { ok: false, message: "请先登录" }, 401);
    const [merchants] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!merchants.length) return sendJson(res, { ok: false, message: "商户不可用" }, 404);
    const body = await readBody(req);
    if (!["balance", "wechat"].includes(body.paymentMethod)) return sendJson(res, { ok: false, message: "支付方式无效" }, 400);
    const config = body.paymentMethod === "wechat" ? wechatPay.wechatPayConfig() : null;
    if (config && !config.configured) return sendJson(res, { ok: false, message: "微信支付暂未开通，可稍后重试或选择余额支付" }, 503);
    await expireUnpaidOrders(account);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record || record.customerId !== customer.customerId) throw new Error("无权支付该订单");
        const order = { ...record.payload };
        if (order.paymentStatus === "paid") return order;
        if (order.paymentStatus !== "pending" || (order.paymentExpiresAt && order.paymentExpiresAt <= now())) throw new Error("订单已取消或支付超时");
        // A WeChat attempt keeps its method locked, preventing a callback racing a balance debit.
        if (order.paymentMethod === "wechat" && body.paymentMethod !== "wechat") throw new Error("该订单已发起微信支付，请继续原支付方式");
        order.paymentMethod = body.paymentMethod;
        order.channel = body.paymentMethod === "balance" ? "余额支付" : "微信支付";
        if (body.paymentMethod === "balance") {
          order.balanceAfter = await debitCustomerWallet(connection, account, customer.customerId, order.price, order.no);
          order.paymentStatus = "paid"; order.paidAt = now();
          order.status = order.lottery?.status === "pending" ? "待抽奖" : "待接单";
        }
        await updateOrderPayloadById(record.id, order, connection);
        return order;
      });
      if (order.paymentStatus === "paid") return sendJson(res, { ok: true, order });
      const pay = await createOrderPayment(account, order, config);
      return sendJson(res, { ok: true, order, ...pay });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  const staffActionMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)\/(start|submit-proof)$/);
  if (req.method === "POST" && staffActionMatch) {
    const account = decodeURIComponent(staffActionMatch[1]), orderNo = decodeURIComponent(staffActionMatch[2]), action = staffActionMatch[3];
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const customer = await getCustomerSession(req);
    if (!customer) return sendJson(res, { ok: false, message: "请先登录" }, 401);
    if (!(await hasStaffGrant(account, customer.customerId))) return sendJson(res, { ok: false, message: "未开通打手权限" }, 403);
    const body = await readBody(req);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record) throw new Error("订单不存在");
        const actor = { id: customer.customerId, role: "staff" };
        // Check ownership and state before decoding or writing any uploaded bytes.
        advanceOrder(record.payload, action, actor, now(), action === "submit-proof" ? "pending" : null);
        let proof = record.payload.completionProof;
        if (action === "submit-proof" && !proof) {
          const { buffer, extension } = imageAssetFromDataUrl(body.imageDataUrl);
          const file = `${crypto.randomUUID()}.${extension}`;
          const dir = path.join(root, "data", "order-evidence", account);
          await fs.promises.mkdir(dir, { recursive: true });
          await fs.promises.writeFile(path.join(dir, file), buffer);
          proof = { file, url: `/api/order-evidence/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}`, submittedBy: customer.customerId };
        }
        const payload = advanceOrder(record.payload, action, actor, now(), proof);
        await updateOrderPayloadById(record.id, payload, connection);
        return payload;
      });
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  // 老板端「确认结单」：打手上传结单截图后订单停在「待结单」，由下单老板确认收尾。
  // 和商户后台结单共用 completeOrderAndCreditStaff（订单进已完成 + 打手佣金入账），
  // 区别只在操作人：这条记的是客户，所以 completedBy 不会记成商户。
  const bossConfirmMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)\/confirm$/);
  if (req.method === "POST" && bossConfirmMatch) {
    const account = decodeURIComponent(bossConfirmMatch[1]), orderNo = decodeURIComponent(bossConfirmMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const customer = await getCustomerSession(req);
    if (!customer) return sendJson(res, { ok: false, message: "请先登录" }, 401);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        // 归属校验只能放这里：订单的 customer_id 是 orders 表的列，advanceOrder 的 payload 里没有它。
        if (!record || record.customerId !== customer.customerId) throw new Error("无权确认该订单");
        return completeOrderAndCreditStaff(connection, {
          account, orderNo, record, action: "confirm", actor: { role: "customer", id: customer.customerId },
        });
      });
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  const evidenceMatch = urlPath.match(/^\/api\/order-evidence\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && evidenceMatch) {
    const account = decodeURIComponent(evidenceMatch[1]), orderNo = decodeURIComponent(evidenceMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const admin = await getSession(req);
    const customer = await getCustomerSession(req);
    const record = await getOrderRecord(account, orderNo);
    if (!record || !(canAccess(admin, account) || (customer && [record.customerId, record.payload.staffId].includes(customer.customerId)))) return sendJson(res, { ok: false }, 403);
    const file = record.payload.completionProof?.file;
    if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(file || "")) return sendJson(res, { ok: false }, 404);
    const data = await fs.promises.readFile(path.join(root, "data", "order-evidence", account, file));
    res.writeHead(200, { "Content-Type": file.endsWith('.jpg') ? "image/jpeg" : `image/${file.split('.').pop()}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return res.end(data);
  }

  // 订单评价（客户侧）。提交后是 pending，商户审核通过才出现在前台。
  const publicReviewsMatch = urlPath.match(/^\/api\/public\/reviews\/([^/]+)$/);
  if (publicReviewsMatch) {
    const account = decodeURIComponent(publicReviewsMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const [rows] = await getPool().execute("SELECT account FROM merchants WHERE account = ? AND status = 'active'", [account]);
    if (!rows[0]) return sendJson(res, { ok: false, message: "商户不存在或已停用" }, 404);
    if (req.method === "GET") {
      // scope=mine：看自己的评价（含待审核/被驳回），用来在订单列表里显示评价状态。
      // 不带 scope 时只返回自己已通过的评价，避免把别人的审核状态漏出去。
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const mine = String(requestUrl.searchParams.get("scope") || "") === "mine";
      const reviews = await listReviews(account, {
        customerKey: session.customerId,
        ...(mine ? {} : { status: "approved" }),
        limit: 200,
      });
      return sendJson(res, { ok: true, reviews });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const result = await submitOrderReview(account, session.customerId, body);
      if (!result.ok) return sendJson(res, { ok: false, message: result.error }, result.status);
      return sendJson(res, { ok: true, review: result.review, message: result.message });
    }
    return sendJson(res, { ok: false, message: "不支持的请求方法" }, 405);
  }

  const publicOrderLotteryMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)\/lottery\/draw$/);
  const publicOrderDetailMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)$/);
  if (req.method === "GET" && publicOrderDetailMatch) {
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, message: "请先登录" }, 401);
    await expireUnpaidOrders(decodeURIComponent(publicOrderDetailMatch[1]));
    const record = await getOrderRecord(decodeURIComponent(publicOrderDetailMatch[1]), decodeURIComponent(publicOrderDetailMatch[2]));
    if (!record || record.customerId !== session.customerId) return sendJson(res, { ok: false, message: "订单不存在或无权查看" }, 404);
    return sendJson(res, { ok: true, order: record.payload });
  }
  if (req.method === "POST" && publicOrderLotteryMatch) {
    const account = decodeURIComponent(publicOrderLotteryMatch[1]);
    const orderNo = decodeURIComponent(publicOrderLotteryMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const customerId = session.customerId;
    const drawBody = await readBody(req);
    const requestedDraw = drawBody.drawIndex === undefined ? null : Number(drawBody.drawIndex);
    if (requestedDraw !== null && (!Number.isInteger(requestedDraw) || requestedDraw < 1 || requestedDraw > 99)) return sendJson(res, { ok: false, message: "抽奖次数无效" }, 400);
    const result = await runTransaction(async (connection) => {
      const record = await getOrderRecord(account, orderNo, connection, true);
      if (!record) return { error: "订单不存在", status: 404 };
      if (record.customerId !== customerId) return { error: "无权抽取该订单奖品", status: 403 };
      const order = { ...record.payload };
      const savedResult = requestedDraw === null ? null : order.lottery?.results?.find((item) => Number(item.drawIndex) === requestedDraw);
      if (savedResult && order.paymentStatus === "paid") return { order, result: savedResult };
      if (order.paymentStatus !== "paid" || !["待抽奖", "待接单"].includes(order.status)) {
        return { error: "订单未支付或状态不允许抽奖", status: 409 };
      }
      const lottery = order.lottery && typeof order.lottery === "object" ? { ...order.lottery } : null;
      if (!lottery) return { error: "该订单不是抽奖订单", status: 400 };
      if (requestedDraw !== null && requestedDraw !== Number(lottery.completedDraws || 0) + 1) return { error: "抽奖进度已变化，请刷新订单", status: 409 };
      if (lottery.status === "completed" || Number(lottery.completedDraws || 0) >= Number(lottery.totalDraws || 0)) {
        return { error: "该订单已经完成全部抽奖", status: 409 };
      }
      const prize = drawLotteryPrize(lottery.prizes);
      const drawIndex = Number(lottery.completedDraws || 0) + 1;
      const drawResult = {
        id: `${orderNo}_${drawIndex}`,
        prizeId: prize.id,
        name: prize.name,
        imageUrl: prize.imageUrl || "",
        drawIndex,
        drawnAt: now(),
      };
      lottery.results = [...(Array.isArray(lottery.results) ? lottery.results : []), drawResult];
      lottery.completedDraws = drawIndex;
      if (drawIndex >= Number(lottery.totalDraws || 1)) {
        lottery.status = "completed";
        order.status = "待接单";
      } else {
        lottery.status = "pending";
        order.status = "待抽奖";
      }
      order.lottery = lottery;
      await updateOrderPayloadById(record.id, order, connection);
      return { order, result: drawResult };
    });
    if (result.error) return sendJson(res, { ok: false, message: result.error }, result.status || 400);
    return sendJson(res, { ok: true, order: result.order, result: result.result });
  }

  const publicOrderAcceptMatch = urlPath.match(/^\/api\/public\/orders\/([^/]+)\/([^/]+)\/accept$/);
  if (req.method === "POST" && publicOrderAcceptMatch) {
    const account = decodeURIComponent(publicOrderAcceptMatch[1]);
    const orderNo = decodeURIComponent(publicOrderAcceptMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    if (!(await hasStaffGrant(account, session.customerId))) {
      return sendJson(res, { ok: false, code: "STAFF_FORBIDDEN", message: "打手权限未开通，请联系商户授权" }, 403);
    }
    const [staffRows] = await getPool().execute(
      "SELECT display_name FROM customers WHERE customer_key = ?",
      [session.customerId],
    );
    // Actor identity comes from the authenticated session — the body can no longer choose it.
    const actor = {
      role: "staff",
      id: session.customerId,
      name: String(staffRows[0]?.display_name || "当前打手").slice(0, 80),
    };
    const result = await runTransaction(async (connection) => {
      const order = await getOrderRecord(account, orderNo, connection, true);
      if (!order) return { error: "订单不存在", status: 404 };
      const payload = { ...order.payload };
      if (payload.paymentStatus !== "paid") return { error: "订单尚未支付，暂不可接", status: 409 };
      if (["待开始", "服务中", "待结单", "已完成"].includes(payload.status) && payload.staffId === actor.id) return { order: payload };
      if (!["待服务", "待接单"].includes(payload.status)) return { error: "订单状态不允许接单", status: 409 };
      if (payload.lottery && payload.lottery.status !== "completed") {
        return { error: "客户尚未完成抽奖，订单暂不可接", status: 409 };
      }
      if (payload.staffId && payload.staffId !== actor.id) return { error: "订单已由其他打手接单", status: 409 };
      const bondError = await staffBondShortfall(account, actor.id, connection);
      if (bondError) return { error: bondError, code: "BOND_INSUFFICIENT", status: 409 };
      payload.status = "待开始";
      payload.acceptedAt = now();
      payload.staff = actor.name;
      payload.staffId = actor.id;
      await updateOrderPayloadById(order.id, payload, connection);
      return { order: payload };
    });
    if (result.error) return sendJson(res, { ok: false, code: result.code, message: result.error }, result.status || 400);
    return sendJson(res, { ok: true, order: result.order });
  }

  const conversationsMatch = urlPath.match(/^\/api\/public\/conversations\/([^/]+)$/);
  if (req.method === "GET" && conversationsMatch) {
    const account = decodeURIComponent(conversationsMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false }, 400);
    const viewer = await getCustomerSession(req);
    if (!viewer) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "请先登录" }, 401);
    const role = new URL(req.url, `http://${req.headers.host}`).searchParams.get("role") === "staff" ? "staff" : "boss";
    if (role === "staff" && !(await hasStaffGrant(account, viewer.customerId))) return sendJson(res, { ok: false, message: "打手权限未开通" }, 403);
    const ownerFilter = role === "boss" ? "o.customer_id = ?" : "JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.staffId')) = ?";
    const peerKey = role === "boss" ? "JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.staffId'))" : "o.customer_id";
    const readColumn = role === "boss" ? "read_by_boss_at" : "read_by_staff_at";
    const [rows] = await getPool().execute(`SELECT o.order_no, o.payload, o.created_at, c.display_name AS peer_name,
      (SELECT body FROM order_messages m WHERE m.account=o.account AND m.order_no=o.order_no ORDER BY created_at DESC,id DESC LIMIT 1) AS last_message,
      (SELECT MAX(created_at) FROM order_messages m WHERE m.account=o.account AND m.order_no=o.order_no) AS last_time,
      (SELECT COUNT(*) FROM order_messages m WHERE m.account=o.account AND m.order_no=o.order_no AND sender_role=? AND ${readColumn} IS NULL) AS unread
      FROM orders o LEFT JOIN customers c ON c.customer_key=${peerKey}
      WHERE o.account=? AND ${ownerFilter} AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(o.payload, '$.staffId')), '') NOT IN ('', 'null')
      ORDER BY COALESCE(last_time, o.created_at) DESC, o.id DESC LIMIT 1000`, [role === "boss" ? "staff" : "boss", account, viewer.customerId]);
    const conversations = rows.map((row) => {
      const order = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      return { orderNo: row.order_no, product: order.product || "订单会话", peerName: row.peer_name || (role === "boss" ? "接单打手" : "客户"),
        lastMessage: row.last_message || "", updatedAt: Number(row.last_time || row.created_at), unread: Number(row.unread || 0), role };
    });
    return sendJson(res, { ok: true, conversations });
  }

  const publicChatMatch = urlPath.match(/^\/api\/public\/order-chat\/([^/]+)\/([^/]+)$/);
  if (publicChatMatch) {
    const account = decodeURIComponent(publicChatMatch[1]);
    const orderNo = decodeURIComponent(publicChatMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const source = req.method === "GET"
      ? Object.fromEntries(requestUrl.searchParams.entries())
      : await readBody(req);
    const requestedRole = source.role === "staff" ? "staff" : "boss";
    if (requestedRole === "staff" && !(await hasStaffGrant(account, session.customerId))) {
      return sendJson(res, { ok: false, code: "STAFF_FORBIDDEN", message: "打手权限未开通，请联系商户授权" }, 403);
    }
    const [actorRows] = await getPool().execute(
      "SELECT display_name FROM customers WHERE customer_key = ?",
      [session.customerId],
    );
    const actor = {
      role: requestedRole,
      id: session.customerId,
      name: String(actorRows[0]?.display_name || (requestedRole === "boss" ? "客户" : "当前打手")).slice(0, 80),
    };
    const order = await getOrderRecord(account, orderNo);
    if (!canAccessOrderChat(order, actor)) {
      return sendJson(res, { ok: false, message: "无权访问该订单会话" }, 403);
    }
    if (req.method === "GET") {
      await markOrderMessagesRead(account, orderNo, actor.role);
      return sendJson(res, {
        ok: true,
        order: order.payload,
        messages: await getOrderMessages(account, orderNo, actor.role),
        unread: await getChatUnreadSummary(account, actor.role, [orderNo]),
      });
    }
    if (req.method === "POST") {
      const text = String(source.text || source.body || "").trim();
      if (!text || Buffer.byteLength(text, "utf8") > 2000 || hasUnsafeContent(text)) {
        return sendJson(res, { ok: false, message: "消息内容无效" }, 400);
      }
      const timestamp = now();
      await getPool().execute(
        `INSERT INTO order_messages
         (account, order_no, sender_role, sender_id, sender_name, body, read_by_boss_at, read_by_staff_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          account,
          orderNo,
          actor.role,
          actor.id,
          actor.name,
          text,
          actor.role === "boss" ? timestamp : null,
          actor.role === "staff" ? timestamp : null,
          timestamp,
        ],
      );
      return sendJson(res, {
        ok: true,
        messages: await getOrderMessages(account, orderNo, actor.role),
        unread: await getChatUnreadSummary(account, actor.role, [orderNo]),
      });
    }
  }

  const publicChatSummaryMatch = urlPath.match(/^\/api\/public\/order-chat\/([^/]+)$/);
  if (req.method === "POST" && publicChatSummaryMatch) {
    const account = decodeURIComponent(publicChatSummaryMatch[1]);
    if (!isSafeAccount(account)) return sendJson(res, { ok: false }, 400);
    const session = await getCustomerSession(req);
    if (!session) return sendJson(res, { ok: false, code: "AUTH_REQUIRED", message: "登录状态已失效，请重新进入小程序" }, 401);
    const body = await readBody(req);
    const role = body.role === "staff" ? "staff" : "boss";
    if (role === "staff" && !(await hasStaffGrant(account, session.customerId))) {
      return sendJson(res, { ok: false, code: "STAFF_FORBIDDEN", message: "打手权限未开通，请联系商户授权" }, 403);
    }
    const orderNos = Array.isArray(body.orderNos) ? body.orderNos.map(String) : [];
    // Unread counts are only returned for orders that belong to the requester.
    return sendJson(res, { ok: true, unread: await getChatUnreadSummary(account, role, orderNos, session.customerId) });
  }

  const session = await getSession(req);
  if (!session) return sendJson(res, { ok: false, message: "请先登录后台" }, 401);

  if (req.method === "GET" && urlPath === "/api/bootstrap") {
    return sendJson(res, session.role === "owner" ? await ownerBootstrap() : await merchantBootstrap(session.account));
  }

  const heroAssetMatch = urlPath.match(/^\/api\/merchant-assets\/([^/]+)\/hero$/);
  if (req.method === "POST" && heroAssetMatch) {
    const account = decodeURIComponent(heroAssetMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    const asset = await saveMerchantHeroAsset(account, body.imageDataUrl, body.fileName);
    return sendJson(res, { ok: true, asset }, 201);
  }

  const productAssetMatch = urlPath.match(/^\/api\/merchant-assets\/([^/]+)\/products\/([^/]+)$/);
  if (req.method === "POST" && productAssetMatch) {
    const account = decodeURIComponent(productAssetMatch[1]);
    const productId = decodeURIComponent(productAssetMatch[2]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    const asset = await saveMerchantProductAsset(account, productId, body.imageDataUrl, body.fileName);
    return sendJson(res, { ok: true, asset }, 201);
  }

  const lotteryPrizeAssetMatch = urlPath.match(/^\/api\/merchant-assets\/([^/]+)\/lottery-prizes\/([^/]+)$/);
  if (req.method === "POST" && lotteryPrizeAssetMatch) {
    const account = decodeURIComponent(lotteryPrizeAssetMatch[1]);
    const prizeId = decodeURIComponent(lotteryPrizeAssetMatch[2]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    const asset = await saveMerchantLotteryPrizeAsset(account, prizeId, body.imageDataUrl, body.fileName);
    return sendJson(res, { ok: true, asset }, 201);
  }

  if (req.method === "POST" && urlPath === "/api/merchants") {
    if (session.role !== "owner") return sendJson(res, { ok: false, message: "仅总管理员可管理商户" }, 403);
    const body = await readBody(req);
    if (!Array.isArray(body.merchants) || body.merchants.length > maxArrayItems) {
      return sendJson(res, { ok: false, message: "商户数据无效" }, 400);
    }
    await runTransaction(async (connection) => {
      const timestamp = now();
      const activeAccounts = [];
      for (const item of body.merchants) {
        const account = String(item?.account || "").trim();
        if (!isSafeAccount(account)) throw new Error("商户账号需为 3-48 位字母、数字、下划线或短横线");
        const [oldRows] = await connection.execute("SELECT password_hash, created_at FROM merchants WHERE account = ?", [account]);
        const old = oldRows[0];
        if (isProduction && ((!old && !strongPassword(item?.password)) || (item?.password && !strongPassword(item.password)))) {
          throw new Error("商户密码至少 16 位，且不能使用默认或示例密码");
        }
        const passwordHash = item?.password ? hashPassword(String(item.password)) : old?.password_hash || hashPassword("123456");
        await connection.execute(
          `INSERT INTO merchants (account, club_name, password_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)
           ON DUPLICATE KEY UPDATE club_name = VALUES(club_name), password_hash = VALUES(password_hash), status = 'active', updated_at = VALUES(updated_at)`,
          [account, String(item?.clubName || "未命名俱乐部").slice(0, 80), passwordHash, old?.created_at || timestamp, timestamp],
        );
        activeAccounts.push(account);
        if (item?.password) await connection.execute("DELETE FROM sessions WHERE role = 'merchant' AND account = ?", [account]);
      }
      if (activeAccounts.length) {
        const placeholders = activeAccounts.map(() => "?").join(",");
        await connection.query(`UPDATE merchants SET status = 'disabled', updated_at = ? WHERE account NOT IN (${placeholders})`, [timestamp, ...activeAccounts]);
      } else {
        await connection.execute("UPDATE merchants SET status = 'disabled', updated_at = ?", [timestamp]);
      }
    });
    return sendJson(res, { ok: true, merchants: (await getActiveMerchants()).map(publicMerchant) });
  }

  const walletCustomersMatch = urlPath.match(/^\/api\/wallets\/([^/]+)\/customers$/);
  if (req.method === "GET" && walletCustomersMatch) {
    const account = decodeURIComponent(walletCustomersMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const query = new URL(req.url || "/", "http://localhost").searchParams.get("q");
    return sendJson(res, { ok: true, customers: await searchMerchantCustomers(account, query) });
  }

  const walletCreditMatch = urlPath.match(/^\/api\/wallets\/([^/]+)\/credit$/);
  if (req.method === "POST" && walletCreditMatch) {
    const account = decodeURIComponent(walletCreditMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    try {
      const wallet = await creditWallet(account, session.account, body);
      return sendJson(res, { ok: true, wallet });
    } catch (error) {
      if (error instanceof WalletCreditError) return sendJson(res, { ok: false, message: error.message }, error.status);
      console.error("Wallet credit failed:", error);
      return sendJson(res, { ok: false, message: "余额调整未确认，请使用原操作重试或核对流水" }, 500);
    }
  }

  const walletTransactionsMatch = urlPath.match(/^\/api\/wallets\/([^/]+)\/transactions$/);
  if (req.method === "GET" && walletTransactionsMatch) {
    const account = decodeURIComponent(walletTransactionsMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ownerTypeParam = requestUrl.searchParams.get("ownerType") || "";
    const ownerType = ownerTypeParam ? normalizeWalletOwnerType(ownerTypeParam) : "";
    if (ownerTypeParam && !ownerType) return sendJson(res, { ok: false, message: "余额账户类型无效" }, 400);
    const ownerId = String(requestUrl.searchParams.get("ownerId") || "").trim().slice(0, 80);
    const [transactions, customers, staff] = await Promise.all([
      getWalletTransactions(account, { ownerType, ownerId }),
      getWalletAccounts(account, "customer"),
      getWalletAccounts(account, "staff"),
    ]);
    return sendJson(res, { ok: true, transactions, wallets: [...customers, ...staff] });
  }

  const walletsMatch = urlPath.match(/^\/api\/wallets\/([^/]+)$/);
  if (req.method === "GET" && walletsMatch) {
    const account = decodeURIComponent(walletsMatch[1]);
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ownerType = normalizeWalletOwnerType(requestUrl.searchParams.get("ownerType"));
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (!ownerType) return sendJson(res, { ok: false, message: "余额账户类型无效" }, 400);
    return sendJson(res, { ok: true, wallets: await getWalletAccounts(account, ownerType) });
  }

  const staffGrantsMatch = urlPath.match(/^\/api\/staff-grants\/([^/]+)$/);
  if (staffGrantsMatch) {
    const account = decodeURIComponent(staffGrantsMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") {
      // 顺手带出「他是被哪位管事邀请进来的」——管事邀请的打手会同步出现在
      // 陪玩管理 / 员工列表里，这里给出邀请来源，商户能对上人。
      const [rows] = await getPool().execute(
        `SELECT g.customer_key AS customerKey, c.numeric_id AS numericId, c.display_name AS displayName, g.granted_by AS grantedBy, g.created_at AS createdAt,
                s.customer_key AS stewardKey, s.display_name AS stewardName, s.numeric_id AS stewardNumeric
         FROM staff_grants g
         LEFT JOIN customers c ON c.customer_key = g.customer_key
         LEFT JOIN steward_relations r ON r.account = g.account AND r.staff_key = g.customer_key
         LEFT JOIN stewards s ON s.account = r.account AND s.customer_key = r.steward_key
         WHERE g.account = ? ORDER BY g.created_at DESC`,
        [account],
      );
      return sendJson(res, {
        ok: true,
        grants: rows.map((row) => ({
          customerId: String(row.customerKey),
          numericId: row.numericId == null ? "" : String(row.numericId),
          displayName: String(row.displayName || "未知用户"),
          grantedBy: String(row.grantedBy || ""),
          createdAt: Number(row.createdAt || 0),
          // 带上管事的 customerKey：后台「分销管理」要靠它把某个打手的手续费专项
          // 挂到正确的管事名下（只给名字的话，两个同名管事就对错了人）。
          invitedBy: row.stewardKey
            ? { customerId: String(row.stewardKey), displayName: String(row.stewardName || ""), numericId: row.stewardNumeric == null ? "" : String(row.stewardNumeric) }
            : null,
        })),
      });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const action = body.action === "revoke" ? "revoke" : "grant";
      const numericId = String(body.numericId || "").trim();
      if (!/^\d{6,12}$/.test(numericId)) return sendJson(res, { ok: false, message: "请输入客户在“我的”页面展示的数字 ID" }, 400);
      const [customers] = await getPool().execute(
        "SELECT customer_key, display_name FROM customers WHERE numeric_id = ?",
        [Number(numericId)],
      );
      if (!customers[0]) return sendJson(res, { ok: false, message: "没有找到这个数字 ID 对应的客户，请确认对方已登录过小程序" }, 404);
      const customerKey = String(customers[0].customer_key);
      if (action === "grant") {
        await getPool().execute(
          "INSERT IGNORE INTO staff_grants (account, customer_key, granted_by, created_at) VALUES (?, ?, ?, ?)",
          [account, customerKey, session.account, now()],
        );
      } else {
        await getPool().execute(
          "DELETE FROM staff_grants WHERE account = ? AND customer_key = ?",
          [account, customerKey],
        );
        await getPool().execute(
          "DELETE FROM customer_sessions WHERE customer_key = ?",
          [customerKey],
        );
      }
      return sendJson(res, { ok: true, displayName: String(customers[0].display_name || "") });
    }
  }

  // 后台「员工管理 / 管事邀请码」：生成升级码、看码和管事名单、停用还没用掉的码。
  const stewardInvitesMatch = urlPath.match(/^\/api\/steward-invites\/([^/]+)$/);
  if (stewardInvitesMatch) {
    const account = decodeURIComponent(stewardInvitesMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") {
      const [stewardRows] = await getPool().execute(
        `SELECT s.customer_key AS customerKey, s.display_name AS displayName, s.numeric_id AS numericId,
                s.redeemed_from AS redeemedFrom, s.created_at AS createdAt,
                (SELECT COUNT(*) FROM steward_relations r WHERE r.account = s.account AND r.steward_key = s.customer_key) AS subordinateCount
         FROM stewards s WHERE s.account = ? ORDER BY s.created_at DESC`,
        [account],
      );
      return sendJson(res, {
        ok: true,
        codes: await listStewardCodes(account),
        stewards: stewardRows.map((row) => ({
          customerId: String(row.customerKey),
          displayName: String(row.displayName || "未知用户"),
          numericId: row.numericId == null ? "" : String(row.numericId),
          redeemedFrom: String(row.redeemedFrom || ""),
          subordinateCount: Number(row.subordinateCount || 0),
          createdAt: Number(row.createdAt || 0),
        })),
      });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body.action === "disable") {
        const code = String(body.code || "").trim().toUpperCase();
        const [result] = await getPool().execute(
          "UPDATE steward_invite_codes SET status = 'disabled' WHERE account = ? AND code = ? AND status = 'unused'",
          [account, code],
        );
        if (!result.affectedRows) return sendJson(res, { ok: false, message: "只有还没被使用的邀请码可以停用" }, 400);
        return sendJson(res, { ok: true });
      }
      const count = Math.min(20, Math.max(1, Math.floor(Number(body.count || 1)) || 1));
      const codes = [];
      for (let index = 0; index < count; index += 1) {
        codes.push(await createStewardCode({ account, kind: "steward", issuerKey: "", issuerName: session.account }));
      }
      return sendJson(res, { ok: true, codes });
    }
  }

  // 后台「提现审核」：列表 + 通过 / 驳回。驳回必须写原因，整笔原路退回本人账户。
  const withdrawOrdersMatch = urlPath.match(/^\/api\/withdraw-orders\/([^/]+)$/);
  if (req.method === "GET" && withdrawOrdersMatch) {
    const account = decodeURIComponent(withdrawOrdersMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const status = String(requestUrl.searchParams.get("status") || "");
    return sendJson(res, { ok: true, orders: await listWithdrawOrders(account, { status }) });
  }

  const withdrawReviewMatch = urlPath.match(/^\/api\/withdraw-orders\/([^/]+)\/([^/]+)\/review$/);
  if (req.method === "POST" && withdrawReviewMatch) {
    const account = decodeURIComponent(withdrawReviewMatch[1]), orderNo = decodeURIComponent(withdrawReviewMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    try {
      const body = await readBody(req);
      const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : "";
      const order = await reviewWithdrawOrder(account, orderNo, { decision, reason: body.reason }, session.account);
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  // 后台「功能 / 保证金」：只读汇总。保证金是打手在自己小程序里充的（owner_type='staff_bond'），
  // 商户这边不加不减 —— 所以这条**只有 GET**，别给它配 POST。
  const bondsMatch = urlPath.match(/^\/api\/bonds\/([^/]+)$/);
  if (req.method === "GET" && bondsMatch) {
    const account = decodeURIComponent(bondsMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    return sendJson(res, { ok: true, bonds: await listStaffBonds(account) });
  }

  // 后台「员工管理 / 排行榜」：打手接单流水（接单笔数 + 成交额），只读。
  const staffOrderStatsMatch = urlPath.match(/^\/api\/staff-order-stats\/([^/]+)$/);
  if (req.method === "GET" && staffOrderStatsMatch) {
    const account = decodeURIComponent(staffOrderStatsMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    return sendJson(res, { ok: true, stats: await staffOrderStats(account) });
  }

  // 后台「功能 / 罚单」：开单 / 撤销 / 查看。打手那边只能看和交，改不了。
  const fineRevokeMatch = urlPath.match(/^\/api\/fines\/([^/]+)\/([^/]+)\/revoke$/);
  if (req.method === "POST" && fineRevokeMatch) {
    const account = decodeURIComponent(fineRevokeMatch[1]), fineNo = decodeURIComponent(fineRevokeMatch[2]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    try {
      const body = await readBody(req);
      return sendJson(res, { ok: true, fine: await revokeStaffFine(account, fineNo, body.reason, session.account) });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  const finesMatch = urlPath.match(/^\/api\/fines\/([^/]+)$/);
  if (finesMatch) {
    const account = decodeURIComponent(finesMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const staffKey = String(requestUrl.searchParams.get("staffKey") || "");
      if (staffKey && !isSafeCustomerId(staffKey)) return sendJson(res, { ok: false, message: "打手标识无效" }, 400);
      return sendJson(res, {
        ok: true,
        // 后台列表不分页：一次给全量（跟提现审核一致），页面上按状态筛选。
        fines: await listStaffFines(account, staffKey, { status: requestUrl.searchParams.get("status") ?? -1, limit: 50 }),
      });
    }
    if (req.method === "POST") {
      try {
        const body = await readBody(req);
        return sendJson(res, { ok: true, fine: await createStaffFine(account, body, session.account) });
      } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
    }
  }

  const reviewsMatch = urlPath.match(/^\/api\/reviews\/([^/]+)$/);
  if (reviewsMatch) {
    const account = decodeURIComponent(reviewsMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") {
      const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      const status = String(requestUrl.searchParams.get("status") || "");
      return sendJson(res, {
        ok: true,
        reviews: await listReviews(account, {
          status: reviewStatuses.has(status) ? status : "",
          limit: 500,
        }),
      });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const result = await reviewOrderReview(account, session.account, body);
      if (!result.ok) return sendJson(res, { ok: false, message: result.error }, result.status);
      return sendJson(res, { ok: true, review: result.review });
    }
  }

  const configMatch = urlPath.match(/^\/api\/config\/([^/]+)$/);
  if (configMatch) {
    const account = decodeURIComponent(configMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") return sendJson(res, await getConfig(account));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!isSafePayload(body.config) || hasUnsafeContent(body.config)) {
        return sendJson(res, { ok: false, message: "配置数据无效、过大或包含不允许的字符" }, 400);
      }
      if (shared.staffBondRequirementValue(body.config.staffBondRequirement) === null) {
        return sendJson(res, { ok: false, message: "接单保证金需为 0 至 1000000 元，最多两位小数" }, 400);
      }
      const config = { ...body.config };
      delete config.broadcasts;
      delete config.homeBroadcasts;
      const updatedAt = await saveConfig(account, config);
      return sendJson(res, { ok: true, updatedAt });
    }
  }

  const resolveComplaintMatch = urlPath.match(/^\/api\/orders\/([^/]+)\/([^/]+)\/complaint\/resolve$/);
  if (req.method === "POST" && resolveComplaintMatch) {
    const account = decodeURIComponent(resolveComplaintMatch[1]), orderNo = decodeURIComponent(resolveComplaintMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record?.payload.complaint) throw new Error("订单没有待处理投诉");
        if (record.payload.complaint.status === "resolved") return record.payload;
        const payload = { ...record.payload, complaint: { ...record.payload.complaint, status: "resolved", resolvedAt: now(), resolvedBy: session.account } };
        await updateOrderPayloadById(record.id, payload, connection);
        return payload;
      });
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  const merchantAssignmentMatch = urlPath.match(/^\/api\/orders\/([^/]+)\/([^/]+)\/(assign|requeue)$/);
  if (req.method === "POST" && merchantAssignmentMatch) {
    const account = decodeURIComponent(merchantAssignmentMatch[1]), orderNo = decodeURIComponent(merchantAssignmentMatch[2]);
    const action = merchantAssignmentMatch[3];
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return sendJson(res, { ok: false, message: "请求内容无效" }, 400);
    const staffId = String(body.staffId || "");
    if (action === "assign" && !isSafeCustomerId(staffId)) return sendJson(res, { ok: false, message: "请选择已授权打手" }, 400);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record) throw new Error("订单不存在");
        const current = record.payload;
        if (String(current.staffId || "") !== String(body.expectedStaffId || "")
          || Number(current.acceptedAt || 0) !== Number(body.expectedAcceptedAt || 0)) {
          throw new Error("订单接单状态已变化，请刷新后重试");
        }
        let actor = { role: "merchant", id: session.account };
        if (action === "assign") {
          const [staffRows] = await connection.execute(
            "SELECT c.display_name FROM staff_grants g JOIN customers c ON c.customer_key = g.customer_key WHERE g.account = ? AND g.customer_key = ? LIMIT 1",
            [account, staffId],
          );
          if (!staffRows[0]) throw new Error("打手未获当前商户授权，请刷新员工列表");
          actor = { ...actor, staffId, staffName: String(staffRows[0].display_name || "当前打手").slice(0, 80) };
        }
        const next = advanceOrder(current, action, actor, now());
        const changed = JSON.stringify(next) !== JSON.stringify(current);
        if (action === "assign" && changed) {
          const bondError = await staffBondShortfall(account, staffId, connection);
          if (bondError) throw new Error(bondError);
        }
        if (changed) await updateOrderPayloadById(record.id, next, connection);
        return next;
      });
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }

  const refundOrderMatch = urlPath.match(/^\/api\/orders\/([^/]+)\/([^/]+)\/refund$/);
  if (req.method === "POST" && refundOrderMatch) {
    const account = decodeURIComponent(refundOrderMatch[1]), orderNo = decodeURIComponent(refundOrderMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    const reason = String(body.reason || "").trim();
    if (!reason || Buffer.byteLength(reason, "utf8") > 80 || hasUnsafeContent(reason)) {
      return sendJson(res, { ok: false, message: "请填写 80 字节以内的退款原因" }, 400);
    }
    try {
      const existing = await getOrderRecord(account, orderNo);
      if (!existing) return sendJson(res, { ok: false, message: "订单不存在" }, 404);
      const original = existing.payload;
      if (original.paymentStatus === "refunded") return sendJson(res, { ok: true, order: original });
      if (!["paid", "refund_pending", "refund_closed"].includes(original.paymentStatus)) {
        throw new Error("只有已付款订单可以退款");
      }
      const amountFen = refundAmountFen(original);
      const method = original.paymentMethod;
      if (method !== "balance" && method !== "wechat") throw new Error("原支付方式不明，请人工核对后处理");
      const payConfig = method === "wechat" ? wechatPay.wechatPayConfig() : null;
      if (payConfig && !payConfig.configured) throw new Error("微信支付配置不完整，暂不能发起退款");
      if (original.paymentStatus === "refund_closed") {
        if (method !== "wechat" || !original.refund?.outRefundNo) throw new Error("原退款记录不完整，请人工核对后处理");
        const checked = await applyWechatRefundState(account, orderNo, await wechatPay.queryRefund(payConfig, original.refund.outRefundNo));
        if (checked.paymentStatus !== "refund_closed") return sendJson(res, { ok: true, order: checked });
      }
      if (method === "wechat" && original.paymentStatus !== "refund_pending") {
        const [intents] = await getPool().execute(
          "SELECT trade_no, amount_fen, transaction_id FROM payment_intents WHERE account = ? AND purpose = 'order' AND reference_no = ? AND status = 'paid' LIMIT 1",
          [account, orderNo],
        );
        if (!intents[0] || Number(intents[0].amount_fen) !== amountFen) throw new Error("原微信支付记录与订单金额不一致，已停止退款");
        const trade = await wechatPay.queryTransaction(payConfig, String(intents[0].trade_no));
        if (trade.trade_state !== "SUCCESS" || Number(trade.amount?.total) !== amountFen
          || String(trade.mchid || "") !== payConfig.mchId) throw new Error("微信尚未确认原订单支付成功，已停止退款");
      }
      const result = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record) throw new Error("订单不存在");
        const order = { ...record.payload };
        if (order.paymentStatus === "refunded" || order.paymentStatus === "refund_pending") return order;
        if (order.paymentStatus !== original.paymentStatus || !["paid", "refund_closed"].includes(order.paymentStatus)
          || (order.paymentStatus === "refund_closed" && order.refund?.outRefundNo !== original.refund?.outRefundNo)
          || refundAmountFen(order) !== amountFen || order.paymentMethod !== method) throw new Error("订单状态或金额已变化，请刷新后重试");
        const refund = { method, amountFen, reason, requestedAt: now(), requestedBy: session.account, previousStatus: order.status };
        if (method === "balance") {
          const [debits] = await connection.execute(
            "SELECT id FROM wallet_transactions WHERE account = ? AND owner_type = 'customer' AND owner_id = ? AND transaction_type = 'order_payment' AND reference_no = ? AND amount = ? LIMIT 1 FOR UPDATE",
            [account, record.customerId, orderNo, -amountFen / 100],
          );
          if (!debits[0]) throw new Error("找不到原余额扣款流水，已停止退款");
          const requestId = `refund_${crypto.createHash("sha256").update(`${account}:${orderNo}`).digest("hex").slice(0, 48)}`;
          const credit = normalizeCredit(account, session.account, { requestId, ownerType: "customer", ownerId: record.customerId, amount: fenToYuan(amountFen), note: `订单 ${orderNo} 退款：${reason}` });
          credit.transactionType = "order_refund";
          await applyCredit(connection, account, session.account, credit,
            () => resolveWalletOwner(account, "customer", record.customerId, "", connection));
          Object.assign(refund, { status: "SUCCESS", completedAt: now() });
          Object.assign(order, { refund, paymentStatus: "refunded", status: "已退款" });
        } else {
          const [intents] = await connection.execute(
            "SELECT trade_no, amount_fen FROM payment_intents WHERE account = ? AND purpose = 'order' AND reference_no = ? AND status = 'paid' LIMIT 1 FOR UPDATE",
            [account, orderNo],
          );
          if (!intents[0] || Number(intents[0].amount_fen) !== amountFen) throw new Error("原微信支付记录与订单金额不一致，已停止退款");
          Object.assign(refund, { status: "REQUESTING", tradeNo: String(intents[0].trade_no), outRefundNo: newPaymentTradeNo("RF") });
          Object.assign(order, { refund, paymentStatus: "refund_pending", status: "退款中" });
        }
        await updateOrderPayloadById(record.id, order, connection);
        return order;
      });
      if (result.paymentStatus !== "refund_pending") return sendJson(res, { ok: true, order: result });
      const refund = result.refund;
      let remote;
      if (refund.status !== "REQUESTING") {
        try { remote = await wechatPay.queryRefund(payConfig, refund.outRefundNo); }
        catch (error) { if (error.code !== "RESOURCE_NOT_EXISTS") throw error; }
      }
      if (!remote) remote = await wechatPay.requestRefund(payConfig, {
        outTradeNo: refund.tradeNo, outRefundNo: refund.outRefundNo, amountFen: refund.amountFen, reason: refund.reason,
      });
      return sendJson(res, { ok: true, order: await applyWechatRefundState(account, orderNo, remote) });
    } catch (error) {
      const status = error instanceof wechatPay.WechatPayError ? error.status : 409;
      return sendJson(res, { ok: false, message: error.message || "退款失败，请刷新核对结果", code: error.code }, status);
    }
  }

  const finishOrderMatch = urlPath.match(/^\/api\/orders\/([^/]+)\/([^/]+)\/finish$/);
  if (req.method === "POST" && finishOrderMatch) {
    const account = decodeURIComponent(finishOrderMatch[1]), orderNo = decodeURIComponent(finishOrderMatch[2]);
    if (!isSafeAccount(account) || !isSafeOrderNo(orderNo) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    try {
      const order = await runTransaction(async (connection) => {
        const record = await getOrderRecord(account, orderNo, connection, true);
        if (!record) throw new Error("订单不存在");
        return completeOrderAndCreditStaff(connection, {
          account, orderNo, record, action: "finish", actor: { role: "merchant", id: session.account },
        });
      });
      return sendJson(res, { ok: true, order });
    } catch (error) { return sendJson(res, { ok: false, message: error.message }, 409); }
  }
  const ordersMatch = urlPath.match(/^\/api\/orders\/([^/]+)$/);
  if (ordersMatch) {
    const account = decodeURIComponent(ordersMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") {
      await expireUnpaidOrders(account);
      const [rows] = await getPool().execute(
        `SELECT id, payload FROM orders WHERE account = ? ORDER BY created_at DESC, id DESC LIMIT ${maxArrayItems}`,
        [account],
      );
      return sendJson(res, rows.map((row) => ({ ...jsonParse(row.payload, {}), dbId: Number(row.id) })));
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.orders) || body.orders.length > maxArrayItems || hasUnsafeContent(body.orders)) {
        return sendJson(res, { ok: false, message: "订单数据无效" }, 400);
      }
      await replaceOrders(account, body.orders);
      return sendJson(res, { ok: true });
    }
  }

  const chatSummaryMatch = urlPath.match(/^\/api\/order-chat\/([^/]+)$/);
  if (req.method === "POST" && chatSummaryMatch) {
    const account = decodeURIComponent(chatSummaryMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    const body = await readBody(req);
    const orderNos = Array.isArray(body.orderNos) ? body.orderNos.map(String) : [];
    return sendJson(res, {
      ok: true,
      unread: {
        boss: await getChatUnreadSummary(account, "boss", orderNos),
        staff: await getChatUnreadSummary(account, "staff", orderNos),
      },
    });
  }

  const logsMatch = urlPath.match(/^\/api\/logs\/([^/]+)$/);
  if (logsMatch) {
    const account = decodeURIComponent(logsMatch[1]);
    if (!isSafeAccount(account) || !canAccess(session, account)) return sendJson(res, { ok: false }, 403);
    if (req.method === "GET") return sendJson(res, await getLogs(account));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!Array.isArray(body.logs) || body.logs.length > maxArrayItems || hasUnsafeContent(body.logs)) {
        return sendJson(res, { ok: false, message: "日志数据无效" }, 400);
      }
      await replaceLogs(account, body.logs);
      return sendJson(res, { ok: true });
    }
  }

  return sendJson(res, { ok: false, message: "接口不存在" }, 404);
}

let server;

async function start() {
  const errors = runtimeErrors(process.env);
  if (errors.length) throw new Error(errors.join("; "));
  await initializeDatabase();
  await seedLegacyStoreWhenEmpty();
  await repairStoredConfigs();
  await ensureOwnerAccount();
  const orderExpiryTimer = setInterval(async () => {
    try {
      const [accounts] = await getPool().execute("SELECT DISTINCT account FROM orders WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.paymentStatus')) = 'pending'");
      for (const row of accounts) await expireUnpaidOrders(row.account);
    } catch (error) { console.error("订单超时检查失败", error.message); }
  }, 15000);
  orderExpiryTimer.unref();
  const refundReconcileTimer = setInterval(async () => {
    try {
      const config = wechatPay.wechatPayConfig();
      if (!config.configured) return;
      const [rows] = await getPool().execute(
        "SELECT account, order_no FROM orders WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.paymentStatus')) = 'refund_pending' LIMIT 100",
      );
      for (const row of rows) {
        try { await reconcileWechatRefund(row.account, row.order_no, config); }
        catch (error) { if (error.code !== "RESOURCE_NOT_EXISTS") console.error("微信退款对账失败", row.account, row.order_no, error.message); }
      }
    } catch (error) { console.error("微信退款对账失败", error.message); }
  }, 60 * 1000);
  refundReconcileTimer.unref();

  server = http.createServer(createRequestHandler());

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  console.log(`电竞俱乐部系统已启动：http://${host}:${port}`);
  console.log(`数据库：MySQL/${databaseName}（utf8mb4）`);
  if (isProduction) {
    console.log(allowPublicTrade
      ? "生产模式：客户交易接口已开放（微信登录 + 会话令牌鉴权）"
      : "生产模式：客户交易接口保持关闭，设置 ALLOW_PUBLIC_TRADE=true 且完成支付验收后开放");
  }
  const payConfig = wechatPay.wechatPayConfig();
  console.log(payConfig.configured
    ? "微信支付：已开通（小程序充值 + 订单付款，回调地址 " + payConfig.notifyUrl + "）"
    : `微信支付：未开通，缺少配置 ${payConfig.missing.join("、")}；客户目前只能用余额付款，充值会明确提示未接通`);
}

function createRequestHandler({ staticRoot = root, apiHandler = handleApi } = {}) {
  return async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      if (urlPath.startsWith("/api/")) return await apiHandler(req, res, urlPath);
      if (!["GET", "HEAD"].includes(req.method || "GET")) {
        res.statusCode = 405;
        return res.end("Method not allowed");
      }
      const target = await publicFileTarget(staticRoot, urlPath);
      if (!target) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      fs.readFile(target, (error, data) => {
        if (error) {
          res.statusCode = 404;
          return res.end("Not found");
        }
        setSecurityHeaders(res, mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream");
        res.setHeader("Cache-Control", isProduction ? "public, max-age=300" : "no-cache");
        res.statusCode = 200;
        res.end(req.method === "HEAD" ? undefined : data);
      });
    } catch (error) {
      const malformed = error instanceof URIError;
      if (!malformed) console.error(error);
      if (!res.headersSent) return sendJson(res, { ok: false, message: malformed ? "请求地址格式错误" : (isProduction ? "请求失败，请稍后重试" : error.message || "请求失败") }, malformed ? 400 : 500);
      res.end();
    }
  };
}

async function shutdown() {
  const forceExit = setTimeout(() => process.exit(1), 5000);
  forceExit.unref();
  if (server) await new Promise((resolve) => server.close(resolve));
  await closeDatabase();
  clearTimeout(forceExit);
  process.exit(0);
}

if (require.main === module) {
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  start().catch((error) => {
    console.error("启动失败：", error);
    process.exitCode = 1;
  });
}

module.exports = { createRequestHandler, handleApi, publicOrder, getStaffOrders, getSession, seedLegacyStoreWhenEmpty, canAccess, ensureCustomerByOpenid, creditWallet, settlePaymentIntent, markOrderPaid, yuanToFen, fenToYuan, normalizeStoredConfig, repairStoredConfigs };
