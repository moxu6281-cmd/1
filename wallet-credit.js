"use strict";

const crypto = require("node:crypto");

class WalletCreditError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function creditAmount(value) {
  const text = String(value ?? "").trim();
  if (!/^(0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(text)) throw new WalletCreditError("增加金额必须精确到分，最多两位小数");
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents < 1 || cents > 100000000) throw new WalletCreditError("增加金额需大于 0，且不超过 1000000 元");
  return { cents, decimal: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}` };
}

function normalizeCredit(account, operatorAccount, input) {
  const requestId = String(input?.requestId || "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) throw new WalletCreditError("缺少有效的操作编号，请刷新后台后重试");
  const ownerType = input?.ownerType;
  const ownerId = String(input?.ownerId || "").trim();
  if (!["customer", "staff"].includes(ownerType) || !ownerId || ownerId.length > 80
    || /[\u0000-\u001f<>]/.test(ownerId)) throw new WalletCreditError("余额账户标识无效");
  const { cents, decimal } = creditAmount(input?.amount);
  const note = String(input?.note ?? "商户后台增加余额").trim();
  if (note.length > 200) throw new WalletCreditError("备注不能超过 200 字");
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify({ account, operatorAccount, ownerType, ownerId, cents, note })).digest("hex");
  return { requestId, ownerType, ownerId, amount: decimal, note, fingerprint };
}

async function applyCredit(connection, account, operatorAccount, credit, resolveName, timestamp = Date.now()) {
  const { requestId, ownerType, ownerId, amount, note, fingerprint } = credit;
  // 资金入口不同，流水类型必须不同：后台加款是 merchant_credit，客户微信充值要记成
  // customer_recharge，否则对账时"商户加的钱"和"客户自己充的钱"会混在一起。
  const transactionType = credit.transactionType || "merchant_credit";
  // The unique receipt row serializes retries before any balance mutation. Its
  // insert, balance change, ledger and saved result all commit or roll back together.
  await connection.execute(
    `INSERT INTO wallet_credit_requests (account, request_id, request_hash, result_payload, created_at)
     VALUES (?, ?, ?, NULL, ?)
     ON DUPLICATE KEY UPDATE request_id = request_id`,
    [account, requestId, fingerprint, timestamp],
  );
  const [requests] = await connection.execute(
    "SELECT request_hash, result_payload FROM wallet_credit_requests WHERE account = ? AND request_id = ? FOR UPDATE",
    [account, requestId],
  );
  const receipt = requests[0];
  if (!receipt) throw new Error("Missing wallet credit receipt");
  if (receipt.request_hash !== fingerprint) throw new WalletCreditError("操作编号已用于其他余额调整，请核对流水，不要重复提交", 409);
  if (receipt.result_payload) return JSON.parse(receipt.result_payload);
  const displayName = await resolveName(connection);
  await connection.execute(
    `INSERT INTO wallet_accounts (account, owner_type, owner_id, display_name, balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), balance = balance + VALUES(balance), updated_at = VALUES(updated_at)`,
    [account, ownerType, ownerId, displayName, amount, timestamp, timestamp],
  );
  const [rows] = await connection.execute(
    "SELECT owner_type, owner_id, display_name, balance, updated_at FROM wallet_accounts WHERE account = ? AND owner_type = ? AND owner_id = ? FOR UPDATE",
    [account, ownerType, ownerId],
  );
  if (!rows[0]) throw new Error("Missing wallet after credit");
  const row = rows[0];
  const wallet = { ownerType: String(row.owner_type), ownerId: String(row.owner_id), displayName: String(row.display_name), balance: Number(row.balance), updatedAt: Number(row.updated_at) };
  await connection.execute(
    `INSERT INTO wallet_transactions (account, owner_type, owner_id, amount, balance_after, transaction_type, reference_no, note, operator_account, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [account, ownerType, ownerId, amount, row.balance, transactionType, requestId, note, operatorAccount, timestamp],
  );
  await connection.execute(
    "UPDATE wallet_credit_requests SET result_payload = ? WHERE account = ? AND request_id = ?",
    [JSON.stringify(wallet), account, requestId],
  );
  return wallet;
}

module.exports = { WalletCreditError, creditAmount, normalizeCredit, applyCredit };
