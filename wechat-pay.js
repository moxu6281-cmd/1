"use strict";
// 微信支付 v3（JSAPI）直连实现。只用 node:crypto 与内置 fetch，不引入第三方 SDK ——
// 商用系统里支付密钥链路越少依赖越好，签名字段也能一眼看清。
//
// 需要商户在服务器 .env 里配置（缺任意一项就视为未开通，接口会明确报错而不是静默失败）：
//   WX_APPID                 小程序 AppID（与小程序 wx.login 同一个）
//   WXPAY_MCHID              微信支付商户号
//   WXPAY_SERIAL_NO          商户 API 证书序列号
//   WXPAY_PRIVATE_KEY_PATH   apiclient_key.pem 的绝对路径
//   WXPAY_APIV3_KEY          APIv3 密钥（32 位）
//   WXPAY_NOTIFY_URL         支付结果回调地址（必须公网 HTTPS，且不带参数）
//   WXPAY_PLATFORM_CERT_PATH 微信支付平台证书 public key（可选，配了就额外校验回调签名）
const crypto = require("node:crypto");
const fs = require("node:fs");

const WECHAT_PAY_HOST = "https://api.mch.weixin.qq.com";
const JSAPI_PATH = "/v3/pay/transactions/jsapi";
const REQUIRED_KEYS = ["WXPAY_MCHID", "WXPAY_SERIAL_NO", "WXPAY_PRIVATE_KEY_PATH", "WXPAY_APIV3_KEY", "WXPAY_NOTIFY_URL"];

