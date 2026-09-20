// 商户后台公共函数，由 admin.html 加载。
// 只放纯函数 —— 不依赖任何页面的文件级变量，两端行为必须完全一致。
// ⚠️ 改这里的算钱函数（calculateStaffShareAmount / getOrderStaffIncome）等于同时改两端，
//    改之前先跑 npm run verify:all。
// ⚠️ 新增文件要记得加进 scripts/package-customer.js 的 rootFiles，否则客户交付包会缺文件。

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hasBrokenChineseCache(raw) {
  return typeof raw === "string" && /\?{3,}/.test(raw);
}

function cleanObsoleteHomeConfig(config) {
  for (const key of Object.keys(config)) {
    if (key.startsWith("popup") || key === "mustReadText" || key === "orderMustReadEnabled") delete config[key];
  }
  if (config.quickActions && typeof config.quickActions === "object" && !Array.isArray(config.quickActions)) {
    config.quickActions = Object.fromEntries(Object.entries(config.quickActions)
      .filter(([key, item]) => key === "service" || item?.type === "customerService"));
  }
  return config;
}

function calculateStaffShareAmount(value, price) {
  const text = String(value || "").trim();
  const orderPrice = Number(price || 0);
  if (!text) return Number((orderPrice * 0.7).toFixed(2));
  const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percentMatch) return Number((orderPrice * Number(percentMatch[1]) / 100).toFixed(2));
  const moneyMatch = text.match(/(\d+(?:\.\d+)?)/);
  if (moneyMatch) return Number(Number(moneyMatch[1]).toFixed(2));
  return Number((orderPrice * 0.7).toFixed(2));
}

function getOrderStaffIncome(order) {
  const amount = Number(order.staffIncome || order.staffShare || 0);
  if (amount > 0) return amount;
  return Number((Number(order.price || 0) * 0.7).toFixed(2));
}

// 商户接单保证金门槛；缺省为 0，非法输入交给保存接口拒绝。
const STAFF_BOND_REQUIREMENT_MAX = 1000000;
function staffBondRequirementValue(value) {
  if (value == null) return 0;
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= STAFF_BOND_REQUIREMENT_MAX
    && Math.round(amount * 100) / 100 === amount ? amount : null;
}

// ── 提现手续费（用户 2026-09-18 定的口径）──────────────────────────────────────
// 打手提现被收一笔「总手续费」，这笔钱再在管事和商户之间分：
//   总手续费      = 商户设的默认值，或该打手的专项配置（专项优先）
//   管事抽成比例  = 总手续费里管事拿走多少（按管事单独设的优先，没设用全局默认）
//   管事拿 = 总手续费 × 管事抽成比例，剩下的大头归商户。
//   打手没有上级管事 → 管事那层不适用，总手续费整笔归商户。
// 金额一律用「分」（整数）算，比例一律用「百分数」（10 就是 10%），都不用小数，避免浮点误差。
// ⚠️「缺值 / 空串 = 没配，交给下一层继承」和「填 0 = 这一层明确不收」是两回事，归一化时必须区分。
const WITHDRAW_FEE_MODES = ["rate", "amount"];

// 归一化一个「比例或金额」片段。返回 null 就代表「没配」。
function withdrawFeePart(source, fallbackMode) {
  if (!source || typeof source !== "object") return null;
  if (source.value === undefined || source.value === null || source.value === "") return null;
  const raw = Number(source.value);
  if (!Number.isFinite(raw) || raw < 0) return null;
  const mode = WITHDRAW_FEE_MODES.includes(source.mode) ? source.mode : fallbackMode;
  return { mode, value: Math.min(raw, mode === "rate" ? 100 : 1000000) };
}

// 归一化一个百分比（0~100）。返回 null 就代表「没配」。
function withdrawShareRate(source) {
  if (source === undefined || source === null || source === "") return null;
  const raw = Number(source);
  if (!Number.isFinite(raw) || raw < 0) return null;
  return Math.min(raw, 100);
}

function normalizeWithdrawFee(input) {
  const source = input && typeof input === "object" ? input : {};
  const staff = withdrawFeePart(source.staff, "rate") || { mode: "rate", value: 0 };
  const staffOverrides = {};
  const rawStaff = source.staffOverrides && typeof source.staffOverrides === "object" ? source.staffOverrides : {};
  for (const key of Object.keys(rawStaff)) {
    const part = withdrawFeePart(rawStaff[key], staff.mode);
    if (part) staffOverrides[String(key)] = part;
  }
  const stewardOverrides = {};
  const rawSteward = source.stewardOverrides && typeof source.stewardOverrides === "object" ? source.stewardOverrides : {};
  for (const key of Object.keys(rawSteward)) {
    const entry = rawSteward[key];
    const rate = withdrawShareRate(entry && typeof entry === "object" ? entry.shareRate : entry);
    if (rate !== null) stewardOverrides[String(key)] = rate;
  }
  return {
    staff,
    staffOverrides,
    stewardShareRate: withdrawShareRate(source.stewardShareRate) ?? 0,
    stewardOverrides,
    stewardSelf: {
      enabled: source.stewardSelf?.enabled === true,
      ...(withdrawFeePart(source.stewardSelf, "rate") || { mode: "rate", value: 0 }),
    },
  };
}

