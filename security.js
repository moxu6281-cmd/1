"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");

const publicFiles = new Set([
  "admin.html", "admin.css", "shared.js", "admin.js", "annotation-layer.js",
]);

function strongPassword(value) {
  return typeof value === "string" && value.length >= 16 && value.length <= 256
    && !/(change.this|password|admin123|123456)/i.test(value)
    && new Set(value).size >= 8;
}

function validPublicOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === "/"
      && !net.isIP(url.hostname) && !url.hostname.includes(":")
      && url.hostname.includes(".") && url.hostname !== "localhost"
      && !/(^|\.)(localhost|invalid|test|example\.com)$/.test(url.hostname);
  } catch { return false; }
}

function runtimeErrors(env) {
  const errors = [];
  const mode = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(mode)) errors.push("NODE_ENV must be development, test or production");
  if (mode !== "production" && !["127.0.0.1", "::1", "localhost"].includes(env.HOST || "127.0.0.1")) {
    errors.push("Development and test servers must bind to loopback");
  }
  if (mode === "production") {
    for (const key of ["ADMIN_PASSWORD", "DB_PASSWORD"]) {
      if (!strongPassword(env[key])) errors.push(`${key} must be a unique, non-placeholder password of at least 16 characters`);
    }
    if (env.ADMIN_PASSWORD === env.DB_PASSWORD) errors.push("Administrator and database passwords must be different");
    if (!/^[A-Za-z0-9_-]{3,48}$/.test(env.ADMIN_ACCOUNT || "")) errors.push("ADMIN_ACCOUNT is required and must be valid");
    if (!env.DB_USER || env.DB_USER.toLowerCase() === "root") errors.push("DB_USER must be a dedicated application user, not root");
    if (!/^[A-Za-z0-9_]+$/.test(env.DB_NAME || "")) errors.push("DB_NAME is required and must be valid");
    if (!validPublicOrigin(env.PUBLIC_ORIGIN)) errors.push("PUBLIC_ORIGIN must be the customer's HTTPS domain origin");
    if (env.ALLOW_DIRECT_RECHARGE === "true" || env.ENABLE_DEMO_RECHARGE === "true") errors.push("Direct recharge is forbidden in production");
    if (env.SEED_LEGACY_DATA === "true" || env.SEED_DEMO_DATA === "true") errors.push("Legacy/demo data import is forbidden in production");
    // 生产环境必须接入微信登录，客户身份不允许由客户端自报
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(env.WX_APPID || "")) errors.push("WX_APPID is required in production (miniprogram login)");
    if (String(env.WX_SECRET || "").length < 16) errors.push("WX_SECRET is required in production (miniprogram login)");
  }
  return errors;
}

// Public endpoints fall into three tiers:
//  - always open: read-only storefront data and the login endpoint itself
//  - trade tier: orders / wallets / chat, requires ALLOW_PUBLIC_TRADE=true once payments are wired
//  - backoffice writes: stay blocked until the admin API passes commercial review
function productionRouteBlock(method, urlPath, production, allowTrade = false) {
  if (!production) return false;
  if (urlPath.startsWith("/api/public/")) {
    if (method === "GET" && /^\/api\/public\/config\/[^/]+(?:\/meta)?$/.test(urlPath)) return false;
    if (method === "GET" && /^\/api\/public\/broadcasts\/[^/]+$/.test(urlPath)) return false;
    if (method === "POST" && urlPath === "/api/public/customer/session") return false;
    return !allowTrade;
  }
  if (method === "POST" && /^\/api\/orders\/[^/]+\/[^/]+\/(finish|refund)$/.test(urlPath)) return !allowTrade;
  return method !== "GET" && method !== "HEAD"
    && /^\/api\/(orders|logs|wallets)(\/|$)/.test(urlPath);
}

function isPublicFile(relative) {
  return publicFiles.has(relative)
    || /^data\/merchant-assets\/[A-Za-z0-9_-]{3,48}\/(?:hero-[a-f0-9]{16}\.(?:png|jpg|webp)|products\/product-[A-Za-z0-9_-]{1,80}-[a-f0-9]{16}\.(?:png|jpg|webp)|lottery-prizes\/prize-[A-Za-z0-9_-]{1,80}-[a-f0-9]{16}\.(?:png|jpg|webp))$/.test(relative);
}

async function publicFileTarget(root, urlPath) {
  const relative = urlPath === "/" ? "admin.html" : urlPath.slice(1);
  if (!isPublicFile(relative)) return null;
  const canonicalRoot = await fs.realpath(root);
  const target = path.join(canonicalRoot, ...relative.split("/"));
  try {
    // Reject symlinks/junctions even when a public-looking path points at a secret.
    if (await fs.realpath(target) !== target || !(await fs.stat(target)).isFile()) return null;
    return target;
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
    throw error;
  }
}

module.exports = { strongPassword, validPublicOrigin, runtimeErrors, productionRouteBlock, isPublicFile, publicFileTarget };