class WechatPayError extends Error {
  constructor(message, { status = 502, code = "WXPAY_FAILED", detail = "" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

function readKeyFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new WechatPayError(`微信支付私钥读取失败：${error.message}`, { code: "WXPAY_KEY_UNREADABLE" });
  }
}

// 配置缺口要能直接告诉商户缺什么，而不是让他在"点了没反应"里排查。
function wechatPayConfig(env = process.env) {
  const missing = REQUIRED_KEYS.filter((key) => !String(env[key] || "").trim());
  const appId = String(env.WX_APPID || "").trim();
  if (!appId) missing.push("WX_APPID");
  const apiV3Key = String(env.WXPAY_APIV3_KEY || "");
  if (apiV3Key && Buffer.byteLength(apiV3Key, "utf8") !== 32) {
    missing.push("WXPAY_APIV3_KEY(必须32位)");
  }
  return {
    configured: missing.length === 0,
    missing,
    appId,
    mchId: String(env.WXPAY_MCHID || "").trim(),
    serialNo: String(env.WXPAY_SERIAL_NO || "").trim(),
    privateKeyPath: String(env.WXPAY_PRIVATE_KEY_PATH || "").trim(),
    apiV3Key,
    notifyUrl: String(env.WXPAY_NOTIFY_URL || "").trim(),
    platformCertPath: String(env.WXPAY_PLATFORM_CERT_PATH || "").trim(),
  };
}

function signatureMessage({ method, urlPath, timestamp, nonce, body }) {
  return `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
}

function buildAuthorization({ method, urlPath, body, mchId, serialNo, privateKey, timestamp, nonce }) {
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signatureMessage({ method, urlPath, timestamp, nonce, body }), "utf8"), privateKey).toString("base64");
  return [
    "WECHATPAY2-SHA256-RSA2048",
    `mchid="${mchId}"`,
    `nonce_str="${nonce}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${serialNo}"`,
  ].join(" ");
}

// 调起 wx.requestPayment 的五个参数。签名串顺序是固定的：appId\n时间戳\n随机串\npackage\n
function jsapiPayParams({ appId, prepayId, privateKey, timestamp, nonce }) {
  const packageValue = `prepay_id=${prepayId}`;
  const paySign = crypto.sign("RSA-SHA256", Buffer.from(`${appId}\n${timestamp}\n${nonce}\n${packageValue}\n`, "utf8"), privateKey).toString("base64");
  return { timeStamp: timestamp, nonceStr: nonce, package: packageValue, signType: "RSA", paySign };
}

function randomNonce() {
  return crypto.randomBytes(16).toString("hex");
}

async function callWechatPay(config, { method = "POST", urlPath, body = "" }) {
  if (!config.configured) {
    throw new WechatPayError(`微信支付未开通，服务器缺少配置：${config.missing.join("、")}`, { status: 503, code: "PAYMENT_NOT_CONFIGURED" });
  }
  const privateKey = readKeyFile(config.privateKeyPath);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomNonce();
  const authorization = buildAuthorization({
    method, urlPath, body, mchId: config.mchId, serialNo: config.serialNo, privateKey, timestamp, nonce,
  });
  const response = await fetch(`${WECHAT_PAY_HOST}${urlPath}`, {
    method,
    headers: {
      Authorization: authorization,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "esports-club-system/1.0",
    },
    body: method === "GET" ? undefined : body,
  }).catch((error) => {
    // 网络不通也要给出可读原因：这类失败在商用系统里必须能一眼看出是"没连上微信"。
    throw new WechatPayError(`无法连接微信支付接口：${error.message}`, { status: 502, code: "WXPAY_UNREACHABLE" });
  });
  const text = await response.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch {}
  if (!response.ok) {
    const message = payload?.message || `微信支付接口返回 ${response.status}`;
    throw new WechatPayError(`微信支付请求失败：${message}`, {
      status: 502,
      code: payload?.code || "WXPAY_FAILED",
      detail: text.slice(0, 500),
    });
  }
  return payload;
}

// 下单只创建预支付单，钱到账一律以回调/查单为准 —— 客户端返回成功不算数。
async function createJsapiPrepay(config, { outTradeNo, amountFen, description, openid, attach = "", expiresAt }) {
  if (!Number.isInteger(amountFen) || amountFen < 1) throw new WechatPayError("支付金额必须是大于 0 的整数分", { status: 400 });
  if (!openid) throw new WechatPayError("缺少微信支付所需的 openid，请先在小程序内用微信登录", { status: 400, code: "OPENID_REQUIRED" });
  const body = JSON.stringify({
    appid: config.appId,
    mchid: config.mchId,
    description: String(description || "会员充值").slice(0, 127),
    out_trade_no: outTradeNo,
    notify_url: config.notifyUrl,
    attach: String(attach || "").slice(0, 127),
    ...(expiresAt ? { time_expire: new Date(expiresAt).toISOString().replace(/\.\d{3}Z$/, '+00:00') } : {}),
    amount: { total: amountFen, currency: "CNY" },
    payer: { openid },
  });
  const payload = await callWechatPay(config, { urlPath: JSAPI_PATH, body });
  if (!payload?.prepay_id) throw new WechatPayError("微信支付未返回预支付标识", { detail: JSON.stringify(payload || {}).slice(0, 300) });
  const privateKey = readKeyFile(config.privateKeyPath);
  return {
    prepayId: payload.prepay_id,
    payment: jsapiPayParams({
      appId: config.appId, prepayId: payload.prepay_id, privateKey,
      timestamp: String(Math.floor(Date.now() / 1000)), nonce: randomNonce(),
    }),
  };
}

async function queryTransaction(config, outTradeNo) {
  const urlPath = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchId)}`;
  return callWechatPay(config, { method: "GET", urlPath });
}

async function requestRefund(config, { outTradeNo, outRefundNo, amountFen, reason }) {
  if (!Number.isSafeInteger(amountFen) || amountFen < 1) throw new WechatPayError("退款金额必须是大于 0 的整数分", { status: 400 });
  return callWechatPay(config, {
    urlPath: "/v3/refund/domestic/refunds",
    body: JSON.stringify({
      out_trade_no: outTradeNo,
      out_refund_no: outRefundNo,
      reason: String(reason || "订单无法完成").slice(0, 40),
      amount: { refund: amountFen, total: amountFen, currency: "CNY" },
    }),
  });
}

async function queryRefund(config, outRefundNo) {
  return callWechatPay(config, { method: "GET", urlPath: `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}` });
}

// 回调报文用 APIv3 密钥做 AES-256-GCM 解密：能解开即证明报文来自微信（只有微信持有该密钥），
// 但金额、商户号、AppID 仍要逐项核对，避免"解开了就入账"。
function decryptNotificationResource(apiV3Key, resource) {
  const ciphertext = String(resource?.ciphertext || "");
  const nonce = String(resource?.nonce || "");
  if (!ciphertext || !nonce) throw new WechatPayError("微信支付回调报文缺少密文", { status: 400, code: "WXPAY_BAD_NOTIFY" });
  // 微信的 nonce 是 12 位 ASCII 字符串，直接当 GCM 的 IV 用；长度不对就是报文有问题，
  // 这里先挡住，免得抛出一个看不出原因的 OpenSSL 错误。
  if (Buffer.byteLength(nonce, "utf8") !== 12) {
    throw new WechatPayError("微信支付回调 nonce 长度异常", { status: 400, code: "WXPAY_BAD_NOTIFY" });
  }
  const data = Buffer.from(ciphertext, "base64");
  if (data.length <= 16) throw new WechatPayError("微信支付回调密文长度异常", { status: 400, code: "WXPAY_BAD_NOTIFY" });
  let plain;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key, "utf8"), Buffer.from(nonce, "utf8"));
    decipher.setAuthTag(data.subarray(data.length - 16));
    const associatedData = String(resource?.associated_data || "");
    if (associatedData) decipher.setAAD(Buffer.from(associatedData, "utf8"));
    plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
  } catch (error) {
    throw new WechatPayError("微信支付回调解密失败，报文可能被篡改", { status: 400, code: "WXPAY_BAD_NOTIFY", detail: error.message });
  }
  try {
    return JSON.parse(plain);
  } catch (error) {
    throw new WechatPayError("微信支付回调内容不是合法 JSON", { status: 400, code: "WXPAY_BAD_NOTIFY" });
  }
}