// 算「这一层的配置该收多少分」。钳死上限：手续费永远不会超过提现金额（比例填 150% 也只扣光）。
function withdrawFeeCents(part, amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  if (!part || amount <= 0) return 0;
  const raw = part.mode === "amount" ? Math.round(part.value * 100) : Math.round((amount * part.value) / 100);
  return Math.min(Math.max(0, raw), amount);
}

// 解析一个打手提现时的手续费，以及这笔钱在管事和商户之间怎么分。
// options: { staffKey, stewardKey, amountCents }；stewardKey 为空 = 这个打手没有上级管事。
function resolveWithdrawFee(config, options = {}) {
  const fee = normalizeWithdrawFee(config && config.withdrawFee);
  const amountCents = Math.max(0, Math.round(Number(options.amountCents) || 0));
  const staffKey = String(options.staffKey || "");
  const stewardKey = String(options.stewardKey || "");
  const staffOverride = fee.staffOverrides[staffKey];
  const part = staffOverride || fee.staff;
  const totalCents = withdrawFeeCents(part, amountCents);
  const hasStewardRate = stewardKey && Object.prototype.hasOwnProperty.call(fee.stewardOverrides, stewardKey);
  const stewardShareRate = stewardKey ? (hasStewardRate ? fee.stewardOverrides[stewardKey] : fee.stewardShareRate) : 0;
  const stewardCents = stewardKey ? Math.min(totalCents, Math.round((totalCents * stewardShareRate) / 100)) : 0;
  return {
    totalCents,
    stewardCents,
    merchantCents: totalCents - stewardCents,
    stewardShareRate,
    staffSource: staffOverride ? "staff" : "default",
    stewardSource: !stewardKey ? "none" : hasStewardRate ? "steward" : "default",
  };
}

// 管事本人提现的手续费：不涉及分成，收上来整笔归商户。
function resolveStewardSelfFee(config, amountCents) {
  const self = normalizeWithdrawFee(config && config.withdrawFee).stewardSelf;
  if (!self.enabled) return { enabled: false, totalCents: 0 };
  return { enabled: true, totalCents: withdrawFeeCents(self, amountCents) };
}

// ── 提现运营配置（用户 2026-09-18 明确：这三项都由商户在后台自己调）──────────────
// 「最低提现额 / 开放渠道 / 打手端说明文案」都是运营值，代码里给的只是一份**兜底**，
// 不是业务值：缺项、非法、接口挂了，前端也必须能拿到一份可用配置（渠道退化到只开支付宝）。
// 渠道常量写死在这里，服务端只决定「开不开」，不能改 key/label。
// ⚠️ 小程序那份在 `wechat-miniprogram/miniprogram/utils/withdraw.js`（跑不了本文件），
//    两边 key/label 必须一致，check-production 有断言钉着，改一边要同时改另一边。
const WITHDRAW_CHANNELS = [
  { key: "alipay", label: "支付宝" },
  { key: "wechat", label: "微信" },
  { key: "bank", label: "银行卡" },
];
const WITHDRAW_MIN_AMOUNT_FALLBACK = 10;
const WITHDRAW_NOTICE_DEFAULT = [
  "提现申请提交后，请耐心等待平台审核；",
  "审核通过后，款项将转入您设置的收款账户；",
  "如提现失败，提现金额将退回可用佣金。",
].join("\n");

// 归一化提现运营配置。返回的永远是可直接下发给前端的完整配置。
function normalizeWithdrawSettings(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawMin = Number(source.minAmount);
  // 最低提现额：只认正数；0 / 负数 / 非数字 / 空都退回兜底，否则「最低 0 元」等于没限制。
  const minAmount = Number.isFinite(rawMin) && rawMin > 0 ? Number(rawMin.toFixed(2)) : WITHDRAW_MIN_AMOUNT_FALLBACK;
  const wanted = Array.isArray(source.channels) ? source.channels.map((key) => String(key)) : [];
  const channels = WITHDRAW_CHANNELS.map((channel) => channel.key).filter((key) => wanted.includes(key));
  const notice = typeof source.notice === "string" ? source.notice.trim() : "";
  return {
    minAmount,
    // 一个都没开（或渠道字段是垃圾）时退化到「只开支付宝」，与接口失败时的降级一致。
    channels: channels.length ? channels : ["alipay"],
    notice: notice || WITHDRAW_NOTICE_DEFAULT,
  };
}

// 服务端（Node）也要用同一份算钱逻辑 —— 提现时的手续费必须在服务端解算，
// 不能让前端报一个数上来。浏览器里 `module` 不存在，这段是空操作，不影响两端加载同一个文件。
// ⚠️ 算钱函数只有这一份；server.js 里不许再写一遍（check-production 的 sharedNames 断言盯着）。
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WITHDRAW_CHANNELS,
    WITHDRAW_MIN_AMOUNT_FALLBACK,
    WITHDRAW_NOTICE_DEFAULT,
    normalizeWithdrawSettings,
    normalizeWithdrawFee,
    resolveWithdrawFee,
    resolveStewardSelfFee,
    withdrawFeeCents,
    calculateStaffShareAmount,
    getOrderStaffIncome,
    STAFF_BOND_REQUIREMENT_MAX,
    staffBondRequirementValue,
    cleanObsoleteHomeConfig,
    escapeHtml,
  };
}