// 配置了平台证书就额外校验 Wechatpay-Signature；没配则依赖上面的 GCM 解密校验。
function verifyNotificationSignature({ headers, rawBody, platformPublicKey }) {
  if (!platformPublicKey) return { verified: false, reason: "未配置平台证书，跳过签名校验（已用 APIv3 密钥解密校验）" };
  const timestamp = String(headers["wechatpay-timestamp"] || "");
  const nonce = String(headers["wechatpay-nonce"] || "");
  const signature = String(headers["wechatpay-signature"] || "");
  if (!timestamp || !nonce || !signature) throw new WechatPayError("微信支付回调缺少签名头", { status: 400, code: "WXPAY_BAD_NOTIFY" });
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const ok = crypto.verify("RSA-SHA256", Buffer.from(message, "utf8"), platformPublicKey, Buffer.from(signature, "base64"));
  if (!ok) throw new WechatPayError("微信支付回调签名校验失败", { status: 400, code: "WXPAY_BAD_NOTIFY" });
  return { verified: true, reason: "平台证书签名校验通过" };
}

function loadPlatformPublicKey(config) {
  if (!config.platformCertPath) return "";
  return readKeyFile(config.platformCertPath);
}

module.exports = {
  WechatPayError,
  WECHAT_PAY_HOST,
  JSAPI_PATH,
  wechatPayConfig,
  signatureMessage,
  buildAuthorization,
  jsapiPayParams,
  createJsapiPrepay,
  queryTransaction,
  requestRefund,
  queryRefund,
  decryptNotificationResource,
  verifyNotificationSignature,
  loadPlatformPublicKey,
};
