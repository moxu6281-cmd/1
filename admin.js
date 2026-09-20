const ACTIVE_CONFIG_KEY = "monster_esports_admin_config";
const DRAFT_CONFIG_KEY = "monster_esports_admin_config_draft";
const MERCHANTS_KEY = "monster_esports_merchants";
const SESSION_KEY = "monster_esports_admin_session";
const ORDERS_KEY_PREFIX = "monster_esports_orders";
const LOGS_KEY_PREFIX = "monster_esports_pc_logs";
const SESSION_TTL = 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const money = (value) => `¥${Number(value || 0).toFixed(2)}`;

const menuGroups = [
  { title: "首页", items: ["数据统计"] },
  { title: "平台管理", items: ["配置信息", "轮播设置", "PC操作日志"] },
  { title: "商品管理", items: ["商品列表", "商品分类", "游戏区服", "奖池管理", "商品评论"] },
  { title: "订单管理", items: ["订单列表", "接单池管理", "订单评价", "异常订单", "余额变化"] },
  { title: "用户管理", items: ["用户列表", "会员等级"] },
  { title: "陪玩管理", items: ["员工列表", "陪玩等级"] },
  { title: "功能", items: ["罚单", "保证金"] },
  { title: "活动管理", items: ["跳转配置", "会话管理", "聊天管理"] },
  { title: "员工管理", items: ["分销管理", "员工审核", "排行榜", "管事邀请码", "客服列表", "提现审核"] },
  { title: "权限管理", items: ["员工权限", "管理员列表"] },
];

const defaultProducts = [
  {
    id: "p1",
    title: "开荒单/保底300万~1000万（不卡保底）",
    orderTitle: "新人体验单",
    price: 16.8,
    orderPrice: 66.6,
    originalPrice: 46.6,
    oldPrice: 199.9,
    increasePrice: 20,
    increaseReason: "俱乐部大量爆单急缺打手，稍微涨价！",
    tag: "爆单",
    sold: 869834,
    views: 3496039,
    imageUrl: "",
    desc: "新赛季开荒单，保底300万~1000万，不卡保底，自动安排，售后可追踪。",
    orderDesc: "导师给您保底500w-1000w！",
  },
  {
    id: "p2",
    title: "新人特惠单",
    orderTitle: "新人特惠单",
    price: 48.8,
    orderPrice: 48.8,
    originalPrice: 38.8,
    oldPrice: 128.6,
    increasePrice: 10,
    increaseReason: "新人单库存紧张，临时加急安排。",
    tag: "新人",
    sold: 199742,
    views: 860240,
    imageUrl: "",
    desc: "新人特别单，每人限购一单，适合先体验服务流程和售后保障。",
    orderDesc: "新人专属体验服务。",
  },
  {
    id: "p3",
    title: "金牌打手加急单",
    orderTitle: "金牌打手加急单",
    price: 158,
    orderPrice: 158,
    originalPrice: 128,
    oldPrice: 288,
    increasePrice: 30,
    increaseReason: "金牌打手排期紧张，已启用加急通道。",
    tag: "加急",
    sold: 56210,
    views: 210988,
    imageUrl: "",
    desc: "优先安排金牌打手接单，适合赶时间、要求更高的客户。",
    orderDesc: "优先安排金牌打手接单。",
  },
  {
    id: "p4",
    title: "售后保障补差单",
    orderTitle: "售后保障补差单",
    price: 18.8,
    orderPrice: 18.8,
    originalPrice: 18.8,
    oldPrice: 39.9,
    increasePrice: 0,
    increaseReason: "当前无涨价。",
    tag: "售后",
    sold: 32018,
    views: 109432,
    imageUrl: "",
    desc: "用于售后补差、追加需求和客服指定服务。",
    orderDesc: "售后补差或追加需求。",
  },
];

const defaultConfig = {
  productsPerRow: 2,
  staffBondRequirement: 0,
  broadcastEnabled: true,
  detailFloatEnabled: true,
  // 提现手续费（用户 2026-09-18 定的口径）：打手提现的总手续费 + 这笔钱在管事和商户之间怎么分。
  // 字段含义、继承与覆盖规则见 shared.js 的 normalizeWithdrawFee / resolveWithdrawFee，
  // 设置入口在「分销管理」。默认全为 0 = 不收钱。
  withdrawFee: {
    staff: { mode: "rate", value: 0 },
    stewardShareRate: 0,
    staffOverrides: {},
    stewardOverrides: {},
    stewardSelf: { enabled: false, mode: "rate", value: 0 },
  },
  // 提现运营三项（用户 2026-09-18 要求「最低提现金额可由商户在后台自己调」）：
  // 最低提现额 / 开放渠道 / 打手端说明文案。字段含义与兜底值见 shared.js 的 normalizeWithdrawSettings，
  // 设置入口在「分销管理」，小程序每次进提现页都会重拉一次，改完立刻生效。
  withdrawSettings: {
    minAmount: 10,
    channels: ["alipay"],
    notice: WITHDRAW_NOTICE_DEFAULT,
  },
  heroEyebrow: "毒怪问题承诺",
  heroTitle: "客户下单服务不好直接免单",
  heroSubtitle: "小程序自助下单 · 客服实时跟进 · 售后可追踪",
  heroEyebrowEnabled: true,
  heroTitleEnabled: true,
  heroSubtitleEnabled: true,
  heroImageUrl: "",
  heroImageName: "",
  heroImagePath: "",
  products: defaultProducts,
  product: defaultProducts[0],
  categories: ["热门推荐", "新人福利", "开荒保底", "售后补差"],
  categoryTree: [
    { name: "和平精英", children: ["保底单", "基础单", "加急单", "售后单"], gameServers: ["手机端", "电脑端"] },
    { name: "三角洲行动", children: ["大红单", "保险单", "清图单"], gameServers: ["手机端", "电脑端"] },
    { name: "王者荣耀", children: ["上分单", "陪玩单", "冲榜单"], gameServers: ["手机端", "电脑端"] },
  ],
  gameServers: ["手机端", "电脑端"],
  productTags: ["爆单", "新人", "加急", "售后"],
  lotteryPools: [],
  quickActions: {
    service: { enabled: true, icon: "客", imageUrl: "", title: "联系客服", text: "有定制单、售后或催单需求时，可从这里跳转到商户对接的微信客服小程序。", action: "联系客服", type: "customerService", appId: "", path: "" },
  },
  activityFeatures: {
    "跳转配置": true,
    "会话管理": true,
    "聊天管理": true,
  },
  staffLevels: [
    { name: "明星", prioritySeconds: 45, order: 1, canPreGrab: true, canTakeHighValue: true, canBeSpecified: true, note: "最高优先级，适合核心打手" },
    { name: "金牌", prioritySeconds: 30, order: 2, canPreGrab: true, canTakeHighValue: true, canBeSpecified: true, note: "主力打手，优先接高价单" },
    { name: "银牌", prioritySeconds: 15, order: 3, canPreGrab: true, canTakeHighValue: false, canBeSpecified: true, note: "稳定打手，可接普通单" },
    { name: "铜牌", prioritySeconds: 5, order: 4, canPreGrab: false, canTakeHighValue: false, canBeSpecified: false, note: "新手打手，观察期" },
    { name: "实习", prioritySeconds: 0, order: 5, canPreGrab: false, canTakeHighValue: false, canBeSpecified: false, note: "仅接基础单" },
  ],
  staffGrabbers: [
    { name: "陪玩A", level: "金牌", preGrabEnabled: true, preGrabSeconds: 30 },
    { name: "陪玩B", level: "银牌", preGrabEnabled: true, preGrabSeconds: 15 },
    { name: "明星打手01", level: "明星", preGrabEnabled: true, preGrabSeconds: 45 },
  ],
  memberBenefits: [
    { level: "黄金", condition: "累计下单满 1 单", benefits: "售后优先登记\n专属活动提醒" },
    { level: "铂金", condition: "累计消费满 500 元", benefits: "客服优先跟进\n加急订单提醒" },
    { level: "钻石", condition: "累计消费满 1500 元", benefits: "高级售后通道\n指定打手优先安排" },
    { level: "黑金", condition: "累计消费满 3000 元", benefits: "专属客服通道\n高价值订单优先排队" },
  ],
};


let session = null;
let activeMerchant = null;
let workingConfig = null;
let serverConfigCache = {};
let activeProductId = "p1";
let currentPage = "数据统计";
let liveOrderTrackerTimer = null;
const collapsedGroups = new Set(menuGroups.map((group) => group.title).filter((title) => title !== "首页"));
let productListState = { status: "visible", page: 1, pageSize: 10, keyword: "", category: "", spec: "", tag: "", share: "" };
let categoryManagerState = { keyword: "", editingIndex: -1, creating: false };
const categoryManagerSelection = new Set();
let categoryPublishQueue = Promise.resolve({ ok: true });
let lotteryPoolDraft = null;

function orderKey(account = activeMerchant?.account || "default") {
  return `${ORDERS_KEY_PREFIX}_${account}`;
}

function logKey(account = activeMerchant?.account || "default") {
  return `${LOGS_KEY_PREFIX}_${account}`;
}

function getMerchantOrders(account = activeMerchant?.account || "default") {
  try {
    return JSON.parse(localStorage.getItem(orderKey(account))) || [];
  } catch {
    return [];
  }
}

function getOperationLogs(account = activeMerchant?.account || "default") {
  try {
    return JSON.parse(localStorage.getItem(logKey(account))) || [];
  } catch {
    return [];
  }
}

function saveOperationLogs(logs, account = activeMerchant?.account || "default") {
  const normalized = logs.slice(0, 300);
  localStorage.setItem(logKey(account), JSON.stringify(normalized));
  fetch(`/api/logs/${encodeURIComponent(account)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logs: normalized }),
  }).catch(() => {});
}

async function syncOperationLogsFromServer(account = activeMerchant?.account || "default") {
  try {
    const response = await fetch(`/api/logs/${encodeURIComponent(account)}`, { cache: "no-store" });
    if (!response.ok) return getOperationLogs(account);
    const logs = await response.json();
    if (Array.isArray(logs)) {
      localStorage.setItem(logKey(account), JSON.stringify(logs));
      return logs;
    }
  } catch {
    // Local preview can still use localStorage.
  }
  return getOperationLogs(account);
}

async function fetchOrderChatSummary(account, orders) {
  if (!account || !orders?.length) return { boss: {}, staff: {} };
  const response = await fetch(`/api/order-chat/${encodeURIComponent(account)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ orderNos: orders.map((order) => order.no).filter(Boolean) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) return { boss: {}, staff: {} };
  return result.unread || { boss: {}, staff: {} };
}

function recordOperation(content, detail = "") {
  if (!session || !activeMerchant) return;
  const account = activeMerchant.account;
  const logs = getOperationLogs(account);
  logs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    time: formatDateTime(new Date()),
    operator: session.account,
    role: session.role === "owner" ? "主管理员" : "子管理员",
    merchant: activeMerchant.clubName,
    content,
    detail,
    ip: "127.0.0.1",
  });
  saveOperationLogs(logs, account);
}

function formatDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function syncStoreFromServer() {
  try {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) return;
    const store = await response.json();
    if (store.configs) serverConfigCache = store.configs;
    if (Array.isArray(store.merchants)) {
      try { localStorage.setItem(MERCHANTS_KEY, JSON.stringify(store.merchants)); } catch {}
    }
    if (store.configs) {
      Object.entries(store.configs).forEach(([account, config]) => {
        try {
          localStorage.setItem(configKey(account), JSON.stringify(config));
        } catch {
          // Large uploaded images can exceed the browser cache. The server copy remains authoritative.
          localStorage.removeItem(configKey(account));
        }
      });
    }
    if (store.orders) {
      Object.entries(store.orders).forEach(([account, orders]) => {
        try { localStorage.setItem(orderKey(account), JSON.stringify(orders)); } catch {}
      });
    }
    if (store.logs) {
      Object.entries(store.logs).forEach(([account, logs]) => {
        try { localStorage.setItem(logKey(account), JSON.stringify(logs)); } catch {}
      });
    }
  } catch {
    // Static preview can still use localStorage.
  }
}

function buildUsersFromOrders(orders) {
  const map = new Map();
  orders.forEach((order) => {
    const name = order.user || "微信客户";
    const key = order.customerId || order.userId || name;
    const item = map.get(key) || {
      id: numericUserId(order.userId) || order.customerId || "",
      customerId: order.customerId || "",
      name,
      amount: 0,
      orders: 0,
      phone: "微信用户",
    };
    item.amount += Number(order.price || 0);
    item.orders += 1;
    map.set(key, item);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

function productRowsFromOrders(orders) {
  const map = new Map();
  workingConfig.products.forEach((product) => {
    map.set(product.id, { title: product.title || product.orderTitle || product.id, amount: 0, count: 0, baseSold: Number(product.sold || 0) });
  });
  orders.forEach((order) => {
    const key = order.productId || order.product;
    const item = map.get(key) || { title: order.product || "未知商品", amount: 0, count: 0, baseSold: 0 };
    item.amount += Number(order.price || 0);
    item.count += Number(order.quantity || 1);
    map.set(key, item);
  });
  return [...map.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
}

function clone(data) {
  return JSON.parse(JSON.stringify(data));
}

function configKey(account) {
  return `${ACTIVE_CONFIG_KEY}_${account}`;
}

function draftConfigKey(account) {
  return `${DRAFT_CONFIG_KEY}_${account}`;
}

function getMerchants() {
  try {
    return JSON.parse(localStorage.getItem(MERCHANTS_KEY)) || [];
  } catch {
    return [];
  }
}

function saveMerchants(merchants) {
  const publicMerchants = merchants.map(({ password, ...merchant }) => merchant);
  localStorage.setItem(MERCHANTS_KEY, JSON.stringify(publicMerchants));
  fetch("/api/merchants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchants }),
  }).catch(() => {});
}

function getMerchant(account) {
  return getMerchants().find((item) => item.account === account);
}

function ensureDefaultMerchant() {
  const merchants = getMerchants();
  if (!merchants.length) {
    const merchant = { account: "club001", password: "123456", clubName: process.env.DEFAULT_MERCHANT_NAME || "未命名俱乐部" };
    merchants.push(merchant);
    saveMerchants(merchants);
    saveMerchantConfig(merchant.account, clone(defaultConfig));
  }
  return getMerchants();
}

function normalizeProducts(config) {
  const saved = Array.isArray(config.products) ? config.products : [];
  const legacy = config.product ? [{ ...config.product, id: config.product.id || "p1" }] : [];
  const source = saved.length ? saved : legacy;
  const deletedProductIds = new Set(
    Array.isArray(config.deletedProductIds) ? config.deletedProductIds.map(String) : [],
  );
  const mergedDefaults = defaultProducts
    .filter((base) => !deletedProductIds.has(String(base.id)))
    .map((base) => ({ ...base, ...(source.find((item) => item.id === base.id) || {}) }));
  const custom = source.filter((item) => (
    !defaultProducts.some((base) => base.id === item.id)
    && !deletedProductIds.has(String(item.id))
  ));
  return [...mergedDefaults, ...custom].map((item, index) => normalizeProductAdminFields(item, index));
}

function normalizeCategoryTree(source, legacyGameServers = defaultConfig.gameServers) {
  const fallback = clone(defaultConfig.categoryTree || []);
  const fallbackServers = normalizeGameServers(legacyGameServers);
  const list = Array.isArray(source) && source.length ? source : fallback;
  if (typeof list[0] === "string") {
    return list
      .filter(Boolean)
      .map((name) => ({
        name,
        status: "visible",
        children: ["保底单", "基础单"],
        gameServers: clone(fallbackServers),
      }));
  }
  return list
    .map((group) => ({
      name: String(group?.name || "").trim(),
      imageUrl: group?.imageUrl || "",
      status: group?.status === "hidden" || group?.visible === false || group?.enabled === false
        ? "hidden"
        : "visible",
      children: Array.isArray(group?.children)
        ? group.children.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      gameServers: normalizeGameServers(
        Array.isArray(group?.gameServers) && group.gameServers.length
          ? group.gameServers
          : fallbackServers,
      ),
    }))
    .filter((group) => group.name);
}

function flattenCategoryTree(tree) {
  return normalizeCategoryTree(tree).flatMap((group) => group.children.length ? group.children : [group.name]);
}

function normalizeGameServers(source) {
  const fallback = ["手机端", "电脑端"];
  const list = Array.isArray(source) && source.length ? source : fallback;
  return list
    .map((item, index) => {
      if (typeof item === "string") {
        return { id: `server_${index + 1}`, name: item.trim(), enabled: true };
      }
      return {
        id: item?.id || `server_${index + 1}`,
        name: String(item?.name || "").trim(),
        enabled: item?.enabled !== false,
      };
    })
    .filter((item) => item.name);
}

function normalizeQuickActions(source) {
  const defaults = clone(defaultConfig.quickActions);
  return Object.fromEntries(Object.entries(defaults).map(([key, base]) => {
    const item = source?.[key] || {};
    return [key, {
      ...base,
      ...item,
      enabled: item.enabled !== false,
      icon: item.icon && !/^[?\uFFFD]+$/.test(String(item.icon).trim()) ? item.icon : base.icon,
      imageUrl: item.imageUrl || "",
      title: item.title || base.title,
      text: item.text || base.text,
      action: item.action || base.action,
      type: item.type || base.type,
      appId: item.appId || "",
      path: item.path || "",
    }];
  }));
}

function normalizeActivityFeatures(source) {
  const defaults = clone(defaultConfig.activityFeatures);
  const clean = Object.fromEntries(Object.entries(source || {}).filter(([key]) => !/^[?\uFFFD]+$/.test(String(key).trim())));
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, clean[key] !== false]));
}

function normalizeMemberBenefits(source) {
  const defaults = clone(defaultConfig.memberBenefits || []);
  const saved = Array.isArray(source) ? source : [];
  return defaults.map((item) => {
    const current = saved.find((row) => row && row.level === item.level) || {};
    return {
      level: item.level,
      condition: String(current.condition || item.condition || "").slice(0, 200),
      benefits: String(current.benefits || item.benefits || "").slice(0, 2000),
    };
  });
}

function normalizeLotteryPools(source) {
  if (!Array.isArray(source)) return [];
  return source.map((pool, poolIndex) => ({
    id: String(pool?.id || `pool_${poolIndex + 1}`).slice(0, 80),
    name: String(pool?.name || `奖池 ${poolIndex + 1}`).trim().slice(0, 80),
    enabled: pool?.enabled !== false,
    prizes: (Array.isArray(pool?.prizes) ? pool.prizes : []).map((prize, prizeIndex) => ({
      id: String(prize?.id || `prize_${prizeIndex + 1}`).slice(0, 80),
      name: String(prize?.name || "").trim().slice(0, 120),
      weight: Math.max(0.01, Math.min(1000000, Number(prize?.weight || 1))),
      productIds: Array.from(new Set((Array.isArray(prize?.productIds) ? prize.productIds : []).map(String))),
      imageUrl: String(prize?.imageUrl || ""),
      imageName: String(prize?.imageName || ""),
      imagePath: String(prize?.imagePath || ""),
    })).filter((prize) => prize.name),
  })).filter((pool) => pool.name);
}

function reconcilePublishedProductAssets(saved, published) {
  if (!saved || !published || !Array.isArray(saved.products) || !Array.isArray(published.products)) return saved;
  const publishedById = new Map(published.products.map((product) => [String(product?.id || ""), product]));
  return {
    ...saved,
    products: saved.products.map((product) => {
      const publishedProduct = publishedById.get(String(product?.id || ""));
      const publishedPath = String(publishedProduct?.imagePath || "");
      if (!publishedPath) return product;
      const savedUrl = String(product?.imageUrl || "");
      const savedPath = String(product?.imagePath || "");
      if (savedPath && !/^data:image\//i.test(savedUrl)) return product;
      return {
        ...product,
        imageUrl: String(publishedProduct.imageUrl || ""),
        imageName: String(publishedProduct.imageName || ""),
        imagePath: publishedPath,
      };
    }),
  };
}

function loadMerchantConfig(account) {
  const published = serverConfigCache[account] ? clone(serverConfigCache[account]) : null;
  let saved = published;
  try {
    const draftRaw = localStorage.getItem(draftConfigKey(account));
    const configRaw = localStorage.getItem(configKey(account));
    if (hasBrokenChineseCache(draftRaw)) localStorage.removeItem(draftConfigKey(account));
    if (hasBrokenChineseCache(configRaw)) localStorage.removeItem(configKey(account));
    if (draftRaw && !hasBrokenChineseCache(draftRaw)) saved = JSON.parse(draftRaw);
    else if (!saved && configRaw && !hasBrokenChineseCache(configRaw)) saved = JSON.parse(configRaw);
  } catch {
    saved = serverConfigCache[account] ? clone(serverConfigCache[account]) : null;
  }
  saved = reconcilePublishedProductAssets(saved, published);
  const heroClearedInDraft = saved && saved.heroImageUrl === "" && saved.heroImagePath === "";
  if (published?.heroImagePath && !heroClearedInDraft && (!saved?.heroImagePath || /^data:image\//i.test(String(saved.heroImageUrl || "")))) {
    saved = {
      ...(saved || {}),
      heroImageUrl: published.heroImageUrl,
      heroImageName: published.heroImageName,
      heroImagePath: published.heroImagePath,
    };
  }
  const config = { ...clone(defaultConfig), ...(saved || {}) };
  cleanObsoleteHomeConfig(config);
  config.gameServers = normalizeGameServers(config.gameServers);
  config.categoryTree = normalizeCategoryTree(config.categoryTree || defaultConfig.categoryTree, config.gameServers);
  config.categories = flattenCategoryTree(config.categoryTree);
  config.products = normalizeProducts(config);
  config.product = config.products[0];
  delete config.broadcasts;
  delete config.homeBroadcasts;
  config.activityFeatures = normalizeActivityFeatures(config.activityFeatures);
  config.heroEyebrow = config.heroEyebrow || defaultConfig.heroEyebrow;
  config.heroTitle = config.heroTitle || defaultConfig.heroTitle;
  config.heroSubtitle = config.heroSubtitle || defaultConfig.heroSubtitle;
  config.heroEyebrowEnabled = config.heroEyebrowEnabled !== false;
  config.heroTitleEnabled = config.heroTitleEnabled !== false;
  config.heroSubtitleEnabled = config.heroSubtitleEnabled !== false;
  config.heroImageUrl = config.heroImageUrl || "";
  config.heroImageName = String(config.heroImageName || "");
  config.heroImagePath = String(config.heroImagePath || "");
  config.quickActions = normalizeQuickActions(config.quickActions);
  config.productsPerRow = Math.min(4, Math.max(1, Math.floor(Number(config.productsPerRow || 2))));
  config.staffBondRequirement = staffBondRequirementValue(config.staffBondRequirement) ?? 0;
  config.staffLevels = Array.isArray(config.staffLevels) ? config.staffLevels : clone(defaultConfig.staffLevels);
  config.staffGrabbers = Array.isArray(config.staffGrabbers) ? config.staffGrabbers : clone(defaultConfig.staffGrabbers);
  config.withdrawFee = normalizeWithdrawFee(config.withdrawFee);
  config.withdrawSettings = normalizeWithdrawSettings(config.withdrawSettings);
  config.memberBenefits = normalizeMemberBenefits(config.memberBenefits);
  config.lotteryPools = normalizeLotteryPools(config.lotteryPools);
  return config;
}

function normalizeConfigForStorage(config) {
  const normalized = { ...config, products: normalizeProducts(config) };
  cleanObsoleteHomeConfig(normalized);
  delete normalized.broadcasts;
  delete normalized.homeBroadcasts;
  // 三项运营值一律先归一化再落盘（最低提现额非法 → 兜底 10；一个渠道都没勾 → 只开支付宝）。
  normalized.withdrawSettings = normalizeWithdrawSettings(normalized.withdrawSettings);
  normalized.gameServers = normalizeGameServers(normalized.gameServers);
  normalized.categoryTree = normalizeCategoryTree(normalized.categoryTree || normalized.categories, normalized.gameServers);
  normalized.categories = flattenCategoryTree(normalized.categoryTree);
  normalized.quickActions = normalizeQuickActions(normalized.quickActions);
  normalized.activityFeatures = normalizeActivityFeatures(normalized.activityFeatures);
  normalized.memberBenefits = normalizeMemberBenefits(normalized.memberBenefits);
  normalized.lotteryPools = normalizeLotteryPools(normalized.lotteryPools);
  normalized.productsPerRow = Math.min(4, Math.max(1, Math.floor(Number(normalized.productsPerRow || 2))));
  normalized.staffBondRequirement = staffBondRequirementValue(normalized.staffBondRequirement) ?? 0;
  normalized.product = normalized.products[0];
  return normalized;
}

function saveDraftConfig(account, config) {
  if (!account || !config) return null;
  const normalized = normalizeConfigForStorage(config);
  try {
    localStorage.setItem(draftConfigKey(account), JSON.stringify(normalized));
  } catch (cacheError) {
    console.warn("Draft cache is full; the current page remains usable", cacheError);
  }
  return normalized;
}

function loadPublishedConfig(account) {
  if (serverConfigCache[account]) return normalizeConfigForStorage(clone(serverConfigCache[account]));
  try {
    const raw = localStorage.getItem(configKey(account));
    if (raw && !hasBrokenChineseCache(raw)) return normalizeConfigForStorage(JSON.parse(raw));
  } catch {}
  return normalizeConfigForStorage(clone(defaultConfig));
}

// Partial publishes (products / categories) send the whole config back, so the base
// must be the server's current copy. Using a stale local cache as the base silently
// reverts unrelated settings such as 每排列数.
async function fetchPublishedConfig(account) {
  if (!account) return loadPublishedConfig(account);
  try {
    const response = await fetch(`/api/config/${encodeURIComponent(account)}`, {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`读取线上配置失败（${response.status}）`);
    const payload = await response.json().catch(() => null);
    const config = payload && typeof payload.config === "object" && payload.config ? payload.config : payload;
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("线上配置为空");
    serverConfigCache[account] = clone(config);
    return normalizeConfigForStorage(clone(config));
  } catch (error) {
    console.warn("以本地缓存为底稿发布，可能覆盖商户在其他页面的改动", error);
    return loadPublishedConfig(account);
  }
}

async function saveMerchantConfig(account, config, options = {}) {
  const normalized = normalizeConfigForStorage(config);
  const serialized = JSON.stringify(normalized);
  if (!options.skipDraft) saveDraftConfig(account, normalized);
  try {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`/api/config/${encodeURIComponent(account)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ config: normalized }),
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || `保存失败：${response.status}`);
    }
    try {
      localStorage.setItem(configKey(account), serialized);
      localStorage.setItem(ACTIVE_CONFIG_KEY, serialized);
      if (!options.keepDraft) localStorage.removeItem(draftConfigKey(account));
    } catch (cacheError) {
      console.warn("Local published cache is full; the server copy remains authoritative", cacheError);
      localStorage.removeItem(configKey(account));
      localStorage.removeItem(ACTIVE_CONFIG_KEY);
    }
    if (!options.silent && session && activeMerchant?.account === account) {
      recordOperation("保存并同步前端配置", activeMerchant.clubName);
    }
    serverConfigCache[account] = clone(normalized);
    return { ok: true, config: normalized };
  } catch (error) {
    console.warn("Config save failed", error);
    if (options.throwOnError) throw error;
    return { ok: false, config: normalized, error };
  }
}

async function publishProducts(options = {}) {
  if (!activeMerchant || !workingConfig) return { ok: false, error: new Error("未选择商户") };
  const account = activeMerchant.account;
  const draftSnapshot = clone(workingConfig);
  const published = await fetchPublishedConfig(account);
  const products = normalizeProducts(workingConfig);
  const deletedProductIds = Array.from(new Set(
    (Array.isArray(workingConfig.deletedProductIds) ? workingConfig.deletedProductIds : []).map(String),
  ));
  const payload = { ...published, products, product: products[0] || null, deletedProductIds };
  const result = await saveMerchantConfig(account, payload, {
    ...options,
    keepDraft: true,
    skipDraft: true,
  });
  if (result.ok) {
    workingConfig = {
      ...draftSnapshot,
      products: clone(result.config.products),
      product: clone(result.config.product),
      deletedProductIds: clone(result.config.deletedProductIds || deletedProductIds),
    };
    saveDraftConfig(account, workingConfig);
  }
  return result;
}

function publishCategories(configSnapshot = workingConfig) {
  if (!activeMerchant || !configSnapshot) return Promise.resolve({ ok: false, error: new Error("未选择商户") });
  const account = activeMerchant.account;
  const snapshot = clone(configSnapshot);
  categoryPublishQueue = categoryPublishQueue
    .catch(() => ({ ok: false }))
    .then(async () => {
      const published = await fetchPublishedConfig(account);
      const categoryTree = normalizeCategoryTree(snapshot.categoryTree || snapshot.categories, snapshot.gameServers);
      const categories = flattenCategoryTree(categoryTree);
      const products = normalizeProducts(snapshot);
      const deletedProductIds = Array.from(new Set(
        (Array.isArray(snapshot.deletedProductIds) ? snapshot.deletedProductIds : []).map(String),
      ));
      const payload = {
        ...published,
        categoryTree,
        categories,
        products,
        product: products[0] || null,
        deletedProductIds,
      };
      return saveMerchantConfig(account, payload, {
        keepDraft: true,
        skipDraft: true,
        silent: true,
      });
    });
  return categoryPublishQueue;
}

async function publishLotteryPools() {
  if (!activeMerchant || !workingConfig) return { ok: false, error: new Error("未选择商户") };
  workingConfig.lotteryPools = normalizeLotteryPools(workingConfig.lotteryPools);
  const published = loadPublishedConfig(activeMerchant.account);
  const products = normalizeProducts(workingConfig);
  const payload = {
    ...published,
    lotteryPools: clone(workingConfig.lotteryPools),
    products,
    product: products[0] || null,
  };
  const result = await saveMerchantConfig(activeMerchant.account, payload, {
    keepDraft: true,
    skipDraft: true,
    silent: true,
  });
  if (result.ok) saveDraftConfig(activeMerchant.account, workingConfig);
  return result;
}

function imageFileToDataUrl(file, maxSide = 1600, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("图片格式无法识别"));
      image.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function activeProduct() {
  return workingConfig.products.find((item) => item.id === activeProductId) || workingConfig.products[0];
}

function normalizeProductAdminFields(product, index = 0) {
  const fallbackTree = normalizeCategoryTree(workingConfig?.categoryTree || defaultConfig.categoryTree);
  const fallbackMain = fallbackTree[0]?.name || "和平精英";
  const fallbackSub = fallbackTree[0]?.children?.[0] || product.category || product.tag || "保底单";
  const subCategory = product.subCategory || product.category || product.tag || fallbackSub;
  const price = Number(product.price || 0);
  const orderPrice = Number(product.orderPrice || price || 0);
  const strikePrice = Math.max(0, Number(product.strikePrice ?? product.oldPrice ?? 0));
  const originalPrice = price;
  const increasePrice = Math.max(0, Number((orderPrice - originalPrice).toFixed(2)));
  const status = ["hidden", "stock", "warehouse", "soldout", "recycle"].includes(product.status)
    ? "hidden"
    : "visible";
  return {
    ...product,
    mainCategory: product.mainCategory || product.gameCategory || fallbackMain,
    subCategory,
    category: subCategory,
    tag: product.tag || "单子",
    stock: Number(product.stock ?? 10000),
    price,
    orderPrice,
    strikePrice,
    showStrikePrice: product.showStrikePrice === true,
    originalPrice,
    increasePrice,
    oldPrice: strikePrice,
    spec: product.spec || "单规格",
    share: product.share || "系统默认:金牌陪玩:70%,普通陪玩:70%",
    service: product.service || "关闭",
    staffShareText: product.staffShareText || product.share || "70%",
    staffShare: calculateStaffShareAmount(product.staffShareText || product.share || "70%", Number(product.orderPrice || product.price || 0)),
    sort: Number(product.sort ?? index),
    status,
    imageUrl: String(product.imageUrl || ""),
    imageName: String(product.imageName || ""),
    imagePath: String(product.imagePath || ""),
    lotteryEnabled: product.lotteryEnabled === true,
    lotteryPoolId: String(product.lotteryPoolId || ""),
  };
}

function getProductCategoryTreeOptions() {
  return normalizeCategoryTree(workingConfig?.categoryTree || defaultConfig.categoryTree)
    .filter((group) => group.name);
}

function fillProductSubCategorySelector(preferredValue = "") {
  const mainSelect = $("productMainCategory");
  const subSelect = $("productCategory");
  if (!mainSelect || !subSelect) return;
  const tree = getProductCategoryTreeOptions();
  const group = tree.find((item) => item.name === mainSelect.value);
  const children = (group?.children || []).filter(Boolean);
  subSelect.innerHTML = `<option value="">请选择小分类</option>${children.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")}`;
  if (children.includes(preferredValue)) subSelect.value = preferredValue;
}

function fillProductCategorySelectors(product = {}) {
  const mainSelect = $("productMainCategory");
  if (!mainSelect) return;
  const tree = getProductCategoryTreeOptions();
  mainSelect.innerHTML = `<option value="">请选择大分类</option>${tree.map((group) => `<option value="${escapeHtml(group.name)}">${escapeHtml(group.name)}</option>`).join("")}`;
  if (tree.some((group) => group.name === product.mainCategory)) mainSelect.value = product.mainCategory;
  fillProductSubCategorySelector(product.subCategory || product.category || "");
}

function insertIntoProductDesc(before, after = "") {
  const textarea = $("productDesc");
  if (!textarea || textarea.disabled) return;
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || start;
  const selected = textarea.value.slice(start, end);
  textarea.value = `${textarea.value.slice(0, start)}${before}${selected}${after}${textarea.value.slice(end)}`;
  const caret = start + before.length + selected.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
}

function bindProductDescToolbar() {
  const toolbar = $("productDescToolbar");
  if (!toolbar || toolbar.dataset.bound === "1") return;
  toolbar.dataset.bound = "1";
  toolbar.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.insert) return insertIntoProductDesc(button.dataset.insert);
      if (button.dataset.wrap) {
        const [before, after] = button.dataset.wrap.split("|");
        insertIntoProductDesc(before || "", after || "");
      }
    });
  });
  toolbar.querySelectorAll("select").forEach((select) => {
    select.addEventListener("change", () => {
      if (!select.value) return;
      if (select.dataset.prefix === "font") insertIntoProductDesc(`<span style="font-family:${select.value}">`, "</span>");
      if (select.dataset.prefix === "size") insertIntoProductDesc(`<span style="font-size:${select.value}px">`, "</span>");
      select.value = "";
    });
  });
}

function commitActiveProduct() {
  if (!workingConfig || !$("title")) return;
  const next = {
    ...activeProduct(),
    title: $("title").value.trim(),
    orderTitle: $("orderTitle").value.trim(),
    tag: $("tag").value.trim(),
    price: Number($("price").value || 0),
    orderPrice: Number($("orderPrice").value || 0),
    originalPrice: Number($("originalPrice").value || 0),
    oldPrice: Number($("oldPrice").value || 0),
    increasePrice: Number($("increasePrice").value || 0),
    sold: Number($("sold").value || 0),
    views: Number($("views").value || 0),
    imageUrl: $("imageUrl").value,
    increaseReason: $("increaseReason").value.trim(),
    desc: $("desc").value.trim(),
    orderDesc: $("orderDesc").value.trim(),
  };
  workingConfig.products = workingConfig.products.map((item) => (item.id === activeProductId ? next : item));
  workingConfig.product = workingConfig.products[0];
}

function collectVisibleConfig() {
  commitActiveProduct();
  if ($("productsPerRow")) {
    const typed = Number($("productsPerRow").value);
    // An emptied input must keep the merchant's setting instead of silently resetting it.
    if (Number.isFinite(typed) && typed >= 1) {
      workingConfig.productsPerRow = Math.min(4, Math.max(1, Math.floor(typed)));
    }
  }
  if ($("staffBondRequirement")) {
    const value = staffBondRequirementValue($("staffBondRequirement").value);
    if (value !== null) workingConfig.staffBondRequirement = value;
  }
  if ($("broadcastEnabled")) {
    workingConfig.broadcastEnabled = $("broadcastEnabled").checked;
    workingConfig.detailFloatEnabled = $("detailFloatEnabled").checked;
  }
  const memberBenefitInputs = document.querySelectorAll("[data-member-benefit-field]");
  if (memberBenefitInputs.length) {
    const benefits = normalizeMemberBenefits(workingConfig.memberBenefits);
    memberBenefitInputs.forEach((input) => {
      const item = benefits.find((row) => row.level === input.dataset.memberBenefitLevel);
      if (item) item[input.dataset.memberBenefitField] = input.value.trim();
    });
    workingConfig.memberBenefits = normalizeMemberBenefits(benefits);
  }
  if ($("heroEyebrowEnabled")) {
    workingConfig.heroEyebrowEnabled = $("heroEyebrowEnabled").checked;
    workingConfig.heroTitleEnabled = $("heroTitleEnabled").checked;
    workingConfig.heroSubtitleEnabled = $("heroSubtitleEnabled").checked;
    workingConfig.heroEyebrow = $("heroEyebrow").value.trim() || defaultConfig.heroEyebrow;
    workingConfig.heroTitle = $("heroTitle").value.trim() || defaultConfig.heroTitle;
    workingConfig.heroSubtitle = $("heroSubtitle").value.trim() || defaultConfig.heroSubtitle;
    workingConfig.heroImageUrl = $("heroImageUrl").value;
    workingConfig.heroImageName = String(workingConfig.heroImageName || "");
    workingConfig.heroImagePath = String(workingConfig.heroImagePath || "");
  }
  const activityInputs = document.querySelectorAll("[data-activity-feature]");
  if (activityInputs.length) {
    workingConfig.activityFeatures = { ...(workingConfig.activityFeatures || {}) };
    activityInputs.forEach((input) => {
      workingConfig.activityFeatures[input.dataset.activityFeature] = input.checked;
    });
  }
  return workingConfig;
}

function showLogin() {
  $("loginView").classList.remove("login-leave");
  $("adminView").classList.remove("admin-enter");
  $("loginView").hidden = false;
  $("adminView").hidden = true;
}

function showAdmin() {
  const animateLogin = !$("loginView").hidden;
  if (animateLogin) $("loginView").classList.add("login-leave");
  window.setTimeout(() => {
    $("loginView").hidden = true;
    $("adminView").hidden = false;
    $("adminView").classList.remove("admin-enter");
    if (!activeMerchant) activeMerchant = ensureDefaultMerchant()[0];
    loadActiveMerchant();
    renderMenu();
    renderMerchantStrip();
    switchPage(currentPage);
    requestAnimationFrame(() => $("adminView").classList.add("admin-enter"));
  }, animateLogin ? 180 : 0);
}

function loadActiveMerchant() {
  workingConfig = loadMerchantConfig(activeMerchant.account);
  if (!workingConfig.products.some((item) => item.id === activeProductId)) activeProductId = workingConfig.products[0].id;
  $("currentMerchantName").textContent = activeMerchant.clubName;
  $("currentMerchantAccount").textContent = `账号：${activeMerchant.account}`;
}

async function login(account, password) {
  localStorage.removeItem(SESSION_KEY);
  const safeAccount = account.trim();
  const safePassword = password.trim();
  if (!safeAccount || !safePassword) return alert("请输入账号和密码");
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: safeAccount, password: safePassword }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "账号或密码错误");
    session = { role: result.role, account: result.account };
    await syncStoreFromServer();
    activeMerchant = session.role === "owner" ? ensureDefaultMerchant()[0] : getMerchant(session.account);
    if (!activeMerchant) throw new Error("未找到商户配置");
    saveSession();
    recordOperation("登录后台", session.role === "owner" ? "主管理员账号登录" : `商户子管理员 ${activeMerchant.clubName}`);
    showAdmin();
    return;
  } catch (error) {
    session = null;
    activeMerchant = null;
    alert(error.message || "登录失败，请稍后再试");
    return;
  }
  if (safeAccount === "admin" && safePassword === "admin123") {
    session = { role: "owner", account: "admin" };
    activeMerchant = ensureDefaultMerchant()[0];
    saveSession();
    recordOperation("登录后台", "主管理员账号登录");
    showAdmin();
    return;
  }
  const merchant = getMerchants().find((item) => item.account === safeAccount && item.password === safePassword);
  if (merchant) {
    session = { role: "merchant", account: merchant.account };
    activeMerchant = merchant;
    saveSession();
    recordOperation("登录后台", `商户子管理员 ${merchant.clubName}`);
    showAdmin();
    return;
  }
  session = null;
  activeMerchant = null;
  alert("账号或密码错误，请重新输入。主管理员：admin / admin123");
}

async function restoreSession() {
  try {
    const cached = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!cached || !cached.role || !cached.account || Date.now() > Number(cached.expiresAt || 0)) {
      localStorage.removeItem(SESSION_KEY);
      showLogin();
      return;
    }
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    const verified = await response.json();
    if (!response.ok || !verified.ok || verified.account !== cached.account) throw new Error("会话已失效");
    session = { role: verified.role, account: verified.account };
    await syncStoreFromServer();
    activeMerchant = session.role === "owner" ? ensureDefaultMerchant()[0] : getMerchant(session.account);
    if (!activeMerchant) {
      localStorage.removeItem(SESSION_KEY);
      showLogin();
      return;
    }
    recordOperation("自动登录后台", "24 小时有效登录状态");
    showAdmin();
  } catch {
    localStorage.removeItem(SESSION_KEY);
    showLogin();
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    ...session,
    expiresAt: Date.now() + SESSION_TTL,
  }));
}

function renderMenu() {
  const filter = ($("menuSearch").value || "").trim();
  $("menuTree").innerHTML = menuGroups.map((group) => {
    const items = group.items.filter((item) => !filter || item.includes(filter) || group.title.includes(filter));
    if (!items.length) return "";
    const isCurrentGroup = group.items.includes(currentPage);
    const isCollapsed = !filter && collapsedGroups.has(group.title);
    return `<div class="menu-group ${isCollapsed ? "is-closed" : "is-open"}">
      <button class="menu-title ${isCollapsed ? "collapsed" : "expanded"} ${isCurrentGroup ? "current" : ""}" data-group="${group.title}" type="button">
        <span class="menu-title-name">${group.title}</span>
        <span class="menu-title-meta">${items.length}</span>
      </button>
      <div class="menu-items ${isCollapsed ? "is-collapsed" : ""}">
        ${items.map((item) => `<button class="menu-item ${currentPage === item ? "active" : ""}" data-page="${item}" type="button">${item}</button>`).join("")}
      </div>
    </div>`;
  }).join("");
  document.querySelectorAll("[data-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const title = button.dataset.group;
      const group = menuGroups.find((item) => item.title === title);
      if (group?.items.length === 1) {
        switchPage(group.items[0]);
        return;
      }
      if (collapsedGroups.has(title)) collapsedGroups.delete(title);
      else collapsedGroups.add(title);
      renderMenu();
    });
  });
  document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.page)));
}

function switchPage(page) {
  saveDraftConfig(activeMerchant?.account, collectVisibleConfig());
  stopLiveOrderTracker();
  document.querySelector(".category-editor-backdrop")?.remove();
  document.querySelector(".order-review-backdrop")?.remove();
  document.body.classList.remove("admin-detail-open");
  categoryManagerState.editingIndex = -1;
  if (!menuGroups.some((group) => group.items.includes(page))) {
    page = "数据统计";
  }
  currentPage = page;
  collapsedGroups.delete(findGroup(page));
  $("breadcrumb").textContent = `/ ${findGroup(page)} / ${page}`;
  $("pageTitle").textContent = page;
  recordOperation(`打开 ${page}`, findGroup(page));
  renderMenu();
  if (page === "数据统计") renderDashboard();
  else if (page === "配置信息") renderSettings(page);
  else if (page === "轮播设置") renderCarouselSettings();
  else if (page === "商品列表") renderProductEditor();
  else if (page === "管理员列表") renderMerchantPage();
  else if (page === "管事邀请码") renderStewardInvites();
  else if (page === "提现审核") renderWithdrawAudit();
  else if (page === "罚单") renderFineModule();
  else if (page === "保证金") renderBondModule();
  else if (page === "订单评价") renderReviewAudit();
  else if (page === "跳转配置") renderBroadcastPage(page);
  else renderGenericPage(page);
  animatePageContent();
}

function animatePageContent() {
  const pageContent = $("pageContent");
  pageContent.classList.remove("page-enter");
  void pageContent.offsetWidth;
  pageContent.classList.add("page-enter");
}

function findGroup(page) {
  return menuGroups.find((group) => group.items.includes(page))?.title || "首页";
}

function renderMerchantStrip() {
  const merchants = getMerchants();
  $("merchantQuickList").innerHTML = merchants.map((merchant) => `<button class="merchant-chip ${merchant.account === activeMerchant.account ? "active" : ""}" data-merchant="${merchant.account}">${merchant.clubName}</button>`).join("");
  document.querySelectorAll("[data-merchant]").forEach((button) => {
    button.addEventListener("click", () => {
      saveDraftConfig(activeMerchant?.account, collectVisibleConfig());
      const previous = activeMerchant?.clubName;
      activeMerchant = getMerchant(button.dataset.merchant);
      loadActiveMerchant();
      renderMerchantStrip();
      recordOperation("切换配置商户", `${previous || "-"} -> ${activeMerchant.clubName}`);
      switchPage(currentPage);
    });
  });
}

function renderDashboard() {
  $("pageContent").innerHTML = $("dashboardTemplate").innerHTML;
  const orders = getMerchantOrders();
  const done = orders.filter((item) => item.status === "已完成");
  const totalAmount = orders.reduce((sum, item) => sum + item.price, 0);
  const users = buildUsersFromOrders(orders);
  const productStats = productRowsFromOrders(orders);
  const cards = [
    ["订单总数（笔）", orders.length],
    ["用户确认单数（笔）", done.length],
    ["待服务订单（笔）", orders.filter((item) => item.status === "待服务").length],
    ["订单总金额（元）", totalAmount.toFixed(2)],
  ];
  document.querySelector(".stats-grid").innerHTML = cards.map(([label, value]) => `<div class="stat-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("paidOrders").textContent = orders.length;
  $("paidUsers").textContent = users.length;
  $("paidAmount").textContent = totalAmount.toFixed(2);
  $("visitCount").textContent = workingConfig.products.reduce((sum, item) => sum + Number(item.views || 0), 0);
  $("productRank").innerHTML = productStats.length
    ? productStats.slice(0, 10).map((item, index) => `<tr><td>${index + 1}</td><td>${item.title}</td><td>${money(item.amount)}</td><td>${item.count}</td></tr>`).join("")
    : `<tr><td colspan="4">当前商户还没有前台下单数据</td></tr>`;
  $("userRank").innerHTML = users.length
    ? users.slice(0, 10).map((item, index) => `<tr><td>${index + 1}</td><td>${item.name}<br><small>${item.id}</small></td><td>${money(item.amount)}</td><td>${item.orders}</td></tr>`).join("")
    : `<tr><td colspan="4">当前商户还没有用户购买数据</td></tr>`;
  bindExportButtons();
}

function renderMemberBenefitSettings() {
  const benefits = normalizeMemberBenefits(workingConfig.memberBenefits);
  workingConfig.memberBenefits = benefits;
  const html = `<section class="panel member-benefit-panel">
    <div class="panel-head"><h2>会员等级配置</h2><span class="panel-tip">配置黄金、铂金、钻石、黑金的达成条件和权益说明，保存后同步到客户端。</span></div>
    <div class="member-benefit-grid">
      ${benefits.map((item) => `<article class="member-benefit-card" data-member-benefit="${item.level}">
        <header><strong>${item.level}</strong><span>会员等级</span></header>
        <label>达成条件<input data-member-benefit-level="${item.level}" data-member-benefit-field="condition" value="${escapeHtml(item.condition)}"></label>
        <label>权益内容<textarea data-member-benefit-level="${item.level}" data-member-benefit-field="benefits" rows="4">${escapeHtml(item.benefits)}</textarea></label>
      </article>`).join("")}
    </div>
  </section>`;
  $("pageContent").innerHTML = html;
  document.querySelectorAll("[data-member-benefit-field]").forEach((input) => {
    input.addEventListener("input", () => saveDraftConfig(activeMerchant.account, collectVisibleConfig()));
  });
}

function stopLiveOrderTracker() {
  if (liveOrderTrackerTimer) window.clearInterval(liveOrderTrackerTimer);
  liveOrderTrackerTimer = null;
}

function liveOrderRows(items) {
  if (!items.length) return `<div class="live-order-empty">暂无真实订单，产生新订单后会自动显示。</div>`;
  return items.map((item) => `<div class="live-order-row">
    <span class="live-order-dot" aria-hidden="true"></span>
    <strong>${escapeHtml(item.user || "匿名客户")}</strong>
    <span>购买了 ${escapeHtml(item.product || "订单")}</span>
    <small>${escapeHtml(item.orderNo || "")}${item.time ? ` · ${escapeHtml(item.time)}` : ""}</small>
  </div>`).join("");
}

async function refreshLiveOrderTracker(account) {
  const feed = $("liveOrderFeed");
  const status = $("liveOrderStatus");
  if (!feed || !status || currentPage !== "配置信息" || activeMerchant?.account !== account) return;
  try {
    const response = await fetch(`/api/public/orders/${encodeURIComponent(account)}?scope=recent&t=${Date.now()}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.message || "订单读取失败");
    const items = Array.isArray(payload.broadcasts) ? payload.broadcasts : [];
    feed.innerHTML = liveOrderRows(items);
    status.textContent = "实时同步";
    status.classList.remove("error");
  } catch {
    feed.innerHTML = `<div class="live-order-empty error">实时订单暂时无法读取，请检查本地服务和数据库。</div>`;
    status.textContent = "同步失败";
    status.classList.add("error");
  }
}

function startLiveOrderTracker() {
  stopLiveOrderTracker();
  const account = activeMerchant?.account;
  if (!account || !$("liveOrderFeed")) return;
  refreshLiveOrderTracker(account);
  liveOrderTrackerTimer = window.setInterval(() => refreshLiveOrderTracker(account), 5000);
}

function renderSettings(page) {
  $("pageContent").innerHTML = $("settingsTemplate").innerHTML;
  $("staffBondRequirement").value = String(workingConfig.staffBondRequirement ?? 0);
  const productsPerRowInput = $("productsPerRow");
  productsPerRowInput.value = String(Math.min(4, Math.max(1, Math.floor(Number(workingConfig.productsPerRow) || 2))));
  const readProductsPerRowInput = () => {
    const typed = Number(productsPerRowInput.value);
    return Number.isFinite(typed) && typed >= 1
      ? Math.min(4, Math.max(1, Math.floor(typed)))
      : Math.min(4, Math.max(1, Math.floor(Number(workingConfig.productsPerRow) || 2)));
  };
  productsPerRowInput.addEventListener("input", () => {
    const value = readProductsPerRowInput();
    workingConfig.productsPerRow = value;
    saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    const tip = productsPerRowInput.closest(".panel")?.querySelector(".panel-tip");
    if (tip) tip.textContent = `草稿：每排 ${value} 个商品，点击右上角“保存并关联前端”后发布`;
  });
  productsPerRowInput.addEventListener("change", () => {
    const value = readProductsPerRowInput();
    productsPerRowInput.value = String(value);
    workingConfig.productsPerRow = value;
    saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    const tip = productsPerRowInput.closest(".panel")?.querySelector(".panel-tip");
    if (tip) tip.textContent = `草稿：每排 ${value} 个商品，尚未发布`;
  });
  $("broadcastEnabled").checked = workingConfig.broadcastEnabled !== false;
  $("detailFloatEnabled").checked = workingConfig.detailFloatEnabled !== false;
  startLiveOrderTracker();
}

function renderCarouselSettings() {
  $("pageContent").innerHTML = $("carouselTemplate").innerHTML;
  $("heroEyebrowEnabled").checked = workingConfig.heroEyebrowEnabled !== false;
  $("heroTitleEnabled").checked = workingConfig.heroTitleEnabled !== false;
  $("heroSubtitleEnabled").checked = workingConfig.heroSubtitleEnabled !== false;
  $("heroEyebrow").value = workingConfig.heroEyebrow || defaultConfig.heroEyebrow;
  $("heroTitle").value = workingConfig.heroTitle || defaultConfig.heroTitle;
  $("heroSubtitle").value = workingConfig.heroSubtitle || defaultConfig.heroSubtitle;
  renderHeroImagePreview(workingConfig.heroImageUrl || "", workingConfig.heroImageName || "", workingConfig.heroImagePath || "");
  $("heroImageButton").addEventListener("click", () => $("heroImage").click());
  $("heroImageRemoveBtn").addEventListener("click", () => {
    workingConfig.heroImageUrl = "";
    workingConfig.heroImageName = "";
    workingConfig.heroImagePath = "";
    renderHeroImagePreview("");
    saveDraftConfig(activeMerchant.account, collectVisibleConfig());
  });
  $("heroImage").addEventListener("change", onHeroImage);
}

function renderProductEditor() {
  $("pageContent").innerHTML = $("productTemplate").innerHTML;
  workingConfig.products = workingConfig.products.map(normalizeProductAdminFields);
  fillProductFilters();
  bindProductListActions();
  renderProductTable();
  $("productImageButton").addEventListener("click", () => $("productImage").click());
  $("productImage").addEventListener("change", onProductImage);
}

function fillProductFilters() {
  const categories = [...new Set(workingConfig.products.map((item) => normalizeProductAdminFields(item).category).filter(Boolean))];
  const tags = [...new Set(workingConfig.products.map((item) => normalizeProductAdminFields(item).tag).filter(Boolean))];
  $("productSearchCategory").innerHTML = `<option value="">请选择商品分类</option>${categories.map((item) => `<option>${item}</option>`).join("")}`;
  $("productSearchTag").innerHTML = `<option value="">请选择商品标签</option>${tags.map((item) => `<option>${item}</option>`).join("")}`;
}

function bindProductListActions() {
  $("productSearchBtn").addEventListener("click", () => {
    runProductTableTransition("搜索", () => {
      productListState.keyword = $("productSearchName").value.trim();
      productListState.category = $("productSearchCategory").value;
      productListState.spec = $("productSearchSpec").value;
      productListState.tag = $("productSearchTag").value;
      productListState.share = $("productSearchShare").value;
      productListState.page = 1;
    });
  });
  $("productResetBtn").addEventListener("click", () => {
    runProductTableTransition("重置", () => {
      productListState = { status: "visible", page: 1, pageSize: Number($("productPageSize").value), keyword: "", category: "", spec: "", tag: "", share: "" };
      ["productSearchName", "productSearchCategory", "productSearchSpec", "productSearchTag", "productSearchShare", "productSearchDate"].forEach((id) => { $(id).value = ""; });
    });
  });
  $("productAddBtn").addEventListener("click", () => openProductModal("add"));
  $("productBatchDeleteBtn").addEventListener("click", batchDeleteProducts);
  $("productBatchHideBtn").addEventListener("click", () => batchSetProductStatus("hidden"));
  $("productCheckAll").addEventListener("change", () => {
    document.querySelectorAll("[data-product-check]").forEach((item) => { item.checked = $("productCheckAll").checked; });
  });
  $("productPageSize").addEventListener("change", () => {
    productListState.pageSize = Number($("productPageSize").value);
    productListState.page = 1;
    renderProductTable();
  });
  $("productPrevPage").addEventListener("click", () => { productListState.page = Math.max(1, productListState.page - 1); renderProductTable(); });
  $("productNextPage").addEventListener("click", () => { productListState.page += 1; renderProductTable(); });
  document.querySelectorAll("#productStatusTabs [data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      productListState.status = button.dataset.status;
      productListState.page = 1;
      renderProductTable();
    });
  });
  $("productModalClose").addEventListener("click", closeProductModal);
  $("productCancelBtn").addEventListener("click", closeProductModal);
  $("productSaveBtn").addEventListener("click", saveProductFromModal);
  $("productMainCategory").addEventListener("change", () => fillProductSubCategorySelector(""));
  $("productShowStrikePrice").addEventListener("change", () => {
    $("productStrikePrice").disabled = !$("productShowStrikePrice").checked;
  });
  bindProductDescToolbar();
}

function getFilteredProducts() {
  return workingConfig.products.map(normalizeProductAdminFields).filter((product) => {
    const nameMatch = !productListState.keyword || `${product.title} ${product.orderTitle}`.includes(productListState.keyword);
    const categoryMatch = !productListState.category || product.category === productListState.category;
    const specMatch = !productListState.spec || product.spec === productListState.spec;
    const tagMatch = !productListState.tag || product.tag === productListState.tag;
    const shareMatch = !productListState.share || (productListState.share === "系统默认" ? product.share.includes("系统默认") : !product.share.includes("系统默认"));
    const statusMatch = product.status === productListState.status;
    return nameMatch && categoryMatch && specMatch && tagMatch && shareMatch && statusMatch;
  });
}

function runProductTableTransition(action, updateState) {
  const tableWrap = document.querySelector(".product-table-wrap");
  const filter = document.querySelector(".product-filter");
  const button = action === "搜索" ? $("productSearchBtn") : $("productResetBtn");
  const originalContent = button.innerHTML;
  filter?.classList.add("filter-pulse");
  tableWrap?.classList.add("table-leave");
  button.disabled = true;
  button.textContent = action === "搜索" ? "搜索中" : "↻";
  window.setTimeout(() => {
    updateState();
    renderProductTable();
    tableWrap?.classList.remove("table-leave");
    tableWrap?.classList.add("table-enter");
    button.disabled = false;
    button.innerHTML = originalContent;
    filter?.classList.remove("filter-pulse");
    window.setTimeout(() => tableWrap?.classList.remove("table-enter"), 280);
  }, 180);
}

function renderProductTable() {
  const counts = { visible: 0, hidden: 0 };
  workingConfig.products.map(normalizeProductAdminFields).forEach((item) => { counts[item.status] = (counts[item.status] || 0) + 1; });
  document.querySelectorAll("#productStatusTabs [data-status]").forEach((button) => {
    button.classList.toggle("active", button.dataset.status === productListState.status);
    button.querySelector("span").textContent = counts[button.dataset.status] || 0;
  });
  const rows = getFilteredProducts();
  const totalPages = Math.max(1, Math.ceil(rows.length / productListState.pageSize));
  productListState.page = Math.min(productListState.page, totalPages);
  const pageRows = rows.slice((productListState.page - 1) * productListState.pageSize, productListState.page * productListState.pageSize);
  $("productTotalText").textContent = `共 ${rows.length} 条`;
  $("productTableBody").innerHTML = pageRows.length ? pageRows.map((product, index) => {
    const productNo = product.no || product.id.replace(/\D/g, "").slice(-6) || `${14670 + index}`;
    return `<tr>
      <td><input type="checkbox" data-product-check="${product.id}" /></td>
      <td>${productNo}</td>
      <td><div class="product-info-cell"><div class="product-thumb ${product.imageUrl ? "has-image" : ""}">${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.title}">` : "图"}</div><div><strong>${product.title || product.orderTitle}${product.lotteryEnabled ? `<em class="product-lottery-badge">抽奖</em>` : ""}</strong><small>${product.orderTitle || product.title}</small></div></div></td>
      <td><strong>${product.mainCategory}</strong><small>${product.subCategory || product.category}</small></td>
      <td>${product.tag}</td>
      <td>${money(product.price)}</td>
      <td>${Number(product.sold || 0)}<small>+${Number(product.views || 0)}</small></td>
      <td>${product.stock}</td>
      <td>${product.spec}</td>
      <td>${product.share}</td>
      <td><button class="product-status-toggle ${product.status === "visible" ? "is-visible" : "is-hidden"}" type="button" role="switch" aria-checked="${product.status === "visible"}" aria-label="${product.status === "visible" ? "点击隐藏" : "点击显示"}${escapeHtml(product.title || product.orderTitle)}" data-product-visibility="${product.id}" data-next-status="${product.status === "visible" ? "hidden" : "visible"}"><i></i><span>${product.status === "visible" ? "开启" : "隐藏"}</span></button></td>
      <td class="product-lottery-cell"><button type="button" class="product-status-toggle ${product.lotteryEnabled ? "is-visible" : "is-hidden"}" role="switch" aria-checked="${product.lotteryEnabled}" aria-label="抽奖模式 ${escapeHtml(product.title || product.orderTitle)}" data-product-lottery="${escapeHtml(product.id)}"><i></i><span>${product.lotteryEnabled ? "开启" : "关闭"}</span></button></td>
      <td>${product.sort}</td>
      <td><div class="product-row-actions"><button data-product-detail="${product.id}">详情</button><button data-product-edit="${product.id}">编辑</button></div></td>
    </tr>`;
  }).join("") : `<tr><td colspan="14">暂无商品，请点击新增。</td></tr>`;
  document.querySelectorAll("[data-product-lottery]").forEach((button) => button.addEventListener("click", () => toggleProductLottery(button)));
  $("productPages").innerHTML = Array.from({ length: totalPages }, (_, index) => `<button class="${productListState.page === index + 1 ? "active" : ""}" data-product-page="${index + 1}">${index + 1}</button>`).join("");
  document.querySelectorAll("[data-product-page]").forEach((button) => button.addEventListener("click", () => { productListState.page = Number(button.dataset.productPage); renderProductTable(); }));
  document.querySelectorAll("[data-product-detail]").forEach((button) => button.addEventListener("click", () => openProductModal("detail", button.dataset.productDetail)));
  document.querySelectorAll("[data-product-edit]").forEach((button) => button.addEventListener("click", () => openProductModal("edit", button.dataset.productEdit)));
  document.querySelectorAll("[data-product-visibility]").forEach((button) => button.addEventListener("click", () => setProductStatus(button.dataset.productVisibility, button.dataset.nextStatus)));
}

function selectedProductIds() {
  return Array.from(document.querySelectorAll("[data-product-check]:checked")).map((item) => item.dataset.productCheck);
}

async function toggleProductLottery(button) {
  const product = workingConfig.products.find((item) => String(item.id) === button.dataset.productLottery);
  if (!product || button.disabled) return;
  const previous = { lotteryEnabled: product.lotteryEnabled, lotteryPoolId: product.lotteryPoolId };
  product.lotteryEnabled = !product.lotteryEnabled;
  if (product.lotteryEnabled && !product.lotteryPoolId) {
    product.lotteryPoolId = normalizeLotteryPools(workingConfig.lotteryPools).find((pool) => pool.enabled && pool.prizes.some((prize) => prize.productIds.includes(String(product.id))))?.id || "";
  }
  button.disabled = true;
  try {
    const result = await publishProducts();
    if (!result.ok) throw result.error || new Error("抽奖模式保存失败");
    if (product.lotteryEnabled && !product.lotteryPoolId) adminToast("抽奖模式已开启", "请在奖池管理中为此商品配置奖品后再下单");
  } catch (error) {
    Object.assign(product, previous);
    adminToast("保存失败", error.message, "error");
  } finally { renderProductTable(); }
}

async function batchSetProductStatus(status) {
  const ids = selectedProductIds();
  if (!ids.length) return alert("请先选择商品");
  const selectedIds = new Set(ids.map(String));
  workingConfig.products = workingConfig.products.map((item, index) => (
    selectedIds.has(String(item.id)) ? { ...normalizeProductAdminFields(item, index), status } : item
  ));
  const result = await publishProducts();
  if (!result.ok) return alert(result.error?.message || "商品状态同步失败");
  $("productCheckAll").checked = false;
  renderProductTable();
}

async function batchDeleteProducts() {
  const ids = selectedProductIds();
  if (!ids.length) return alert("请先选择商品");
  if (!window.confirm(`确定永久删除选中的 ${ids.length} 个商品吗？删除后无法恢复。`)) return;

  const previousProducts = clone(workingConfig.products);
  const previousDeletedProductIds = clone(workingConfig.deletedProductIds || []);
  const selectedIds = new Set(ids.map(String));
  workingConfig.products = workingConfig.products.filter((item) => !selectedIds.has(String(item.id)));
  workingConfig.deletedProductIds = Array.from(new Set([
    ...previousDeletedProductIds.map(String),
    ...ids.map(String),
  ]));
  workingConfig.product = workingConfig.products[0] || null;

  const result = await publishProducts();
  if (!result.ok) {
    workingConfig.products = previousProducts;
    workingConfig.deletedProductIds = previousDeletedProductIds;
    workingConfig.product = previousProducts[0] || null;
    return alert(result.error?.message || "商品删除同步失败");
  }

  $("productCheckAll").checked = false;
  fillProductFilters();
  renderProductTable();
}

async function setProductStatus(id, status) {
  const previousProducts = clone(workingConfig.products);
  workingConfig.products = workingConfig.products.map((item, index) => (
    String(item.id) === String(id) ? { ...normalizeProductAdminFields(item, index), status } : item
  ));
  const result = await publishProducts();
  if (!result.ok) {
    workingConfig.products = previousProducts;
    renderProductTable();
    return alert(result.error?.message || "商品状态同步失败");
  }
  renderProductTable();
}

function createBlankProduct() {
  return {
    id: `custom_${Date.now()}`,
    no: `${Date.now()}`.slice(-6),
    title: "",
    orderTitle: "",
    mainCategory: "",
    subCategory: "",
    category: "",
    tag: "",
    price: 0,
    orderPrice: 0,
    strikePrice: 0,
    showStrikePrice: false,
    originalPrice: 0,
    oldPrice: 0,
    increasePrice: 0,
    stock: 10000,
    spec: "单规格",
    service: "关闭",
    share: "系统默认:金牌陪玩:70%,普通陪玩:70%",
    sort: workingConfig.products.length + 1,
    status: "visible",
    sold: 0,
    views: 0,
    imageUrl: "",
    imageName: "",
    imagePath: "",
    increaseReason: "当前无涨价。",
    desc: "请填写商品说明。",
    orderDesc: "请填写订单页说明。",
    lotteryEnabled: false,
    lotteryPoolId: "",
  };
}

function openProductModal(mode, id) {
  const product = id ? normalizeProductAdminFields(workingConfig.products.find((item) => item.id === id)) : createBlankProduct();
  activeProductId = product.id;
  $("productModal").dataset.mode = mode;
  $("productModalTitle").textContent = mode === "detail" ? "商品详情" : mode === "add" ? "新增商品" : "编辑商品";
  $("productTitle").value = product.title || product.orderTitle || "";
  $("productOrderTitle").value = product.orderTitle || product.title || "";
  fillProductCategorySelectors(product);
  $("productTag").value = product.tag || "";
  $("productPrice").value = product.price || 0;
  $("productStrikePrice").value = product.strikePrice || 0;
  $("productShowStrikePrice").checked = product.showStrikePrice === true;
  $("productStrikePrice").disabled = product.showStrikePrice !== true;
  $("productOrderPrice").value = product.orderPrice || 0;
  $("productStock").value = product.stock || 0;
  $("productSort").value = product.sort || 0;
  $("productSpec").value = product.spec || "单规格";
  $("productViews").value = Number(product.views || 0);
  $("productSold").value = Number(product.sold || 0);
  $("productShare").value = product.staffShareText || product.share || "";
  $("productDesc").value = product.desc || "";
  $("productOrderDesc").value = product.orderDesc || "";
  $("productIncreaseReason").value = product.increaseReason || "";
  renderImagePreview(product.imageUrl || "", product.imageName || "", product.imagePath || "");
  document.querySelectorAll("#productModal input, #productModal textarea, #productModal select").forEach((item) => { item.disabled = mode === "detail"; });
  $("productImageButton").disabled = mode === "detail";
  if (mode !== "detail") $("productStrikePrice").disabled = !$("productShowStrikePrice").checked;
  $("productSaveBtn").hidden = mode === "detail";
  $("productModal").hidden = false;
}

function closeProductModal() {
  $("productCancelBtn")?.classList.add("is-clicking");
  $("productModal").hidden = true;
  document.querySelectorAll("#productModal input, #productModal textarea, #productModal select").forEach((item) => { item.disabled = false; });
  window.setTimeout(() => $("productCancelBtn")?.classList.remove("is-clicking"), 120);
}

async function saveProductFromModal() {
  const saveButton = $("productSaveBtn");
  saveButton.classList.add("is-clicking");
  saveButton.disabled = true;
  const originalText = saveButton.textContent;
  saveButton.textContent = "保存中...";
  try {
  const base = workingConfig.products.find((item) => item.id === activeProductId) || { id: activeProductId };
  const displayPrice = Number($("productPrice").value || 0);
  const orderPayPrice = Number($("productOrderPrice").value || $("productPrice").value || 0);
  const strikePrice = Math.max(0, Number($("productStrikePrice").value || 0));
  const showStrikePrice = $("productShowStrikePrice").checked && strikePrice > 0;
  const product = {
    ...base,
    title: $("productTitle").value.trim(),
    orderTitle: $("productTitle").value.trim(),
    mainCategory: $("productMainCategory").value,
    subCategory: $("productCategory").value,
    category: $("productCategory").value,
    tag: $("productTag").value.trim() || "单子",
    price: displayPrice,
    orderPrice: orderPayPrice,
    strikePrice,
    showStrikePrice,
    originalPrice: displayPrice,
    increasePrice: Math.max(0, Number((orderPayPrice - displayPrice).toFixed(2))),
    oldPrice: strikePrice,
    stock: Number($("productStock").value || 0),
    sort: Number($("productSort").value || 0),
    spec: $("productSpec").value,
    views: Math.max(0, Math.floor(Number($("productViews").value || 0))),
    sold: Math.max(0, Math.floor(Number($("productSold").value || 0))),
    share: $("productShare").value.trim() || "系统默认:金牌陪玩:70%,普通陪玩:70%",
    staffShareText: $("productShare").value.trim() || "70%",
    staffShare: calculateStaffShareAmount($("productShare").value.trim() || "70%", orderPayPrice),
    status: base.status === "hidden" ? "hidden" : "visible",
    imageUrl: $("imageUrl").value,
    imageName: $("imageName").value,
    imagePath: $("imagePath").value,
    desc: $("productDesc").value.trim(),
    orderDesc: $("productOrderDesc").value.trim(),
    increaseReason: $("productIncreaseReason").value.trim(),
    lotteryEnabled: base.lotteryEnabled === true,
    lotteryPoolId: String(base.lotteryPoolId || ""),
  };
  if (!product.title) {
    saveButton.textContent = originalText;
    saveButton.disabled = false;
    saveButton.classList.remove("is-clicking");
    return alert("请填写商品名称");
  }
  if (!product.mainCategory || !product.category) {
    saveButton.textContent = originalText;
    saveButton.disabled = false;
    saveButton.classList.remove("is-clicking");
    return alert("请选择商品的大分类和小分类");
  }
  if (workingConfig.products.some((item) => item.id === activeProductId)) {
    workingConfig.products = workingConfig.products.map((item) => item.id === activeProductId ? product : item);
  } else {
    workingConfig.products.unshift(product);
  }
  workingConfig.products = workingConfig.products.map((item, index) => normalizeProductAdminFields(item, index));
  workingConfig.product = workingConfig.products[0];
  productListState = { ...productListState, status: product.status || "visible", page: 1, keyword: "", category: "", spec: "", tag: "", share: "" };
  ["productSearchName", "productSearchCategory", "productSearchSpec", "productSearchTag", "productSearchShare"].forEach((id) => {
    if ($(id)) $(id).value = "";
  });
  const result = await publishProducts();
  if (!result.ok) {
    saveButton.textContent = originalText;
    saveButton.disabled = false;
    saveButton.classList.remove("is-clicking");
    alert(result.error?.message || "商品没有同步到前台，请确认后台登录状态和预览服务是否正常。");
    return;
  }
  closeProductModal();
  fillProductFilters();
  renderProductTable();
  } catch (error) {
    console.error("Product save failed", error);
    alert(error?.message || "商品保存失败，请重试。");
  } finally {
    saveButton.textContent = originalText;
    saveButton.disabled = false;
    saveButton.classList.remove("is-clicking");
  }
}

function renderImagePreview(src, fileName = "", filePath = "") {
  $("imageUrl").value = src || "";
  $("imageName").value = fileName || "";
  $("imagePath").value = filePath || "";
  $("imagePreview").innerHTML = src ? `<img src="${src}" alt="商品图预览">` : "尚未上传商品图";
  $("productImageButton").textContent = src ? "更换图片" : "选择图片";
  const status = $("productImageStatus");
  const merchantPath = filePath || (/^\/data\/merchant-assets\//.test(src) ? src.replace(/^\//, "") : "");
  status.textContent = src
    ? (merchantPath ? `商户文件：${merchantPath}` : `商户配置：${activeMerchant?.account || "-"} / ${fileName || "商品图片"}`)
    : "尚未上传商品图";
  status.title = src ? `${status.textContent}${fileName ? `（原文件：${fileName}）` : ""}` : "";
  if (src && !/^data:/i.test(src)) {
    status.href = src;
    status.target = "_blank";
    status.rel = "noopener";
  } else {
    status.removeAttribute("href");
    status.removeAttribute("target");
    status.removeAttribute("rel");
  }
}

function renderHeroImagePreview(src, fileName = "", filePath = "") {
  $("heroImageUrl").value = src || "";
  $("heroImagePreview").innerHTML = src ? `<img src="${src}" alt="轮播图预览">` : "尚未上传轮播图";
  $("heroImageButton").textContent = src ? "更换图片" : "选择图片";
  $("heroImageRemoveBtn").disabled = !src;
  const status = $("heroImageStatus");
  const merchantPath = filePath || (/^\/data\/merchant-assets\//.test(src) ? src.replace(/^\//, "") : "");
  status.textContent = src
    ? (merchantPath ? `商户文件：${merchantPath}` : `商户配置：${activeMerchant?.account || "-"} / ${fileName || "轮播图片"}`)
    : "尚未上传轮播图";
  status.title = src ? `${status.textContent}${fileName ? `（原文件：${fileName}）` : ""}` : "";
  if (src && !/^data:/i.test(src)) {
    status.href = src;
    status.target = "_blank";
    status.rel = "noopener";
  } else {
    status.removeAttribute("href");
    status.removeAttribute("target");
    status.removeAttribute("rel");
  }
}

async function onProductImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imageDataUrl = await imageFileToDataUrl(file, 1600, 0.88);
    const response = await fetch(`/api/merchant-assets/${encodeURIComponent(activeMerchant.account)}/products/${encodeURIComponent(activeProductId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ imageDataUrl, fileName: file.name }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !result.asset) {
      throw new Error(result.message || "商品图片保存失败");
    }
    renderImagePreview(result.asset.url, result.asset.fileName, result.asset.path);
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
}

async function onHeroImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imageDataUrl = await imageFileToDataUrl(file, 1800, 0.86);
    const response = await fetch(`/api/merchant-assets/${encodeURIComponent(activeMerchant.account)}/hero`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ imageDataUrl, fileName: file.name }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !result.asset) {
      throw new Error(result.message || "轮播图片保存失败");
    }
    workingConfig.heroImageUrl = result.asset.url;
    workingConfig.heroImageName = result.asset.fileName;
    workingConfig.heroImagePath = result.asset.path;
    renderHeroImagePreview(result.asset.url, result.asset.fileName, result.asset.path);
    saveDraftConfig(activeMerchant?.account, collectVisibleConfig());
  } catch (error) {
    alert(error.message);
  } finally {
    event.target.value = "";
  }
}

function renderMerchantPage() {
  $("pageContent").innerHTML = $("merchantTemplate").innerHTML;
  if (session.role !== "owner") document.querySelector(".owner-only").remove();
  renderMerchantList();
  $("createMerchantBtn")?.addEventListener("click", createMerchant);
}

function renderMerchantList() {
  const merchants = getMerchants();
  $("merchantList").innerHTML = merchants.length ? merchants.map((merchant) => `<div class="list-item">
    <div><strong>${merchant.clubName}</strong><small>账号：${merchant.account} / 密码已加密保存</small></div>
    <div class="list-actions">
      <button data-select-merchant="${merchant.account}">进入配置</button>
    </div>
  </div>`).join("") : `<div class="empty">还没有商户子管理员。</div>`;
  document.querySelectorAll("[data-select-merchant]").forEach((button) => button.addEventListener("click", () => {
    activeMerchant = getMerchant(button.dataset.selectMerchant);
    loadActiveMerchant();
    renderMerchantStrip();
    switchPage("商品列表");
  }));
}

function createMerchant() {
  const account = $("merchantAccount").value.trim();
  const password = $("merchantPassword").value.trim();
  const clubName = $("merchantClubName").value.trim();
  if (!account || !password || !clubName) {
    alert("请填写商户账号、密码和俱乐部名称");
    return;
  }
  const merchants = getMerchants();
  if (merchants.some((item) => item.account === account)) {
    alert("这个商户账号已经存在");
    return;
  }
  const merchant = { account, password, clubName };
  merchants.push(merchant);
  saveMerchants(merchants);
  saveMerchantConfig(account, clone(defaultConfig));
  activeMerchant = merchant;
  loadActiveMerchant();
  renderMerchantStrip();
  switchPage("商品列表");
}

function renderBroadcastPage(page) {
  $("pageContent").innerHTML = `<section class="panel"><h2>跳转配置</h2><table><thead><tr><th>入口</th><th>目标页面</th><th>状态</th></tr></thead><tbody><tr><td>首页 banner</td><td>商品详情</td><td><span class="tag">已开启</span></td></tr><tr><td>客服按钮</td><td>在线客服</td><td><span class="tag">已开启</span></td></tr></tbody></table><p class="hint">首页下单通报由真实订单自动生成，可在「平台管理 / 配置信息」选择是否展示，内容不可手工编辑。</p></section>`;
}

function renderGenericPage(page) {
  const group = findGroup(page);
  const renderer = {
    "订单管理": (page) => page === "余额变化" ? renderWalletLedger(page) : refreshOrderModule(page),
    "用户管理": renderUserModule,
    "陪玩管理": renderStaffModule,
    "员工管理": renderStaffModule,
    "财务管理": renderFinanceModule,
    "权限管理": renderPermissionModule,
    "商品管理": renderProductExtraModule,
    "活动管理": renderActivityModule,
    "平台管理": renderLogModule,
  }[group] || renderLogModule;
  renderer(page);
}

const refundSubmitting = new Set();
const orderMutationSubmitting = new Set();

function orderListTime(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? formatDateTime(new Date(timestamp)) : "";
}

function orderListImage(url) {
  return url ? `<img class="admin-order-image" src="${escapeHtml(url)}" alt="" loading="lazy">` : "";
}

function orderTableRow(item) {
  const paid = ["paid", "refund_pending", "refund_closed", "refunded"].includes(item.paymentStatus);
  const income = item.paymentStatus === "paid" ? getOrderStaffIncome(item) : 0;
  const prizes = item.lottery && Array.isArray(item.lottery.results) ? item.lottery.results : [];
  const status = ["待抽奖", "待服务"].includes(item.status) ? "待接单" : item.status === "进行中" ? "服务中" : item.status;
  const fields = [
    item.dbId || "", item.no, status, item.gameName || "", item.gameId || "", item.receiveMode || "",
    item.gameType || "", item.server || "", item.product || "", null,
    prizes.map((prize) => prize.name).join("、"), null,
    money(item.price || 0), item.quantity || 1, money(paid ? item.price : 0), money(income),
    money(item.paymentStatus === "paid" ? Math.max(0, Number(item.price || 0) - income) : 0),
    item.staff || "", item.staffPhone || "", item.teammate || "", item.remark || "",
    orderListTime(item.acceptedAt), orderListTime(item.completedAt), null,
    item.user || "", item.userPhone || "", item.time || "", orderListTime(item.paidAt),
    orderListTime(item.userConfirmedAt || item.customerConfirmedAt),
  ];
  const cells = fields.map((value, index) => {
    if (index === 2) return `<td><span class="tag admin-order-status-tag" data-status="${escapeHtml(status)}">${escapeHtml(status)}</span>${item.complaint?.status === "pending" ? '<span class="tag">投诉待处理</span>' : ""}</td>`;
    if (index === 9) return `<td>${orderListImage(item.productImage)}</td>`;
    if (index === 11) return `<td>${prizes.map((prize) => orderListImage(prize.imageUrl)).join("")}</td>`;
    if (index === 23) return `<td>${/^\/api\/order-evidence\//.test(String(item.completionProof?.url || "")) ? `<a href="${escapeHtml(item.completionProof.url)}" target="_blank" rel="noopener">查看凭证</a>` : ""}</td>`;
    return `<td>${escapeHtml(String(value ?? ""))}</td>`;
  });
  const canRefund = Number(item.price) > 0 && (item.paymentStatus === "paid" && ["balance", "wechat"].includes(item.paymentMethod)
    || item.paymentStatus === "refund_closed" && item.paymentMethod === "wechat");
  const key = `${activeMerchant?.account}:${item.no}`;
  const busy = refundSubmitting.has(key) || orderMutationSubmitting.has(key);
  const disabled = busy ? " disabled" : "";
  const canAssign = item.paymentStatus === "paid" && ["待服务", "待接单", "待开始"].includes(item.status)
    && (!item.lottery || item.lottery.status === "completed");
  const canRequeue = item.paymentStatus === "paid" && item.staffId && ["待开始", "服务中"].includes(item.status);
  const refundButton = canRefund || item.paymentStatus === "refund_pending"
    ? `<button type="button" class="admin-order-action admin-order-action--red" data-order-no="${escapeHtml(item.no)}" data-refund-order="${escapeHtml(item.no)}"${disabled}>${item.paymentStatus === "refund_closed" ? "重新退款" : canRefund ? "主动退款" : "核对退款"}</button>` : "";
  // 发罚单必须先有接单打手：罚单是扣打手「可用佣金」的，没打手的订单开出来没人能缴。
  const penaltyButton = item.staffId
    ? `<button type="button" class="admin-order-action admin-order-action--red" data-order-no="${escapeHtml(item.no)}" data-penalty-order="${escapeHtml(item.no)}" title="给接单打手开罚单，从打手可用佣金里扣"${disabled}>发罚单</button>` : "";
  return `<tr>${cells.join("")}<td><span class="tag" data-chat-summary="${escapeHtml(item.no)}">同步中</span></td><td><div class="admin-order-actions"><button type="button" class="admin-order-action admin-order-action--teal" data-open-order="${escapeHtml(item.no)}">订单详情</button>${canAssign ? `<button type="button" class="admin-order-action admin-order-action--teal" data-order-no="${escapeHtml(item.no)}" data-assign-order="${escapeHtml(item.no)}"${disabled}>选择打手</button>` : ""}${canRequeue ? `<button type="button" class="admin-order-action admin-order-action--orange" data-order-no="${escapeHtml(item.no)}" data-requeue-order="${escapeHtml(item.no)}"${disabled}>返回大厅</button>` : ""}${refundButton}${penaltyButton}</div></td></tr>`;
}

function renderOrderModule(page, statusFilter = "全部") {
  if (page === "余额变化") return renderWalletLedger(page);
  const rows = getMerchantOrders().filter((item) => {
    const status = ["待抽奖", "待服务"].includes(item.status) ? "待接单" : item.status === "进行中" ? "服务中" : item.status;
    if (statusFilter !== "全部" && status !== statusFilter) return false;
    if (page.includes("接单")) return ["待服务", "待接单"].includes(item.status)
      && (!item.lottery || item.lottery.status === "completed");
    if (page.includes("异常") || page.includes("退款")) return item.status.includes("售后") || item.status.includes("退款") || item.complaint?.status === "pending";
    return true;
  });
  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head"><h2>${page}</h2><div class="button-row admin-toolbar-actions"><button type="button" class="admin-icon-reset" id="orderResetBtn" aria-label="刷新订单" title="刷新订单">↻</button><button data-export="orders">导出订单</button></div></div>
    <div class="admin-order-statuses">${["全部", "待付款", "待接单", "待开始", "服务中", "待结单", "已完成", "已取消", "退款中", "退款异常", "退款失败", "已退款"].map((status) => `<button class="${statusFilter === status ? "active" : ""}" data-order-filter="${status}">${status}</button>`).join("")}</div>
    <div class="admin-order-table-wrap" role="region" aria-label="订单列表，可横向滚动" tabindex="0"><table class="admin-order-table"><thead><tr>${["Id", "订单号", "订单状态", "游戏昵称", "ID号码", "类型", "游戏类型", "游戏区服", "商品标题", "商品封面", "奖品", "奖品图片", "金额", "数量", "支付金额", "打手到手价", "利润", "打手姓名", "打手手机号", "队友", "订单备注", "接单时间", "完成时间", "完成凭证", "用户昵称", "用户手机号", "下单时间", "支付时间", "用户确认时间", "会话", "操作"].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>
      ${rows.length ? rows.map(orderTableRow).join("") : `<tr><td colspan="31">当前商户还没有对应订单，小程序下单后会自动同步到这里。</td></tr>`}
    </tbody></table></div>
  </section>`;
  const chatAccount = activeMerchant?.account;
  fetchOrderChatSummary(chatAccount, rows).then((summary) => {
    if (activeMerchant?.account !== chatAccount || currentPage !== page) return;
    document.querySelectorAll("[data-chat-summary]").forEach((node) => {
      const orderNo = node.dataset.chatSummary;
      const bossUnread = summary.boss?.[orderNo] || 0;
      const staffUnread = summary.staff?.[orderNo] || 0;
      node.textContent = bossUnread || staffUnread ? `客户${bossUnread} / 打手${staffUnread}` : "无未读";
    });
  }).catch(() => {
    if (activeMerchant?.account !== chatAccount || currentPage !== page) return;
    document.querySelectorAll("[data-chat-summary]").forEach((node) => { node.textContent = "同步失败"; });
  });
  document.querySelectorAll('[data-order-filter]').forEach((button) => button.onclick = () => renderOrderModule(page, button.dataset.orderFilter));
  document.querySelectorAll('[data-open-order]').forEach((button) => button.onclick = () => openAdminOrder(rows.find((order) => order.no === button.dataset.openOrder), page));
  document.querySelectorAll('[data-assign-order]').forEach((button) => button.onclick = () => mutateOrderAssignment(rows.find((order) => order.no === button.dataset.assignOrder), "assign", page, statusFilter));
  document.querySelectorAll('[data-requeue-order]').forEach((button) => button.onclick = () => mutateOrderAssignment(rows.find((order) => order.no === button.dataset.requeueOrder), "requeue", page, statusFilter));
  document.querySelectorAll('[data-refund-order]').forEach((button) => button.onclick = () => refundAdminOrder(rows.find((order) => order.no === button.dataset.refundOrder), page, statusFilter));
  document.querySelectorAll('[data-penalty-order]').forEach((button) => button.onclick = async () => {
    const order = rows.find((item) => item.no === button.dataset.penaltyOrder);
    if (!order) return adminToast("订单不存在", "请刷新订单列表后重试", "error");
    // 从订单行进来：开着订单页不动，开单成功后只把这颗按钮置灰，别把商户弹到别的页。
    await openFineDialog({ order, onCreated: () => {
      button.disabled = true;
      button.textContent = "已开罚单";
      button.title = "已为该订单开过罚单";
    } });
  });
  $("orderResetBtn")?.addEventListener("click", () => refreshOrderModule(page, statusFilter));
  bindExportButtons();
}

async function refreshOrderModule(page = "订单列表", status = "全部") {
  const account = activeMerchant.account;
  const requestId = refreshOrderModule.requestId = (refreshOrderModule.requestId || 0) + 1;
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(account)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result)) throw new Error(result.message || "订单同步失败");
    if (requestId !== refreshOrderModule.requestId || activeMerchant.account !== account || currentPage !== page) return;
    localStorage.setItem(`${ORDERS_KEY_PREFIX}_${account}`, JSON.stringify(result));
    renderOrderModule(page, status);
    return true;
  } catch (error) { if (requestId === refreshOrderModule.requestId && activeMerchant.account === account && currentPage === page) adminToast("同步失败", error.message, "error"); return false; }
}

function selectAuthorizedStaff(grants, order) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "admin-confirm-backdrop";
    backdrop.innerHTML = `<section class="admin-confirm-dialog admin-dialog" role="dialog" aria-modal="true" aria-label="选择打手"><h3>选择打手</h3><p>指定已授权员工接取订单 ${escapeHtml(order.no)}。</p><select class="admin-order-staff-select" aria-label="已授权打手"><option value="">请选择打手</option>${grants.map((grant) => `<option value="${escapeHtml(grant.customerId)}" ${grant.customerId === order.staffId ? "selected" : ""}>${escapeHtml(grant.displayName || "未设置昵称")}（${escapeHtml(grant.numericId || "无数字 ID")}）</option>`).join("")}</select><footer><button type="button" data-cancel>取消</button><button type="button" class="admin-confirm-ok is-primary" data-submit>确认指定</button></footer></section>`;
    document.body.appendChild(backdrop);
    const select = backdrop.querySelector("select");
    const close = (value) => { document.removeEventListener("keydown", onKeydown, true); backdrop.remove(); resolve(value); };
    const onKeydown = (event) => { if (event.key === "Escape") close(null); };
    backdrop.querySelector("[data-cancel]").onclick = () => close(null);
    backdrop.querySelector("[data-submit]").onclick = () => {
      if (!select.value) return adminToast("请选择打手", "只能选择当前商户已授权员工", "error");
      close(select.value);
    };
    backdrop.onclick = (event) => { if (event.target === backdrop) close(null); };
    document.addEventListener("keydown", onKeydown, true);
    select.focus();
  });
}

async function mutateOrderAssignment(order, action, page, statusFilter) {
  if (!order) return;
  const account = activeMerchant.account;
  const key = `${account}:${order.no}`;
  if (orderMutationSubmitting.has(key) || refundSubmitting.has(key)) return;
  orderMutationSubmitting.add(key);
  const buttons = [...document.querySelectorAll('[data-order-no]')].filter((button) => button.dataset.orderNo === order.no);
  buttons.forEach((button) => { button.disabled = true; });
  let staffId = "";
  try {
    if (action === "assign") {
      const grants = await loadStaffGrants();
      if (!grants.length) throw new Error("当前商户暂无已授权打手，请先到员工列表授权");
      if (activeMerchant.account !== account || currentPage !== page) return;
      staffId = await selectAuthorizedStaff(grants, order);
      if (!staffId) return;
    } else {
      const confirmed = await adminConfirm({ title: "返回接单大厅", message: "订单将解除当前打手并重新开放接单；已开始的服务进度会重置。", target: order.no, confirmText: "确认返回" });
      if (!confirmed) return;
    }
    if (activeMerchant.account !== account || currentPage !== page) return;
    const response = await fetch(`/api/orders/${encodeURIComponent(account)}/${encodeURIComponent(order.no)}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffId, expectedStaffId: order.staffId || "", expectedAcceptedAt: order.acceptedAt || 0 }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.order) throw new Error(result.message || "订单状态未确认");
    if (activeMerchant.account !== account || currentPage !== page) return;
    localStorage.setItem(orderKey(account), JSON.stringify(getMerchantOrders(account).map((item) => item.no === order.no ? result.order : item)));
    renderOrderModule(page, statusFilter);
    const synced = await refreshOrderModule(page, statusFilter);
    adminToast(synced ? action === "assign" ? "打手已指定" : "订单已返回接单大厅" : "操作已提交，列表同步失败，请刷新核对", "", synced ? "success" : "error");
  } catch (error) {
    if (activeMerchant.account === account && currentPage === page) {
      const synced = await refreshOrderModule(page, statusFilter);
      const latest = synced && getMerchantOrders(account).find((item) => item.no === order.no);
      const completed = latest && (action === "assign" ? latest.staffId === staffId && latest.status === "待开始"
        : latest.status === "待接单" && !latest.staffId);
      adminToast(completed ? action === "assign" ? "打手已指定" : "订单已返回接单大厅" : "操作未确认",
        completed ? "" : synced ? error.message || "请刷新后重试" : "列表同步失败，请刷新核对", completed ? "success" : "error");
    }
  } finally {
    orderMutationSubmitting.delete(key);
    if (activeMerchant.account === account && currentPage === page) {
      document.querySelectorAll('[data-order-no]').forEach((button) => {
        if (button.dataset.orderNo === order.no && !refundSubmitting.has(key)) button.disabled = false;
      });
    }
  }
}

async function refundAdminOrder(order, page, statusFilter) {
  if (!order) return;
  const account = activeMerchant.account;
  const key = `${account}:${order.no}`;
  if (refundSubmitting.has(key) || orderMutationSubmitting.has(key)) return;
  refundSubmitting.add(key);
  let reason = order.refund?.reason || "";
  if (["paid", "refund_closed"].includes(order.paymentStatus)) {
    reason = await adminPrompt({
      title: "确认订单退款", message: `将按原支付方式退还 ${money(order.price)}；此操作不能撤销。`,
      target: order.no, placeholder: "填写无法完成订单的原因", confirmText: "确认退款",
    });
    if (reason === null) { refundSubmitting.delete(key); return; }
    if (!reason || new TextEncoder().encode(reason).length > 80) {
      refundSubmitting.delete(key);
      return adminToast("退款原因需在 80 字节以内", "请填写具体原因", "error");
    }
  }
  if (activeMerchant.account !== account || currentPage !== page) { refundSubmitting.delete(key); return; }
  document.querySelectorAll('[data-refund-order]').forEach((button) => { if (button.dataset.refundOrder === order.no) button.disabled = true; });
  let message = "退款结果未确认，请刷新核对";
  let failed = true;
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(account)}/${encodeURIComponent(order.no)}/refund`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "退款申请失败");
    if (!["refunded", "refund_pending", "refund_closed"].includes(result.order?.paymentStatus)) throw new Error("服务端未确认退款状态，请刷新核对");
    message = result.order.paymentStatus === "refunded" ? "退款成功" : result.order.status === "退款异常" ? "退款异常，请到微信商户平台处理" : "退款处理中，请稍后核对";
    failed = false;
  } catch (error) { message = error.message || message; }
  finally { refundSubmitting.delete(key); }
  if (activeMerchant.account === account && currentPage === page) {
    await refreshOrderModule(page, statusFilter);
    adminToast(failed ? "退款未确认" : message, failed ? message : "", failed ? "error" : "success");
  }
}

function openAdminOrder(order, page) {
  if (!order) return;
  const account = activeMerchant.account;
  document.querySelector('.order-review-backdrop')?.remove();
  const paid = ["paid", "refund_pending", "refund_closed", "refunded"].includes(order.paymentStatus);
  const income = order.paymentStatus === "paid" ? getOrderStaffIncome(order) : 0;
  const prizes = Array.isArray(order.lottery?.results) ? order.lottery.results : [];
  const paymentStatus = { pending: "待付款", paid: "已付款", refund_pending: "退款中", refund_closed: "退款异常", refunded: "已退款", cancelled: "已取消" }[order.paymentStatus] || order.paymentStatus;
  const field = (label, value) => `<div class="admin-order-detail-field"><span>${label}</span><strong>${escapeHtml(String(value ?? "")) || "—"}</strong></div>`;
  const section = (title, fields) => `<section class="admin-order-detail-section"><h4>${title}</h4><div class="admin-order-detail-grid">${fields.map(([label, value]) => field(label, value)).join("")}</div></section>`;
  const proofUrl = /^\/api\/order-evidence\//.test(String(order.completionProof?.url || "")) ? order.completionProof.url : "";
  const backdrop = document.createElement('div');
  backdrop.className = 'wallet-credit-backdrop order-review-backdrop';
  backdrop.innerHTML = `<section class="admin-dialog admin-detail-page admin-order-detail-page" role="dialog" aria-modal="true" aria-labelledby="adminOrderDetailTitle">
    <header><h3 id="adminOrderDetailTitle">订单详情</h3><button type="button" data-close aria-label="关闭">×</button></header>
    <div class="admin-detail-scroll">
      ${section("订单信息", [["ID", order.dbId], ["订单号", order.no], ["订单状态", order.status], ["下单时间", order.time], ["接单时间", orderListTime(order.acceptedAt)], ["完成时间", orderListTime(order.completedAt)]])}
      ${section("商品与游戏", [["商品标题", order.product], ["类型", order.receiveMode], ["游戏类型", order.gameType], ["游戏区服", order.server], ["游戏昵称", order.gameName], ["ID 号码", order.gameId], ["数量", order.quantity || 1], ["订单备注", order.remark]])}
      ${order.productImage ? `<div class="admin-order-detail-media"><span>商品封面</span>${orderListImage(order.productImage)}</div>` : ""}
      ${prizes.length ? `<div class="admin-order-detail-media"><span>奖品</span>${prizes.map((prize) => `<div>${escapeHtml(prize.name || "—")}${orderListImage(prize.imageUrl)}</div>`).join("")}</div>` : ""}
      ${section("金额与支付", [["金额", money(order.price)], ["支付金额", money(paid ? order.price : 0)], ["打手到手价", money(income)], ["利润", money(order.paymentStatus === "paid" ? Math.max(0, Number(order.price || 0) - income) : 0)], ["支付状态", paymentStatus], ["支付方式", order.channel || order.paymentMethod], ["支付时间", orderListTime(order.paidAt)]])}
      ${section("用户与打手", [["用户昵称", order.user], ["用户手机号", order.userPhone], ["用户 ID", order.customerId], ["打手姓名", order.staff], ["打手手机号", order.staffPhone], ["打手 ID", order.staffId], ["队友", order.teammate]])}
      ${order.userConfirmedAt || order.customerConfirmedAt ? section("用户确认", [["确认时间", orderListTime(order.userConfirmedAt || order.customerConfirmedAt)]]) : ""}
      ${order.refund ? section("退款信息", [["退款状态", order.refund.status || order.paymentStatus], ["退款原因", order.refund.reason]]) : ""}
      ${order.complaint ? section("订单投诉", [["处理状态", order.complaint.status === "resolved" ? "已处理" : "待处理"], ["投诉内容", order.complaint.content]]) : ""}
      ${proofUrl ? `<div class="admin-order-detail-media"><span>完成凭证</span><a href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener"><img class="order-proof-preview" src="${escapeHtml(proofUrl)}" alt="结单截图"></a></div>` : ""}
      <p class="order-finish-feedback" role="status"></p>
    </div>
    <footer><button type="button" data-close>关闭</button>${order.complaint?.status === "pending" ? '<button type="button" class="primary" data-resolve-complaint>标记投诉已处理</button>' : ''}${order.status === "待结单" && proofUrl ? '<button type="button" class="primary" data-finish>确认结单</button>' : ''}</footer>
  </section>`;
  document.body.appendChild(backdrop);
  document.body.classList.add("admin-detail-open");
  const close = () => { backdrop.remove(); document.body.classList.remove("admin-detail-open"); };
  backdrop.querySelectorAll('[data-close]').forEach((button) => button.onclick = close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  const resolveComplaint = backdrop.querySelector('[data-resolve-complaint]');
  if (resolveComplaint) resolveComplaint.onclick = async () => {
    resolveComplaint.disabled = true;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(account)}/${encodeURIComponent(order.no)}/complaint/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || '处理投诉失败');
      if (result.order?.complaint?.status !== 'resolved') throw new Error('服务端未确认投诉已处理');
      if (activeMerchant.account !== account || currentPage !== page) { close(); return; }
      localStorage.setItem(orderKey(account), JSON.stringify(getMerchantOrders(account).map((item) => item.no === order.no ? result.order : item)));
      close();
      renderOrderModule(page);
      adminToast('投诉已处理');
    } catch (error) { backdrop.querySelector('.order-finish-feedback').textContent = error.message; resolveComplaint.disabled = false; }
  };
  const finish = backdrop.querySelector('[data-finish]');
  if (finish) finish.onclick = async () => {
    finish.disabled = true;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(account)}/${encodeURIComponent(order.no)}/finish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || '结单失败');
      close();
      if (activeMerchant.account === account && currentPage === page) {
        await refreshOrderModule(page);
        adminToast('结单完成');
      }
    } catch (error) { backdrop.querySelector('.order-finish-feedback').textContent = error.message; finish.disabled = false; }
  };
}

const walletTransactionLabels = {
  merchant_credit: "后台增加余额",
  customer_recharge: "客户充值",
  order_payment: "订单余额支付",
  order_refund: "订单退款",
};

function walletTransactionLabel(type) {
  return walletTransactionLabels[type] || (type ? String(type) : "余额变动");
}

function walletLedgerTime(value) {
  const timestamp = Number(value || 0);
  return timestamp ? formatDateTime(new Date(timestamp)) : "-";
}

async function loadWalletLedger() {
  const response = await fetch(`/api/wallets/${encodeURIComponent(activeMerchant.account)}/transactions`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "余额流水读取失败");
  return {
    transactions: Array.isArray(result.transactions) ? result.transactions : [],
    wallets: Array.isArray(result.wallets) ? result.wallets : [],
  };
}

// User identifiers are numeric everywhere: the 9-digit ID is the only handle the merchant
// and the customer both see. Legacy rows with no matching customer fall back to a neutral
// label instead of leaking an internal key (wxo_<hex> / dev_<hex>) into the console.
function numericUserId(value) {
  const id = String(value || "").trim();
  return /^\d{6,12}$/.test(id) ? id : "";
}

function userIdLabel(value) {
  const numeric = numericUserId(value);
  return numeric ? `数字 ID：${numeric}` : "未绑定数字 ID";
}

// Fold the ledger into one row per balance account so the page can answer both halves of
// "each user's balance change and remaining balance" without a second request per user.
function buildWalletLedgerOwners(transactions, wallets) {
  const owners = new Map();
  const userIds = new Map([...transactions, ...wallets].filter((item) => item.userId).map((item) => [item.ownerId, String(item.userId)]));
  const ensure = (ownerType, ownerId, displayName) => {
    const key = `${ownerType}:${ownerId}`;
    if (!owners.has(key)) {
      owners.set(key, {
        key, ownerType, ownerId, userId: userIds.get(ownerId) || "",
        displayName: String(displayName || ""),
        income: 0, expense: 0, count: 0, lastAt: 0, lastBalance: 0,
        balance: 0, balanceKnown: false,
      });
    }
    const owner = owners.get(key);
    if (displayName) owner.displayName = String(displayName);
    return owner;
  };
  // Live wallet rows win: they carry the authoritative remaining balance and current name.
  wallets.forEach((wallet) => {
    const owner = ensure(wallet.ownerType, wallet.ownerId, wallet.displayName);
    owner.balance = Number(wallet.balance || 0);
    owner.balanceKnown = true;
    owner.updatedAt = Number(wallet.updatedAt || 0);
  });
  // Transactions arrive newest-first, so the first hit per owner is their latest change.
  transactions.forEach((tx) => {
    const owner = ensure(tx.ownerType, tx.ownerId, tx.displayName);
    const amount = Number(tx.amount || 0);
    if (amount >= 0) owner.income = Math.round((owner.income + amount) * 100) / 100;
    else owner.expense = Math.round((owner.expense + Math.abs(amount)) * 100) / 100;
    owner.count += 1;
    if (!owner.lastAt) {
      owner.lastAt = Number(tx.createdAt || 0);
      owner.lastBalance = Number(tx.balanceAfter || 0);
    }
  });
  owners.forEach((owner) => {
    if (!owner.balanceKnown) owner.balance = Number(owner.lastBalance || 0);
    if (!owner.lastAt) owner.lastAt = Number(owner.updatedAt || 0);
  });
  return Array.from(owners.values()).sort((a, b) => b.balance - a.balance || b.lastAt - a.lastAt);
}

async function renderWalletLedger(page) {
  $("pageContent").innerHTML = `<section class="panel wallet-loading"><h2>${page}</h2><p>正在同步余额流水...</p></section>`;
  let data;
  try {
    data = await loadWalletLedger();
  } catch (error) {
    if (currentPage === page) {
      $("pageContent").innerHTML = `<section class="panel"><h2>${page}</h2><p class="wallet-error">${escapeHtml(error.message)}</p></section>`;
    }
    return;
  }
  if (currentPage !== page) return;

  // 余额系统只有「客户」一种身份：历史遗留的打手钱包不再出现在这个页面，
  // 后台加的钱也只进客户钱包（服务端 creditWallet 已收口到 owner_type='customer'）。
  const owners = buildWalletLedgerOwners(data.transactions, data.wallets).filter((owner) => owner.ownerType === "customer");
  const transactions = data.transactions.filter((tx) => tx.ownerType === "customer");
  const sumBalances = () => owners.reduce((sum, owner) => sum + owner.balance, 0);

  const ownerRows = owners.length ? owners.map((owner) => `<tr
      data-wallet-ledger-owner
      data-owner-key="${escapeHtml(owner.key)}"
      data-search="${escapeHtml([owner.userId, owner.ownerId].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN"))}">
      <td>${escapeHtml(owner.displayName || "未命名")}<br><small>${escapeHtml(userIdLabel(owner.userId))}</small></td>
      <td class="wallet-ledger-income">${owner.income ? `+${money(owner.income)}` : "-"}</td>
      <td class="wallet-ledger-expense">${owner.expense ? `-${money(owner.expense)}` : "-"}</td>
      <td><strong class="wallet-balance">${money(owner.balance)}</strong></td>
      <td>${owner.lastAt ? walletLedgerTime(owner.lastAt) : "-"}</td>
      <td><div class="wallet-ledger-actions"><button type="button" class="wallet-ledger-credit" data-wallet-credit data-wallet-type="${escapeHtml(owner.ownerType)}" data-wallet-owner="${escapeHtml(owner.ownerId)}" data-wallet-name="${escapeHtml(owner.displayName || owner.ownerId)}" data-wallet-user-id="${escapeHtml(owner.userId || "")}" data-wallet-balance="${owner.balance}">增加余额</button><button type="button" class="wallet-ledger-link" data-wallet-ledger-filter="${escapeHtml(owner.key)}">只看明细</button></div></td>
    </tr>`).join("") : `<tr><td colspan="6">这个商户还没有客户余额账户。用右上角「+ 帮用户加余额」，或客户在小程序充值 / 下单后，账户会自动出现在这里。</td></tr>`;

  const txRows = transactions.length ? transactions.map((tx) => {
    const amount = Number(tx.amount || 0);
    const positive = amount >= 0;
    return `<tr
      data-wallet-ledger-tx
      data-owner-key="${escapeHtml(`${tx.ownerType}:${tx.ownerId}`)}"
      data-search="${escapeHtml([tx.userId, tx.ownerId].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN"))}">
      <td>${walletLedgerTime(tx.createdAt)}</td>
      <td>${escapeHtml(tx.displayName || tx.ownerId || "未命名")}<br><small>${escapeHtml(userIdLabel(tx.userId))}</small></td>
      <td class="wallet-ledger-amount ${positive ? "is-income" : "is-expense"}">${positive ? "+" : "-"}${money(Math.abs(amount))}</td>
      <td>${money(tx.balanceAfter)}</td>
      <td>${escapeHtml(walletTransactionLabel(tx.transactionType))}</td>
      <td>${escapeHtml(tx.note || "-")}</td>
      <td>${escapeHtml(tx.operatorAccount || "-")}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7">还没有余额变动记录。后台增加余额、客户充值或用余额支付订单后都会写入流水。</td></tr>`;

  $("pageContent").innerHTML = `<section class="panel wallet-ledger">
    <div class="panel-head"><h2>${page}</h2><div class="button-row admin-toolbar-actions">
      <button type="button" class="admin-add-button" id="walletLedgerAdd">+ 帮用户加余额</button>
      <button type="button" class="admin-icon-reset" id="walletLedgerReset" aria-label="刷新余额流水" title="刷新余额流水">↻</button>
    </div></div>
    <p class="wallet-credit-hint">余额只有「客户」一种身份：后台加的钱直接进客户钱包，客户在小程序里立刻能看到，并能用来下单付款。每笔变动都会写入流水，含操作人、变动金额与变动后余额。</p>
    <div class="stats-grid wallet-ledger-stats">
      <div class="stat-card"><span>客户剩余余额合计</span><strong>${money(sumBalances())}</strong></div>
      <div class="stat-card"><span>余额账户数</span><strong>${owners.length}</strong></div>
      <div class="stat-card"><span>余额变动笔数</span><strong>${transactions.length}</strong></div>
    </div>

    <h3 class="wallet-ledger-subtitle" id="walletLedgerOwnerTitle">查看客户余额变化</h3>
    <div class="wallet-list-toolbar">
      <label><span id="walletLedgerOwnerSearchLabel">搜索客户 ID</span><input id="walletLedgerSearch" type="search" placeholder="输入客户 ID" autocomplete="off" /></label>
      <span id="walletLedgerOwnerCount">共 ${owners.length} 个余额账户</span>
    </div>
    <table class="wallet-table wallet-ledger-table"><thead><tr><th>客户</th><th>累计增加</th><th>累计减少</th><th>剩余余额</th><th>最近变动</th><th>操作</th></tr></thead><tbody>
      ${ownerRows}
      <tr id="walletLedgerOwnerEmpty" class="wallet-search-empty" hidden><td colspan="6">没有找到匹配的余额账户</td></tr>
    </tbody></table>

    <h3 class="wallet-ledger-subtitle" id="walletLedgerDetailsTitle">余额变化明细</h3>
    <div class="wallet-list-toolbar">
      <label><span>搜索客户 ID</span><input id="walletLedgerTxSearch" type="search" placeholder="输入客户 ID" autocomplete="off" /></label>
      <span id="walletLedgerTxCount">共 ${transactions.length} 笔变动</span>
    </div>
    <table class="wallet-table wallet-ledger-table" id="walletLedgerDetailsTable"><thead><tr><th>时间</th><th>客户</th><th>余额变化</th><th>变动后余额</th><th>类型</th><th>说明</th><th>操作人</th></tr></thead><tbody>
      ${txRows}
      <tr id="walletLedgerTxEmpty" class="wallet-search-empty" hidden><td colspan="7">没有找到匹配的余额变动</td></tr>
    </tbody></table>
  </section>`;

  const ownerSearch = $("walletLedgerSearch");
  const txSearch = $("walletLedgerTxSearch");
  let ownerFilter = "";
  let detailAnimation = null;

  const applyFilter = () => {
    const ownerKeyword = String(ownerSearch?.value || "").trim().toLocaleLowerCase("zh-CN");
    const txKeyword = String(txSearch?.value || "").trim().toLocaleLowerCase("zh-CN");
    let visibleOwners = 0;
    let visibleTx = 0;
    document.querySelectorAll("[data-wallet-ledger-owner]").forEach((row) => {
      const visible = (!ownerFilter || row.dataset.ownerKey === ownerFilter)
        && (!ownerKeyword || row.dataset.search.includes(ownerKeyword));
      row.hidden = !visible;
      if (visible) visibleOwners += 1;
    });
    document.querySelectorAll("[data-wallet-ledger-tx]").forEach((row) => {
      const visible = (!ownerFilter || row.dataset.ownerKey === ownerFilter)
        && (!txKeyword || row.dataset.search.includes(txKeyword));
      row.hidden = !visible;
      if (visible) visibleTx += 1;
    });
    if ($("walletLedgerOwnerEmpty")) $("walletLedgerOwnerEmpty").hidden = visibleOwners > 0;
    if ($("walletLedgerTxEmpty")) $("walletLedgerTxEmpty").hidden = visibleTx > 0;
    if ($("walletLedgerOwnerCount")) $("walletLedgerOwnerCount").textContent = `共 ${visibleOwners} 个余额账户`;
    if ($("walletLedgerTxCount")) $("walletLedgerTxCount").textContent = `共 ${visibleTx} 笔变动`;
    document.querySelectorAll("[data-wallet-ledger-filter]").forEach((button) => {
      button.textContent = button.dataset.walletLedgerFilter === ownerFilter ? "查看全部" : "只看明细";
    });
  };

  ownerSearch?.addEventListener("input", applyFilter);
  txSearch?.addEventListener("input", applyFilter);
  document.querySelectorAll("[data-wallet-ledger-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.walletLedgerFilter;
      ownerFilter = ownerFilter === key ? "" : key;
      applyFilter();
      detailAnimation?.cancel();
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      $("walletLedgerDetailsTitle")?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "nearest" });
      detailAnimation = !reducedMotion ? $("walletLedgerDetailsTable")?.animate?.([
        { opacity: 0.35, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 280, easing: "ease-out" }) : null;
    });
  });
  $("walletLedgerReset")?.addEventListener("click", () => renderWalletLedger(page));
  $("walletLedgerAdd")?.addEventListener("click", () => openWalletLedgerAddDialog(owners, page));
  bindWalletCreditButtons(() => renderWalletLedger(page));
  applyFilter();
}

async function loadWalletAccounts(ownerType) {
  const response = await fetch(`/api/wallets/${encodeURIComponent(activeMerchant.account)}?ownerType=${encodeURIComponent(ownerType)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "余额读取失败");
  return Array.isArray(result.wallets) ? result.wallets : [];
}

async function loadStaffGrants() {
  const response = await fetch(`/api/staff-grants/${encodeURIComponent(activeMerchant.account)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "打手授权读取失败");
  return Array.isArray(result.grants) ? result.grants : [];
}

// 「排行榜」要的是每个打手「接了多少单 / 接单成交额」——由服务端聚合好再给
// （见 server.js 的 staffOrderStats），后台这边只做展示，不再自己遍历订单。
async function loadStaffOrderStats() {
  const response = await fetch(`/api/staff-order-stats/${encodeURIComponent(activeMerchant.account)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "接单流水读取失败");
  const stats = new Map();
  for (const item of Array.isArray(result.stats) ? result.stats : []) {
    stats.set(String(item.staff_key || ""), {
      orderCount: Number(item.order_count || 0),
      orderAmount: Number(item.order_amount || 0),
    });
  }
  return stats;
}

async function updateStaffGrant(numericId, action) {
  const response = await fetch(`/api/staff-grants/${encodeURIComponent(activeMerchant.account)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ numericId, action }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "打手授权保存失败");
  return result;
}

/* ---- 订单评价审核 ---------------------------------------------------------
 * 客户在小程序里只能评价「自己下过的订单」，提交后是「待审核」。
 * 只有在这里点「通过」的评价才会出现在店铺前台和详情图飘屏里；「驳回」写原因、不上前台，
 * 客户改完可以重新提交（回到待审核）。待审核/已驳回的评价绝不会被下发到前台。
 * 入口只有一个：左侧「订单管理 → 订单评价」。（2026-09-17 曾一度改名挪到
 * 「消息中心 → 投诉消息」，当天用户又要求改回「订单评价」并归到「订单管理」，
 * 所以「投诉消息」这个页面整个撤掉了 —— 别再把它加回来，那就成了第二个入口。）
 * ------------------------------------------------------------------------ */
async function loadReviews() {
  const response = await fetch(`/api/reviews/${encodeURIComponent(activeMerchant.account)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "评价读取失败");
  return Array.isArray(result.reviews) ? result.reviews : [];
}

async function decideReview(id, action, reason) {
  const response = await fetch(`/api/reviews/${encodeURIComponent(activeMerchant.account)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, action, reason: reason || "" }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.message || "评价审核失败");
    error.status = response.status;
    throw error;
  }
  return result;
}

const reviewStatusLabels = { pending: "待审核", approved: "已通过", rejected: "已驳回" };
let reviewStatusFilter = "pending";
const reviewDecisionsInFlight = new Set();

function formatReviewTime(value) {
  const time = Number(value || 0);
  if (!time) return "-";
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function reviewRowsHtml(reviews) {
  if (!reviews.length) {
    return `<tr><td colspan="6" class="review-empty">当前分类暂无评价。</td></tr>`;
  }
  return reviews.map((item) => {
    const stars = "★".repeat(Math.min(5, Math.max(1, Number(item.rating || 5))));
    return `<tr data-review-row="${escapeHtml(item.id)}">
      <td><strong>${escapeHtml(item.displayName || "用户")}</strong><br /><code>${escapeHtml(item.numericId || "-")}</code></td>
      <td>${escapeHtml(item.productTitle || item.productId || "-")}<br /><span class="review-order-no">${escapeHtml(item.orderNo)}</span></td>
      <td class="review-stars">${stars}</td>
      <td class="review-content">${escapeHtml(item.content || "")}</td>
      <td><span class="review-state is-${escapeHtml(item.status)}">${reviewStatusLabels[item.status] || escapeHtml(item.status)}</span>${item.rejectReason ? `<br /><small class="review-reason">${escapeHtml(item.rejectReason)}</small>` : ""}<br /><span class="review-time">${formatReviewTime(item.createdAt)}</span></td>
      <td class="review-actions">${item.status === "pending" ? `<button type="button" data-review-approve="${escapeHtml(item.id)}">通过</button><button type="button" class="review-reject-button" data-review-reject="${escapeHtml(item.id)}">驳回</button>` : `<span class="hint">已处理</span>`}</td>
    </tr>`;
  }).join("");
}

/* ---- 提现审核 -------------------------------------------------------------
 * 打手/用户在小程序提交提现后都汇总到这里。
 *   通过 = 商户已经按收款信息线下打款，一次性把「管事那份抽成」记到管事账上；
 *   驳回 = 整笔原路退回本人（打手退回可用佣金 / 用户退回消费余额），平台不抽一分钱。
 * ⚠️ 一张单只能审一次：服务端用行锁 + status 校验挡重复审核，前端这里同时禁用按钮。
 * ⚠️ 打款是线下的：系统只记账、不动真钱，所以「通过」必须有明确的一次确认框。
 */
let withdrawStatusFilter = "pending";
const withdrawReviewInFlight = new Set();
const withdrawStatusLabels = { pending: "审核中", approved: "已通过", rejected: "已驳回" };

async function loadWithdrawOrders() {
  const response = await fetch(`/api/withdraw-orders/${encodeURIComponent(activeMerchant.account)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "提现单读取失败");
  return Array.isArray(result.orders) ? result.orders : [];
}

async function decideWithdraw(orderNo, decision, reason) {
  const response = await fetch(`/api/withdraw-orders/${encodeURIComponent(activeMerchant.account)}/${encodeURIComponent(orderNo)}/review`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, reason: reason || "" }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const error = new Error(result.message || "提现审核失败");
    error.status = response.status;
    throw error;
  }
  return result;
}

function withdrawRowsHtml(orders) {
  if (!orders.length) return `<tr><td colspan="6" class="review-empty">当前分类暂无提现单。</td></tr>`;
  return orders.map((item) => {
    const pending = item.status === "pending";
    const feeText = Number(item.fee || 0) > 0 ? `<br /><small class="hint">手续费 ${money(item.fee)} · 管事 ${money(item.stewardCents / 100)} / 商户 ${money(item.merchantCents / 100)}</small>` : "";
    const bankText = item.channel === "bank" && item.bankName ? `<br /><small class="hint">${escapeHtml(item.bankName)}</small>` : "";
    return `<tr data-withdraw-row="${escapeHtml(item.orderNo)}">
      <td>${escapeHtml(item.orderNo)}<br /><span class="review-time">${formatReviewTime(item.createdAt)}</span></td>
      <td><strong>${escapeHtml(item.staffName || "未知用户")}</strong> <span class="tag">${item.identity === "user" ? "用户" : "打手"}</span><br /><code>${escapeHtml(item.staffNumeric || "-")}</code></td>
      <td>${escapeHtml(item.channelText)}<br />${escapeHtml(item.name)}<br /><code>${escapeHtml(item.account)}</code>${bankText}</td>
      <td>提现 ${money(item.money)}${feeText}<br />到账 <strong>${money(item.actualMoney)}</strong></td>
      <td><span class="review-state is-${escapeHtml(item.status)}">${withdrawStatusLabels[item.status] || escapeHtml(item.statusText || item.status)}</span>${item.rejectReason ? `<br /><small class="review-reason">${escapeHtml(item.rejectReason)}</small>` : ""}${item.reviewedAt ? `<br /><span class="review-time">${formatReviewTime(item.reviewedAt)}</span>` : ""}</td>
      <td class="review-actions">${pending ? `<button type="button" data-withdraw-approve="${escapeHtml(item.orderNo)}">通过</button><button type="button" class="review-reject-button" data-withdraw-reject="${escapeHtml(item.orderNo)}">驳回</button>` : `<span class="hint">已处理</span>`}</td>
    </tr>`;
  }).join("");
}

async function renderWithdrawAudit() {
  const account = activeMerchant.account;
  $("pageContent").innerHTML = `<section class="panel review-audit-panel">
    <div class="panel-head"><h2>提现审核</h2><div class="button-row admin-toolbar-actions"><button type="button" class="admin-icon-reset" id="withdrawResetBtn" aria-label="刷新提现单列表" title="刷新提现单列表">↻</button></div></div>
    <p class="wallet-credit-hint">打手/用户在小程序里提交的提现都汇总到这里。点「通过」＝你已经按上面的收款信息线下打款（管事那份抽成同时记入管事账）；点「驳回」会把整笔原路退回对方的可用佣金／余额，不用再手工补钱，但要先写清驳回原因。</p>
    <div id="withdrawAuditBody">正在读取提现单...</div>
  </section>`;
  $("withdrawResetBtn")?.addEventListener("click", () => renderWithdrawAudit());
  const body = $("withdrawAuditBody");

  let orders;
  try {
    orders = await loadWithdrawOrders();
  } catch (error) {
    if ($("withdrawAuditBody") === body && activeMerchant?.account === account) {
      body.innerHTML = `<p class="review-empty">${escapeHtml(error?.message || "提现单读取失败")}</p>`;
    }
    return;
  }
  if ($("withdrawAuditBody") !== body || activeMerchant?.account !== account) return;
  renderWithdrawAuditBody(body, orders);
}

function renderWithdrawAuditBody(body, orders) {
  const filtered = withdrawStatusFilter === "all" ? orders : orders.filter((item) => item.status === withdrawStatusFilter);
  body.innerHTML = `<div class="review-summary">
      <label>查看 <select id="withdrawStatusFilter">${Object.entries({ ...withdrawStatusLabels, all: "全部" }).map(([value, label]) => `<option value="${value}"${withdrawStatusFilter === value ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <span class="tag">审核中 ${orders.filter((item) => item.status === "pending").length}</span>
      <span class="tag">已通过 ${orders.filter((item) => item.status === "approved").length}</span>
      <span class="tag">已驳回 ${orders.filter((item) => item.status === "rejected").length}</span>
    </div>
    <table class="wallet-table review-audit-table"><thead><tr><th>提现单</th><th>申请人</th><th>收款信息</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>${withdrawRowsHtml(filtered)}</tbody></table>`;
  $("withdrawStatusFilter").addEventListener("change", (event) => {
    withdrawStatusFilter = event.target.value;
    renderWithdrawAuditBody(body, orders);
  });
  animateListEnter("[data-withdraw-row]");
  bindWithdrawAudit(orders);
}

function bindWithdrawAudit(orders) {
  document.querySelectorAll("[data-withdraw-row]").forEach((row) => {
    if (!withdrawReviewInFlight.has(`${activeMerchant.account}:${row.dataset.withdrawRow}`)) return;
    row.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  });
  document.querySelectorAll("[data-withdraw-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((item) => item.orderNo === button.dataset.withdrawApprove);
      if (!order || order.status !== "pending" || button.disabled) return;
      const confirmed = await adminConfirm({
        title: "确认已经打款",
        message: "点确认只代表系统记账：商户要自己按上面的收款信息把钱转给对方。确认后这张单不能再改。",
        target: `${order.channelText} · ${order.name} · ${order.account} · 到账 ${money(order.actualMoney)}`,
        confirmText: "已打款，通过",
      });
      if (!confirmed) return;
      await submitWithdrawDecision(button, order.orderNo, "approve", "", orders);
    });
  });
  document.querySelectorAll("[data-withdraw-reject]").forEach((button) => {
    button.addEventListener("click", async () => {
      const order = orders.find((item) => item.orderNo === button.dataset.withdrawReject);
      if (!order || order.status !== "pending" || button.disabled) return;
      const reason = await adminPrompt({
        title: "驳回这张提现单",
        message: "驳回后整笔退回对方的可用佣金／余额（不抽手续费），原因会给对方看到。",
        target: `${order.staffName || "申请人"} · 提现 ${money(order.money)}`,
        placeholder: "例如：收款账号与姓名不一致，请核对后重新提交",
        confirmText: "确认驳回",
      });
      if (reason === null) return;
      await submitWithdrawDecision(button, order.orderNo, "reject", reason, orders);
    });
  });
}

async function submitWithdrawDecision(button, orderNo, decision, reason, orders) {
  if (button.disabled || !button.isConnected) return;
  const account = activeMerchant.account;
  const requestKey = `${account}:${orderNo}`;
  if (withdrawReviewInFlight.has(requestKey)) return;
  withdrawReviewInFlight.add(requestKey);
  const body = $("withdrawAuditBody");
  const rowButtons = [...button.closest("[data-withdraw-row]").querySelectorAll("button")];
  rowButtons.forEach((item) => { item.disabled = true; });
  button.textContent = decision === "approve" ? "通过中…" : "驳回中…";
  try {
    const result = await decideWithdraw(orderNo, decision, reason);
    // 服务端返回的状态必须和这次点的动作对得上，否则说明列表已经过期（别人审过 / 只审了一次那种）。
    const expected = decision === "approve" ? "approved" : "rejected";
    if (String(result.order?.orderNo) !== String(orderNo) || result.order?.status !== expected) {
      throw new Error("未收到已更新的提现单状态，请刷新列表确认");
    }
    if (activeMerchant?.account !== account) return;
    const order = orders.find((item) => item.orderNo === orderNo);
    if (order) Object.assign(order, result.order);
    adminToast(decision === "approve" ? "已通过" : "已驳回", decision === "approve" ? `${orderNo} 已记账，管事抽成同步入账` : `${orderNo} 已整笔退回`);
    if ($("withdrawAuditBody") === body && currentPage === "提现审核") renderWithdrawAuditBody(body, orders);
    else if (currentPage === "提现审核") await renderWithdrawAudit();
  } catch (error) {
    // 409 说明这张单在别处已经审过了：提示后刷新，别让商户以为点失败了又去手工补钱。
    adminToast("审核失败", error.message || "请刷新列表确认这张单的状态", "error");
    if (currentPage === "提现审核") await renderWithdrawAudit();
  } finally {
    withdrawReviewInFlight.delete(requestKey);
  }
}

/* ---- 保证金（2026-09-18 接通，只读）-----------------------------------------
 * 保证金是打手在小程序「我的资金 → 保证金」里自己充的，记在**第三本账**
 * （`wallet_accounts` 里 `owner_type='staff_bond'`）—— 跟可用佣金（`staff`）、
 * 冻结佣金完全分开。罚单从可用佣金扣、提现也只动可用佣金，都碰不到保证金。
 * ⚠️ 所以这个页面**只有读**：服务端只给了 GET /api/bonds/:account，
 *    没有加/减接口。想加"扣保证金"按钮之前先读 AGENTS.md §18.4 —— 本项目没有扣减路径。
 * 入口：左侧「功能 → 保证金」。
 * -------------------------------------------------------------------------- */
async function loadStaffBonds() {
  const response = await fetch(`/api/bonds/${encodeURIComponent(activeMerchant.account)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "保证金读取失败");
  return Array.isArray(result.bonds) ? result.bonds : [];
}

async function renderBondModule() {
  const account = activeMerchant.account;
  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head"><h2>保证金</h2><div class="button-row admin-toolbar-actions"><button type="button" class="admin-icon-reset" id="bondResetBtn" aria-label="刷新保证金列表" title="刷新保证金列表">↻</button></div></div>
    <p class="wallet-credit-hint">保证金由打手自己在小程序「我的资金」里充值。这里<b>只读</b>：罚款是从打手的「可用佣金」扣的，提现也只动可用佣金，都不会碰保证金 —— 本项目没有扣减保证金的入口。</p>
    <div id="bondModuleBody">正在读取保证金...</div>
  </section>`;
  $("bondResetBtn")?.addEventListener("click", () => renderBondModule());
  const body = $("bondModuleBody");

  let bonds;
  try {
    bonds = await loadStaffBonds();
  } catch (error) {
    if ($("bondModuleBody") === body && activeMerchant?.account === account) body.innerHTML = `<p class="wallet-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if ($("bondModuleBody") !== body || activeMerchant?.account !== account || currentPage !== "保证金") return;
  renderBondModuleBody(body, bonds);
}

function renderBondModuleBody(body, bonds) {
  if (!bonds.length) {
    body.innerHTML = `<p class="hint">还没有打手充过保证金。打手在小程序「我的资金 → 保证金」里充值后，这里会出现记录。</p>`;
    return;
  }
  const total = bonds.reduce((sum, item) => sum + Number(item.bond || 0), 0);
  body.innerHTML = `<div class="admin-order-table-wrap" role="region" aria-label="保证金列表，可横向滚动" tabindex="0"><table class="admin-order-table"><thead><tr>${["打手", "数字 ID", "当前保证金", "累计充值", "充值笔数", "最后充值时间", "最近变动时间"].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>
    ${bonds.map((item) => `<tr>
      <td>${escapeHtml(item.staff_name || "未设置昵称")}</td>
      <td>${escapeHtml(item.staff_numeric || "—")}</td>
      <td><strong>${money(item.bond)}</strong></td>
      <td>${money(item.recharge_total)}</td>
      <td>${item.recharge_count} 笔</td>
      <td>${escapeHtml(item.last_recharge_text || "—")}</td>
      <td>${escapeHtml(item.updated_text || "—")}</td>
    </tr>`).join("")}
    <tr><td colspan="2"><strong>合计 ${bonds.length} 名打手</strong></td><td><strong>${money(total)}</strong></td><td colspan="4"></td></tr>
  </tbody></table></div>`;
}

/* ---- 罚单（2026-09-18 接通）-------------------------------------------------
 * 商户在后台开罚单 / 撤销罚单；打手在小程序「我的罚单」里看到，并从**可用佣金**里缴纳。
 * 罚单状态是三态数字（照《资金指标开发提示词》）：0 待缴 / 1 已缴 / **>= 2 已撤销**。
 * ⚠️ 只有待缴能撤销：已缴的要退钱，那是另一条资金路径（本项目打手侧没有退款接口），
 *    服务端直接挡住了 —— 硬撤会让打手看到「已撤销」但钱已经扣走，账对不上。
 *    所以这里对已缴的罚单**不渲染撤销按钮**，不给他点了才报错的机会。
 * ⚠️ 罚单金额从打手的「可用佣金」扣，不是保证金 —— 三本账不能混（见 AGENTS.md 资金模块）。
 */
const FINE_FILTERS = [
  { status: -1, label: "全部" },
  { status: 0, label: "待缴" },
  { status: 1, label: "已缴" },
  { status: 2, label: "已撤销" }
];
let fineModuleFilter = -1;

function fineStatusText(status) {
  const value = Number(status);
  if (value === 0) return "待缴";
  if (value === 1) return "已缴";
  return "已撤销";
}

async function fetchFines(account, status) {
  const query = Number(status) >= 0 ? `?status=${encodeURIComponent(status)}` : "";
  const response = await fetch(`/api/fines/${encodeURIComponent(account)}${query}`, { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "罚单读取失败");
  return Array.isArray(result.fines) ? result.fines : [];
}

async function renderFineModule() {
  const account = activeMerchant.account;
  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head"><h2>罚单</h2><div class="button-row admin-toolbar-actions"><button type="button" id="fineCreateBtn">开罚单</button><button type="button" class="admin-icon-reset" id="fineResetBtn" aria-label="刷新罚单列表" title="刷新罚单列表">↻</button></div></div>
    <div class="admin-order-statuses">${FINE_FILTERS.map((item) => `<button class="${fineModuleFilter === item.status ? "active" : ""}" data-fine-filter="${item.status}">${item.label}</button>`).join("")}</div>
    <p class="wallet-credit-hint">罚单由商户开出，打手在小程序「我的罚单」里用**可用佣金**缴纳（不是保证金）。撤销只能撤没缴的：已缴的要先退钱，本项目打手侧没有退款接口，所以这里不给撤销按钮。</p>
    <div id="fineModuleBody">正在读取罚单...</div>
  </section>`;
  document.querySelectorAll("[data-fine-filter]").forEach((button) => button.addEventListener("click", () => {
    fineModuleFilter = Number(button.dataset.fineFilter);
    renderFineModule();
  }));
  $("fineResetBtn")?.addEventListener("click", () => renderFineModule());
  $("fineCreateBtn")?.addEventListener("click", () => openFineDialog({}));
  const body = $("fineModuleBody");

  let fines;
  try {
    fines = await fetchFines(account, fineModuleFilter);
  } catch (error) {
    if ($("fineModuleBody") === body && activeMerchant?.account === account) body.innerHTML = `<p class="wallet-error">${escapeHtml(error.message)}</p>`;
    return;
  }
  if ($("fineModuleBody") !== body || activeMerchant?.account !== account || currentPage !== "罚单") return;
  renderFineModuleBody(body, fines);
}

function renderFineModuleBody(body, fines) {
  if (!fines.length) {
    body.innerHTML = `<p class="hint">当前筛选下没有罚单。</p>`;
    return;
  }
  body.innerHTML = `<div class="admin-order-table-wrap" role="region" aria-label="罚单列表，可横向滚动" tabindex="0"><table class="admin-order-table"><thead><tr>${["罚单号", "打手", "数字 ID", "金额", "罚款理由", "处罚说明", "关联订单", "开单时间", "缴纳时间", "状态", "操作"].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>
    ${fines.map((fine) => {
      const status = Number(fine.status);
      // 只有待缴（0）才给撤销按钮 —— 已缴 / 已撤销都不给。
      const revoke = status === 0
        ? `<button type="button" class="admin-order-action admin-order-action--red" data-fine-revoke="${escapeHtml(fine.fine_no)}">撤销</button>`
        : "";
      return `<tr>
        <td>${escapeHtml(fine.fine_no)}</td>
        <td>${escapeHtml(fine.staff_name || "未知打手")}</td>
        <td>${escapeHtml(fine.staff_numeric || "—")}</td>
        <td>${money(fine.amount)}</td>
        <td>${escapeHtml(fine.reason || "罚款")}</td>
        <td>${escapeHtml(fine.punish_text || "—")}</td>
        <td>${escapeHtml(fine.order_no || "—")}</td>
        <td>${escapeHtml(fine.fine_time_text || "—")}</td>
        <td>${escapeHtml(fine.pay_time_text || "—")}</td>
        <td><span class="tag">${escapeHtml(fineStatusText(status))}</span></td>
        <td><div class="admin-order-actions">${revoke}</div></td>
      </tr>`;
    }).join("")}
  </tbody></table></div>`;
  body.querySelectorAll("[data-fine-revoke]").forEach((button) => button.addEventListener("click", () => revokeFine(button.dataset.fineRevoke, fines)));
}

async function revokeFine(fineNo, fines) {
  const fine = fines.find((item) => item.fine_no === fineNo);
  const reason = await adminPrompt({
    title: "撤销罚单",
    message: `撤销后这笔罚款不再计入待缴，打手侧会显示「已撤销」。`,
    target: `${fineNo}${fine ? ` · ${fine.staff_name || ""} · ${money(fine.amount)}` : ""}`,
    placeholder: "请填写撤销原因（选填）",
    confirmText: "确认撤销"
  });
  if (reason === null) return;
  try {
    const response = await fetch(`/api/fines/${encodeURIComponent(activeMerchant.account)}/${encodeURIComponent(fineNo)}/revoke`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const result = await response.json().catch(() => ({}));
    // ⚠️ 服务端失败时不能只包 try/catch —— 必须看 ok，否则会静默以为撤销成功了。
    if (!response.ok || !result.ok) throw new Error(result.message || "撤销失败");
    adminToast("已撤销", `${fineNo} 不再计入待缴罚款`);
    recordOperation("撤销罚单", `${fineNo}${reason ? `，原因：${reason}` : ""}`);
    if (currentPage === "罚单") await renderFineModule();
  } catch (error) {
    adminToast("撤销失败", error.message || "请刷新列表确认这张罚单的状态", "error");
  }
}

// 开罚单。options.order 有值时从订单行进来，打手和关联订单都预填好（订单必须有接单打手才给发）。
// options.onCreated(fine) 在开单成功后回调：订单页那边靠它把「发罚单」按钮置灰。
async function openFineDialog({ order, onCreated } = {}) {
  const account = activeMerchant.account;
  let grants = [];
  try {
    grants = await loadStaffGrants();
  } catch (error) {
    return adminToast("打手列表读取失败", error.message || "请稍后重试", "error");
  }
  const staffOptions = grants.map((staff) => {
    const who = `${staff.displayName}${staff.numericId ? ` · ID ${staff.numericId}` : ""}`;
    const label = escapeHtml(who);
    // 从订单行进来时把接单打手选中。
    const selected = order && String(order.staffId) === String(staff.customerId) ? " selected" : "";
    return `<option value="${escapeHtml(staff.customerId)}"${selected}>${label}</option>`;
  }).join("");
  if (!staffOptions) return adminToast("还没有打手", "先在「员工列表」里开通打手权限，再给他开罚单", "error");

  document.querySelector(".fine-dialog-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "wallet-credit-backdrop fine-dialog-backdrop";
  backdrop.innerHTML = `<section class="wallet-credit-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="fineDialogTitle">
    <header><div><h3 id="fineDialogTitle">开罚单</h3><p>罚款从打手的「可用佣金」里扣，不是保证金。</p></div><button type="button" data-close-fine aria-label="关闭">×</button></header>
    <label><span>打手</span><select id="fineStaff">${staffOptions}</select></label>
    <label><span>罚款金额</span><div class="wallet-amount-input"><b>¥</b><input id="fineAmount" type="number" min="0.01" max="100000" step="0.01" placeholder="请输入金额" /></div></label>
    <label><span>罚款理由</span><input id="fineReason" maxlength="200" placeholder="选填，打手端不填时显示「罚款」" /></label>
    <label><span>处罚说明</span><input id="finePunish" maxlength="200" placeholder="选填，会显示在打手的罚单详情里" /></label>
    <label><span>关联订单</span><input id="fineOrderNo" maxlength="64" value="${escapeHtml(order?.no || "")}" placeholder="选填" /></label>
    <p class="wallet-credit-hint">开单后打手会在小程序「我的罚单」里看到，并在那里缴纳。</p>
    <footer><button type="button" class="ghost" data-close-fine>取消</button><button type="button" id="confirmFine">确认开单</button></footer>
  </section>`;
  document.body.appendChild(backdrop);
  let submitting = false;
  const close = () => { if (!submitting) backdrop.remove(); };
  backdrop.querySelectorAll("[data-close-fine]").forEach((button) => button.addEventListener("click", close));
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  const amountInput = backdrop.querySelector("#fineAmount");
  amountInput.focus();
  backdrop.querySelector("#confirmFine").addEventListener("click", async (event) => {
    if (submitting) return;
    const amount = amountInput.value.trim();
    if (!/^(0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 100000) {
      return adminToast("金额格式不对", "请输入 0.01 ~ 100000 元，最多两位小数", "error");
    }
    const button = event.currentTarget;
    submitting = true;
    button.disabled = true;
    button.textContent = "提交中...";
    try {
      const response = await fetch(`/api/fines/${encodeURIComponent(account)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffKey: backdrop.querySelector("#fineStaff").value,
          amount,
          reason: backdrop.querySelector("#fineReason").value.trim(),
          punishText: backdrop.querySelector("#finePunish").value.trim(),
          orderNo: backdrop.querySelector("#fineOrderNo").value.trim()
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || "开罚单失败");
      submitting = false;
      close();
      adminToast("已开罚单", `${result.fine.fine_no} · ${result.fine.staff_name || ""} · ${money(result.fine.amount)}`, "success");
      recordOperation("开罚单", `${result.fine.fine_no} · ${result.fine.staff_name || ""} · ${money(result.fine.amount)}`);
      // 从订单行进来的：留在订单页，只把按钮置灰，别把商户弹走。
      if (currentPage === "罚单") await renderFineModule();
      else if (typeof onCreated === "function") onCreated(result.fine);
    } catch (error) {
      submitting = false;
      button.disabled = false;
      button.textContent = "重试确认";
      adminToast("开罚单失败", error.message || "请稍后重试", "error");
    }
  });
}

async function renderReviewAudit() {
  const account = activeMerchant.account;
  $("pageContent").innerHTML = `<section class="panel review-audit-panel">
    <div class="panel-head"><h2>订单评价审核</h2><div class="button-row admin-toolbar-actions"><button type="button" class="admin-icon-reset" id="reviewResetBtn" aria-label="刷新评价列表" title="刷新评价列表">↻</button></div></div>
    <p class="wallet-credit-hint">老板（客户）在小程序「我的 → 订单」里对下过的订单提交评价后，都汇总到这里审核。只有点「通过」的评价才会显示在店铺前台和商品详情图的飘屏里（飘屏内容为「客户昵称：评价内容」）；点「驳回」会记下原因且不上前台，客户改完可以重新提交。</p>
    <div id="reviewAuditBody">正在读取评价...</div>
  </section>`;
  $("reviewResetBtn")?.addEventListener("click", () => renderReviewAudit());
  const body = $("reviewAuditBody");

  let reviews;
  try {
    reviews = await loadReviews();
  } catch (error) {
    if ($("reviewAuditBody") === body && activeMerchant?.account === account) body.innerHTML = `<p class="review-empty">${escapeHtml(error?.message || "评价读取失败")}</p>`;
    return;
  }

  if ($("reviewAuditBody") !== body || activeMerchant?.account !== account) return;
  renderReviewAuditBody(body, reviews);
}

function renderReviewAuditBody(body, reviews) {
  const filtered = reviewStatusFilter === "all" ? reviews : reviews.filter((item) => item.status === reviewStatusFilter);
  body.innerHTML = `<div class="review-summary">
      <label>查看 <select id="reviewStatusFilter">${Object.entries({ ...reviewStatusLabels, all: "全部" }).map(([value, label]) => `<option value="${value}" ${reviewStatusFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <span class="tag">待审核 ${reviews.filter((item) => item.status === "pending").length}</span>
      <span class="tag">已通过 ${reviews.filter((item) => item.status === "approved").length}</span>
      <span class="tag">已驳回 ${reviews.filter((item) => item.status === "rejected").length}</span>
    </div>
    <table class="wallet-table review-audit-table"><thead><tr><th>客户</th><th>商品 / 订单</th><th>评分</th><th>评价内容</th><th>状态</th><th>操作</th></tr></thead><tbody>${reviewRowsHtml(filtered)}</tbody></table>`;
  $("reviewStatusFilter").addEventListener("change", (event) => {
    reviewStatusFilter = event.target.value;
    renderReviewAuditBody(body, reviews);
  });
  animateListEnter("[data-review-row]");
  bindReviewAudit(reviews);
}

function bindReviewAudit(reviews) {
  document.querySelectorAll("[data-review-row]").forEach((row) => {
    const busy = reviewDecisionsInFlight.has(`${activeMerchant.account}:${row.dataset.reviewRow}`);
    row.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
  });
  document.querySelectorAll("[data-review-approve]").forEach((button) => {
    button.addEventListener("click", async () => {
      const review = reviews.find((item) => String(item.id) === button.dataset.reviewApprove);
      if (!review || review.status !== "pending" || button.disabled) return;
      const confirmed = await adminConfirm({
        title: "通过这条评价",
        message: "通过后会立即显示在店铺前台和商品详情图的飘屏里。",
        target: `${review.displayName || "用户"}：${review.content || ""}`,
        confirmText: "确认通过",
      });
      if (!confirmed) return;
      await submitReviewDecision(button, review.id, "approve", "", reviews);
    });
  });
  document.querySelectorAll("[data-review-reject]").forEach((button) => {
    button.addEventListener("click", async () => {
      const review = reviews.find((item) => String(item.id) === button.dataset.reviewReject);
      if (!review || review.status !== "pending" || button.disabled) return;
      const reason = await adminPrompt({
        title: "驳回这条评价",
        message: "驳回后不会显示在前台，客户可以修改后重新提交。可以写一句原因告诉客户。",
        target: `${review.displayName || "用户"}：${review.content || ""}`,
        placeholder: "例如：请补充真实的体验描述",
        confirmText: "确认驳回",
      });
      if (reason === null) return;
      await submitReviewDecision(button, review.id, "reject", reason, reviews);
    });
  });
}

async function submitReviewDecision(button, id, action, reason, reviews) {
  if (button.disabled || !button.isConnected) return;
  const account = activeMerchant.account;
  const requestKey = `${account}:${id}`;
  if (reviewDecisionsInFlight.has(requestKey)) return;
  reviewDecisionsInFlight.add(requestKey);
  const body = $("reviewAuditBody");
  const buttons = [...button.closest("[data-review-row]").querySelectorAll("button")];
  const originalText = button.textContent;
  buttons.forEach((item) => { item.disabled = true; });
  button.textContent = action === "approve" ? "通过中…" : "驳回中…";
  try {
    const result = await decideReview(id, action, reason);
    const expectedStatus = action === "approve" ? "approved" : "rejected";
    if (String(result.review?.id) !== String(id) || result.review?.status !== expectedStatus) {
      throw new Error("未收到已更新的评价状态，请刷新列表确认");
    }
    if (activeMerchant?.account !== account) return;
    if ($("reviewAuditBody") !== body) {
      if (currentPage === "订单评价") await renderReviewAudit();
      return;
    }
    const review = reviews.find((item) => String(item.id) === String(id));
    Object.assign(review, result.review);
    renderReviewAuditBody(body, reviews);
    recordOperation(action === "approve" ? "通过评价" : "驳回评价", `评价 #${id}`);
    adminToast(action === "approve" ? "已通过，前台立即可见" : "已驳回，不会显示在前台", "", "success");
  } catch (error) {
    if ($("reviewAuditBody") !== body || activeMerchant?.account !== account) return;
    buttons.forEach((item) => { item.disabled = false; });
    button.textContent = originalText;
    adminToast(action === "approve" ? "通过失败" : "驳回失败", error?.message || "请稍后重试", "error");
    if (error.status === 409) await renderReviewAudit();
  } finally {
    reviewDecisionsInFlight.delete(requestKey);
    if ($("reviewAuditBody") === body && activeMerchant?.account === account) {
      document.querySelectorAll("[data-review-row]").forEach((row) => {
        if (String(row.dataset.reviewRow) === String(id)) {
          row.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        }
      });
    }
  }
}

// ---- 后台通用反馈：轻提示 / 页内确认弹窗 / 列表过渡动画 -------------------------
// 预览 iframe 和部分内嵌浏览器会直接拦掉原生 alert、confirm（后者返回 false），
// 表现就是"点了没反应"。所以后台统一改用页内组件，任何宿主环境都能正常执行。
function adminToast(message, detail = "", type = "info") {
  if (!message) return;
  let stack = document.querySelector(".admin-toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "admin-toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = `admin-toast is-${type}`;
  const title = document.createElement("strong");
  title.textContent = String(message);
  toast.appendChild(title);
  if (detail) {
    const note = document.createElement("span");
    note.textContent = String(detail);
    toast.appendChild(note);
  }
  stack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("is-leaving");
    window.setTimeout(() => toast.remove(), 420);
  }, 2600);
}

function adminConfirm({ title, message = "", target = "", confirmText = "确认", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    document.querySelector(".admin-confirm-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "admin-confirm-backdrop";
    const dialog = document.createElement("section");
    dialog.className = "admin-confirm-dialog admin-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const heading = document.createElement("h3");
    heading.textContent = String(title || "请确认");
    dialog.appendChild(heading);

    if (message) {
      const paragraph = document.createElement("p");
      paragraph.textContent = String(message);
      dialog.appendChild(paragraph);
    }
    if (target) {
      const targetBox = document.createElement("div");
      targetBox.className = "admin-confirm-target";
      targetBox.textContent = String(target);
      dialog.appendChild(targetBox);
    }

    const footer = document.createElement("footer");
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "admin-confirm-cancel";
    cancelButton.textContent = cancelText;
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = danger ? "admin-confirm-ok is-danger" : "admin-confirm-ok is-primary";
    confirmButton.textContent = confirmText;
    footer.append(cancelButton, confirmButton);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let settled = false;
    const onKeydown = (event) => {
      if (event.key === "Escape") close(false);
      else if (event.key === "Enter") close(true);
    };
    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      resolve(value);
    };
    cancelButton.addEventListener("click", () => close(false));
    confirmButton.addEventListener("click", () => close(true));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(false); });
    document.addEventListener("keydown", onKeydown, true);
    confirmButton.focus();
  });
}

// 需要填内容的页内弹窗（例如驳回评价的原因）。确认返回填写的文字（可以是空串），取消返回 null。
// 同样不用原生 prompt —— 预览 iframe 会把它拦掉，点了就是"没反应"。
function adminPrompt({ title, message = "", target = "", placeholder = "", confirmText = "确认", cancelText = "取消" }) {
  return new Promise((resolve) => {
    document.querySelector(".admin-confirm-backdrop")?.remove();
    const backdrop = document.createElement("div");
    backdrop.className = "admin-confirm-backdrop";
    const dialog = document.createElement("section");
    dialog.className = "admin-confirm-dialog admin-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");

    const heading = document.createElement("h3");
    heading.textContent = String(title || "请填写");
    dialog.appendChild(heading);
    if (message) {
      const paragraph = document.createElement("p");
      paragraph.textContent = String(message);
      dialog.appendChild(paragraph);
    }
    if (target) {
      const targetBox = document.createElement("div");
      targetBox.className = "admin-confirm-target";
      targetBox.textContent = String(target);
      dialog.appendChild(targetBox);
    }

    const input = document.createElement("textarea");
    input.className = "admin-prompt-input";
    input.rows = 3;
    input.maxLength = 200;
    input.placeholder = String(placeholder || "");
    dialog.appendChild(input);

    const footer = document.createElement("footer");
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "admin-confirm-cancel";
    cancelButton.textContent = cancelText;
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "admin-confirm-ok is-danger";
    confirmButton.textContent = confirmText;
    footer.append(cancelButton, confirmButton);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let settled = false;
    const onKeydown = (event) => { if (event.key === "Escape") close(null); };
    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKeydown, true);
      backdrop.remove();
      resolve(value);
    };
    cancelButton.addEventListener("click", () => close(null));
    confirmButton.addEventListener("click", () => close(String(input.value || "").trim()));
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(null); });
    document.addEventListener("keydown", onKeydown, true);
    input.focus();
  });
}

// 重置筛选后让可见行依次淡入上移，避免列表"啪"一下全出现。
function animateListEnter(rowSelector) {
  const rows = [...document.querySelectorAll(rowSelector)].filter((row) => !row.hidden);
  if (!rows.length) return;
  rows.forEach((row, index) => {
    row.classList.remove("row-enter");
    row.style.animationDelay = `${Math.min(index, 12) * 28}ms`;
  });
  void document.body.offsetWidth;
  rows.forEach((row) => row.classList.add("row-enter"));
}

// 所有 ↻ 重置按钮统一带旋转反馈，点下去就有可见的过渡动效。
document.addEventListener("click", (event) => {
  const target = event.target;
  const button = target instanceof Element ? target.closest("button.admin-icon-reset") : null;
  if (!button) return;
  button.classList.remove("is-spinning");
  void button.offsetWidth;
  button.classList.add("is-spinning");
  button.addEventListener("animationend", () => button.classList.remove("is-spinning"), { once: true });
});

function staffGrantPanelHtml(grants) {
  const rows = grants.length ? grants.map((item) => `<tr>
      <td><strong class="staff-grant-name">${escapeHtml(item.displayName)}</strong></td><td><code class="staff-grant-id">${escapeHtml(item.numericId)}</code></td><td>${escapeHtml(item.grantedBy || "-")}</td>
      <td><button type="button" class="staff-revoke-button" data-revoke-staff-grant="${escapeHtml(item.numericId)}" data-revoke-staff-name="${escapeHtml(item.displayName)}">撤销权限</button></td>
    </tr>`).join("") : `<tr><td colspan="4" class="staff-grant-empty">还没有已授权的打手。客户在小程序“我的”页面可以看到自己的数字 ID。</td></tr>`;
  return `<section class="panel staff-grant-panel">
    <div class="panel-head"><h2>打手接单权限</h2><span class="panel-tip">已授权 ${grants.length} 名打手</span></div>
    <p class="wallet-credit-hint">只有在这里授权过的微信客户才能进入打手工作台、抢单和查看订单聊天。授权立即生效，撤销后对方的登录态会同时失效。</p>
    <div class="wallet-list-toolbar"><label><span>客户数字 ID</span><input id="staffGrantNumericId" type="text" inputmode="numeric" maxlength="12" placeholder="例如 123456789" autocomplete="off" /></label><button type="button" class="admin-add-button" id="grantStaffBtn">授权打手</button></div>
    <table class="wallet-table staff-grant-table"><thead><tr><th>客户昵称</th><th>数字 ID</th><th>授权人</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

function bindStaffGrantPanel(onChanged) {
  $("grantStaffBtn")?.addEventListener("click", async (event) => {
    const input = $("staffGrantNumericId");
    const numericId = String(input?.value || "").trim();
    if (!/^\d{6,12}$/.test(numericId)) {
      return adminToast("请输入客户数字 ID", "数字 ID 在客户小程序的“我的”页面可以看到，为 6-12 位数字", "error");
    }
    const button = event.currentTarget;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "授权中…";
    try {
      const result = await updateStaffGrant(numericId, "grant");
      const displayName = result.displayName || numericId;
      recordOperation("授权打手", `${displayName} 已开通打手接单权限`);
      adminToast("已开通打手权限", `${displayName} · 数字 ID ${numericId}`, "success");
      await onChanged?.();
    } catch (error) {
      button.disabled = false;
      button.textContent = originalText;
      adminToast("授权失败", error?.message || "请稍后重试", "error");
    }
  });
  document.querySelectorAll("[data-revoke-staff-grant]").forEach((button) => {
    button.addEventListener("click", async () => {
      const numericId = button.dataset.revokeStaffGrant;
      const displayName = button.dataset.revokeStaffName || `数字 ID ${numericId}`;
      // `window.confirm` 在预览 iframe / 部分内嵌浏览器里会被直接拦掉并返回 false，
      // 表现就是"点了没反应"。改成页内弹窗，任何宿主环境都能真正执行撤销。
      const confirmed = await adminConfirm({
        title: "撤销打手接单权限",
        message: "撤销后对方会立即退出打手工作台，需要重新授权才能抢单。",
        target: `${displayName} · 数字 ID ${numericId}`,
        confirmText: "确认撤销",
        danger: true,
      });
      if (!confirmed) return;
      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "撤销中…";
      try {
        await updateStaffGrant(numericId, "revoke");
        recordOperation("撤销打手权限", `${displayName}（数字 ID ${numericId}）`);
        adminToast("已撤销打手权限", `${displayName} · 数字 ID ${numericId}`, "success");
        await onChanged?.();
      } catch (error) {
        button.disabled = false;
        button.textContent = originalText;
        adminToast("撤销失败", error?.message || "请稍后重试", "error");
      }
    });
  });
}

function walletBalanceMap(wallets) {
  return new Map(wallets.map((wallet) => [String(wallet.ownerId), Number(wallet.balance || 0)]));
}

// `crypto.randomUUID()` only exists in a secure context (https or localhost). A merchant
// who hosts this console over plain http on a LAN address would get `undefined`, the click
// handler would throw before sending anything, and "增加余额" would silently stop working.
// Fall back to crypto.getRandomValues, then to Math.random, so a request ID always exists.
function newWalletRequestId() {
  const webCrypto = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : null;
  try {
    if (webCrypto && typeof webCrypto.randomUUID === "function") return webCrypto.randomUUID();
  } catch {}
  const bytes = new Uint8Array(16);
  let filled = false;
  try {
    if (webCrypto && typeof webCrypto.getRandomValues === "function") { webCrypto.getRandomValues(bytes); filled = true; }
  } catch {}
  if (!filled) for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 后台加余额只有客户一种身份，所以候选集也只取「本商户的客户」：
// 有订单的客户（buildUsersFromOrders）加上账上已经有余额账户的客户。
// 不再列打手 —— 同一个人就算被授权成打手，后台加的钱也统一进他的客户钱包，
// 这样客户在小程序里立刻能看到、能下单付款。
// 服务端 resolveWalletOwner 仍然只认本商户名下的账户（租户隔离不放宽）。
async function loadWalletCreditCustomers(account, keyword = "") {
  const response = await fetch(`/api/wallets/${encodeURIComponent(account)}/customers?q=${encodeURIComponent(keyword)}`, { credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok || !Array.isArray(result.customers)) throw new Error("客户账户读取失败");
  return result.customers;
}

function walletLedgerCreditCandidates(owners, customers = []) {
  const candidates = new Map();
  const push = (ownerId, displayName, userId = "") => {
    const id = String(ownerId || "").trim();
    if (!id) return;
    if (!candidates.has(id)) candidates.set(id, { ownerId: id, ownerType: "customer", displayName: String(displayName || "").trim() || id, userId: String(userId || "") });
    else if (userId) candidates.get(id).userId = String(userId);
  };
  buildUsersFromOrders(getMerchantOrders()).forEach((item) => push(item.customerId, item.name, item.id));
  owners.filter((owner) => owner.ownerType === "customer").forEach((owner) => push(owner.ownerId, owner.displayName, owner.userId));
  customers.forEach((customer) => push(customer.customerId, customer.displayName, customer.numericId));
  return [...candidates.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN"));
}

async function openWalletLedgerAddDialog(owners, page) {
  const merchantAccount = activeMerchant.account;
  document.querySelector(".wallet-credit-backdrop")?.remove();
  const backdrop = document.createElement("div");
  backdrop.className = "wallet-credit-backdrop";
  backdrop.innerHTML = `<section class="wallet-credit-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="walletLedgerAddTitle">
    <header><div><h3 id="walletLedgerAddTitle">帮用户增加余额</h3><p>钱直接进入客户钱包，客户在小程序里马上就能看到</p></div><button type="button" data-close-ledger-add aria-label="关闭">×</button></header>
    <label><span>搜索数字 ID</span><input id="walletLedgerAddSearch" type="search" placeholder="输入数字 ID、昵称或账户标识" autocomplete="off" /></label>
    <label><span>选择用户</span><select id="walletLedgerAddOwner"></select></label>
    <p class="wallet-credit-hint" id="walletLedgerAddStatus" role="status">仅列出本商户的客户账户。</p>
    <footer><button type="button" class="ghost" data-close-ledger-add>取消</button><button type="button" id="walletLedgerAddNext">下一步</button></footer>
  </section>`;
  document.body.appendChild(backdrop);
  let searchTimer;
  let requestVersion = 0;
  const close = () => { clearTimeout(searchTimer); requestVersion++; backdrop.remove(); };
  backdrop.querySelectorAll("[data-close-ledger-add]").forEach((button) => button.addEventListener("click", close));
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  const searchInput = backdrop.querySelector("#walletLedgerAddSearch");
  const ownerSelect = backdrop.querySelector("#walletLedgerAddOwner");
  const nextButton = backdrop.querySelector("#walletLedgerAddNext");
  let candidateList = [];
  let customers = [];
  let loading = true;
  let loadError = "";
  const syncOptions = () => {
    const keyword = searchInput.value.trim().toLocaleLowerCase("zh-CN");
    candidateList = walletLedgerCreditCandidates(owners, customers)
      .filter((item) => !keyword || `${item.userId} ${item.displayName} ${item.ownerId}`.toLocaleLowerCase("zh-CN").includes(keyword));
    ownerSelect.innerHTML = candidateList.length
      ? candidateList.map((item) => `<option value="${escapeHtml(`${item.ownerType}:${item.ownerId}`)}">${escapeHtml(item.displayName)} · ${escapeHtml(userIdLabel(item.userId))}</option>`).join("")
      : `<option value="">没有匹配的用户账户</option>`;
    nextButton.disabled = loading || !candidateList.length;
    const status = backdrop.querySelector("#walletLedgerAddStatus");
    if (status) status.textContent = loadError || (loading ? "正在同步客户账户..." : candidateList.length
      ? `匹配 ${candidateList.length} 个客户账户`
      : "没有匹配的用户账户，请核对数字 ID。");
  };
  const loadCustomers = async () => {
    const version = ++requestVersion;
    loading = true;
    loadError = "";
    syncOptions();
    try {
      const rows = await loadWalletCreditCustomers(merchantAccount, searchInput.value.trim());
      if (version === requestVersion) customers = rows;
    } catch {
      if (version === requestVersion) loadError = "客户账户读取失败，请重新搜索或关闭后重试。";
    } finally {
      if (version === requestVersion && backdrop.isConnected && activeMerchant.account === merchantAccount) {
        loading = false;
        syncOptions();
      }
    }
  };
  syncOptions();
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    requestVersion++;
    loading = true;
    syncOptions();
    searchTimer = setTimeout(loadCustomers, 200);
  });
  searchInput.focus();
  backdrop.querySelector("#walletLedgerAddNext").addEventListener("click", () => {
    if (activeMerchant.account !== merchantAccount) return close();
    const matched = candidateList.find((item) => `${item.ownerType}:${item.ownerId}` === ownerSelect.value);
    if (!matched) return adminToast("没有可选的账户", "这家商户还没有匹配的用户账户", "error");
    const { ownerType, ownerId } = matched;
    const known = owners.find((owner) => owner.ownerType === ownerType && owner.ownerId === ownerId);
    close();
    openWalletCreditDialog({
      ownerType,
      ownerId,
      displayName: known?.displayName || matched?.displayName || ownerId,
      userId: known?.userId || matched?.userId || "",
      balance: known ? known.balance : 0,
      onSaved: () => renderWalletLedger(page),
    });
  });
  await loadCustomers();
}

function openWalletCreditDialog({ ownerType, ownerId, displayName, userId = "", balance, onSaved }) {
  document.querySelector(".wallet-credit-backdrop")?.remove();
  // 后台加余额只有客户一种身份（服务端 creditWallet 已统一收口），所以文案固定「客户」。
  const roleName = "客户";
  const numeric = numericUserId(userId);
  const backdrop = document.createElement("div");
  backdrop.className = "wallet-credit-backdrop";
  backdrop.innerHTML = `<section class="wallet-credit-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="walletCreditTitle">
    <header><div><h3 id="walletCreditTitle">增加${roleName}余额</h3><p>${escapeHtml(displayName)}${numeric ? ` · 数字 ID ${escapeHtml(numeric)}` : ""} · 当前 ${money(balance)}</p></div><button type="button" data-close-wallet-credit aria-label="关闭">×</button></header>
    <label><span>增加金额</span><div class="wallet-amount-input"><b>¥</b><input id="walletCreditAmount" type="number" min="0.01" max="1000000" step="0.01" placeholder="请输入金额" /></div></label>
    <label><span>备注</span><input id="walletCreditNote" maxlength="200" value="商户后台增加余额" /></label>
    <p class="wallet-credit-hint">保存后立即写入数据库并生成余额流水。</p>
    <footer><button type="button" class="ghost" data-close-wallet-credit>取消</button><button type="button" id="confirmWalletCredit">确认增加</button></footer>
  </section>`;
  document.body.appendChild(backdrop);
  const close = () => { if (!submitting) backdrop.remove(); };
  backdrop.querySelectorAll("[data-close-wallet-credit]").forEach((button) => button.addEventListener("click", close));
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  const amountInput = backdrop.querySelector("#walletCreditAmount");
  const noteInput = backdrop.querySelector("#walletCreditNote");
  const merchantAccount = activeMerchant.account;
  const pendingKey = `wallet_credit_pending_${merchantAccount}_${ownerType}_${ownerId}`;
  let submitting = false;
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(pendingKey)); } catch {}
  if (pending && (pending.ownerType !== ownerType || pending.ownerId !== ownerId || !/^[A-Za-z0-9_-]{16,80}$/.test(pending.requestId || ""))) pending = null;
  if (pending) {
    amountInput.value = pending.amount;
    noteInput.value = pending.note;
    amountInput.disabled = noteInput.disabled = true;
    backdrop.querySelector("#confirmWalletCredit").textContent = "重试确认";
  }
  amountInput.focus();
  backdrop.querySelector("#confirmWalletCredit").addEventListener("click", async (event) => {
    if (submitting) return;
    const amount = amountInput.value.trim();
    if (!/^(0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || Number(amount) > 1000000) return adminToast("金额格式不对", "请输入 0.01 ~ 1000000 元，最多两位小数", "error");
    const button = event.currentTarget;
    if (!pending) {
      pending = { requestId: newWalletRequestId(), ownerType, ownerId, displayName, amount, note: noteInput.value.trim() };
    }
    try {
      const stored = JSON.parse(localStorage.getItem(pendingKey));
      if (stored && stored.requestId !== pending.requestId) return adminToast("此账户还有未确认的余额操作", "请关闭后重新打开并核对，不要重复提交", "error");
      localStorage.setItem(pendingKey, JSON.stringify(pending));
    } catch { return adminToast("无法保存操作编号，本次未提交", "请检查浏览器的本地存储设置", "error"); }
    submitting = true;
    button.disabled = true;
    amountInput.disabled = noteInput.disabled = true;
    backdrop.querySelectorAll("[data-close-wallet-credit]").forEach((item) => { item.disabled = true; });
    button.textContent = "保存中...";
    let result;
    try {
      const response = await fetch(`/api/wallets/${encodeURIComponent(merchantAccount)}/credit`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.message || "增加余额失败");
    } catch (error) {
      adminToast("增加余额失败", error.message || "请稍后用同样的操作重试", "error");
      button.disabled = false;
      button.textContent = "重试确认";
      return;
    } finally {
      submitting = false;
      backdrop.querySelectorAll("[data-close-wallet-credit]").forEach((item) => { item.disabled = false; });
    }
    try { localStorage.removeItem(pendingKey); } catch {}
    close();
    adminToast(`已增加${roleName}余额`, `${displayName} +${money(pending.amount)}，当前余额 ${money(result.wallet.balance)}`, "success");
    try {
      recordOperation(`增加${roleName}余额`, `${displayName} +${money(pending.amount)}，余额 ${money(result.wallet.balance)}，操作编号 ${pending.requestId}`);
      onSaved?.(result.wallet);
    } catch {
      adminToast("余额已调整成功，但列表刷新失败", "请刷新页面核对，不要重新加款", "error");
    }
  });
}

function bindWalletCreditButtons(onSaved) {
  document.querySelectorAll("[data-wallet-credit]").forEach((button) => {
    button.addEventListener("click", () => openWalletCreditDialog({
      ownerType: button.dataset.walletType,
      ownerId: button.dataset.walletOwner,
      displayName: button.dataset.walletName,
      userId: button.dataset.walletUserId || "",
      balance: Number(button.dataset.walletBalance || 0),
      onSaved,
    }));
  });
}

function bindWalletListSearch({ inputId, rowSelector, emptyRowId, countId, unit }) {
  const input = $(inputId);
  const rows = [...document.querySelectorAll(rowSelector)];
  const emptyRow = $(emptyRowId);
  const count = $(countId);
  if (!input) return;

  const applySearch = () => {
    const keyword = input.value.trim().toLocaleLowerCase("zh-CN");
    let visibleCount = 0;
    rows.forEach((row) => {
      const searchable = String(row.dataset.walletSearch || "").toLocaleLowerCase("zh-CN");
      const matched = !keyword || searchable.includes(keyword);
      row.hidden = !matched;
      if (matched) visibleCount += 1;
    });
    if (emptyRow) emptyRow.hidden = visibleCount > 0 || !keyword;
    if (count) count.textContent = keyword ? `找到 ${visibleCount} ${unit}` : `共 ${rows.length} ${unit}`;
  };

  input.addEventListener("input", applySearch);
  input.addEventListener("search", applySearch);
  applySearch();
}

async function renderUserModule(page) {
  if (page === "会员等级") {
    renderMemberBenefitSettings();
    return;
  }
  const users = buildUsersFromOrders(getMerchantOrders());
  $("pageContent").innerHTML = `<section class="panel wallet-loading"><h2>${page}</h2><p>正在同步客户余额...</p></section>`;
  let wallets = [];
  try {
    wallets = await loadWalletAccounts("customer");
  } catch (error) {
    if (currentPage === page) $("pageContent").innerHTML = `<section class="panel"><h2>${page}</h2><p class="wallet-error">${escapeHtml(error.message)}</p></section>`;
    return;
  }
  if (currentPage !== page) return;
  const balances = walletBalanceMap(wallets);
  $("pageContent").innerHTML = `<section class="panel"><div class="panel-head"><h2>${page}</h2><button data-export="users">导出用户</button></div>
    <div class="wallet-list-toolbar"><label><span>客户模糊搜索</span><input id="customerListSearch" type="search" placeholder="输入数字 ID、昵称或客户标识" autocomplete="off" /></label><span id="customerListSearchCount">共 ${users.length} 位客户</span></div>
    <table class="wallet-table"><thead><tr><th>数字 ID</th><th>昵称</th><th>支付金额</th><th>订单数</th><th>余额</th><th>操作</th></tr></thead><tbody>
    ${users.length ? users.map((item) => {
      const balance = balances.get(String(item.customerId)) || 0;
      const searchable = [item.id, item.name, item.customerId].filter(Boolean).join(" ");
      return `<tr data-customer-search-row data-wallet-search="${escapeHtml(searchable)}"><td>${escapeHtml(item.id || "未绑定")}</td><td>${escapeHtml(item.name)}</td><td>${money(item.amount)}</td><td>${item.orders}</td><td><strong class="wallet-balance">${money(balance)}</strong></td><td>${item.customerId ? `<button type="button" data-wallet-credit data-wallet-type="customer" data-wallet-owner="${escapeHtml(item.customerId)}" data-wallet-name="${escapeHtml(item.name)}" data-wallet-user-id="${escapeHtml(item.id || "")}" data-wallet-balance="${balance}">增加余额</button>` : `<span class="hint">缺少客户标识</span>`}</td></tr>`;
    }).join("") : `<tr><td colspan="6">当前商户还没有用户数据，小程序下单后会自动生成。</td></tr>`}
    ${users.length ? `<tr id="customerListSearchEmpty" class="wallet-search-empty" hidden><td colspan="6">没有找到匹配的客户</td></tr>` : ""}
    </tbody></table></section>`;
  bindExportButtons();
  bindWalletCreditButtons(() => renderUserModule(page));
  bindWalletListSearch({ inputId: "customerListSearch", rowSelector: "[data-customer-search-row]", emptyRowId: "customerListSearchEmpty", countId: "customerListSearchCount", unit: "位客户" });
}

let staffModuleLoadId = 0;
// 管事邀请码页的异步读取也要防串号：切了商户 / 切了页面之后，
// 晚回来的响应不能再往页面上写。
let stewardInviteLoadId = 0;
async function renderStaffModule(page) {
  const loadId = ++staffModuleLoadId;
  const account = activeMerchant.account;
  if (page === "分销管理") {
    renderDistributorPanel();
    return;
  }
  $("pageContent").innerHTML = `<section class="panel wallet-loading"><h2>${page}</h2><p>正在读取员工列表...</p></section>`;
  let wallets = [];
  let grants = [];
  let orderStats = new Map();
  try {
    [wallets, grants, orderStats] = await Promise.all([
      page === "员工列表" ? loadWalletAccounts("staff") : Promise.resolve([]),
      loadStaffGrants(),
      page === "排行榜" ? loadStaffOrderStats() : Promise.resolve(new Map()),
    ]);
  } catch (error) {
    if (loadId === staffModuleLoadId && currentPage === page && activeMerchant?.account === account) $("pageContent").innerHTML = `<section class="panel"><h2>${page}</h2><p class="wallet-error">${escapeHtml(error.message)}</p></section>`;
    return;
  }
  if (loadId !== staffModuleLoadId || currentPage !== page || activeMerchant?.account !== account) return;
  // 员工列表的授权记录决定人员名单；等级配置只能按稳定 ID 补充属性，不能反向生成员工。
  const configured = Array.isArray(workingConfig.staffGrabbers) ? workingConfig.staffGrabbers : [];
  const staff = grants.map((grant) => {
    const profile = configured.find((item) => item && (
      (grant.customerId && String(item.customerId || "") === String(grant.customerId))
      || (grant.numericId && String(item.numericId || "") === String(grant.numericId))
    )) || {};
    return {
      customerId: grant.customerId,
      numericId: grant.numericId,
      name: grant.displayName || "未设置昵称",
      type: profile.type || "打手",
      level: profile.level || "未设置",
      status: "已授权",
      deposit: profile.deposit != null && profile.deposit !== "" && Number.isFinite(Number(profile.deposit)) ? Number(profile.deposit) : null,
      // 管事邀请进来的打手会带着来源，和后台「管事邀请码」页里的下级人数对得上。
      invitedBy: grant.invitedBy || null,
    };
  });
  // 「排行榜」= 员工管理里的接单榜：名单还是这份打手名单，但把原来那列「保证金」换成
  // 服务端聚合的「接单流水」（接单笔数 + 接单成交额），按接单笔数从高到低排。
  // ⚠️ 原来那列读的是老配置 workingConfig.staffGrabbers[].deposit，跟保证金账本
  //    （owner_type='staff_bond'，后台「功能 → 保证金」那页）**不是一份数据**，所以恒显示"未设置"。
  //    别把那个字段写回来；保证金要看就去「功能 → 保证金」。
  if (page === "排行榜") {
    const ranking = staff
      .map((item) => {
        const stat = orderStats.get(String(item.customerId || "")) || { orderCount: 0, orderAmount: 0 };
        return { ...item, orderCount: stat.orderCount, orderAmount: stat.orderAmount };
      })
      .sort((a, b) => (b.orderCount - a.orderCount) || (b.orderAmount - a.orderAmount) || String(a.name).localeCompare(String(b.name)));
    $("pageContent").innerHTML = `<section class="panel"><div class="panel-head"><h2>${page}</h2><button type="button" id="staffListLink">前往员工列表</button></div>
      <p class="hint">「接单流水」= 已付款、且订单上还挂着他名字的单子：笔数是单量，金额是这些单的成交额合计。订单被商户「返回大厅」后不再计入任何打手。按接单笔数从高到低排。</p>
      <table><thead><tr><th>员工</th><th>类型</th><th>等级</th><th>状态</th><th>接单流水</th></tr></thead><tbody>
      ${ranking.length ? ranking.map((item) => `<tr><td>${escapeHtml(item.name)}<br /><code>${escapeHtml(item.numericId || "-")}</code></td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.level)}</td><td><span class="tag">${escapeHtml(item.status)}</span></td><td><strong>${item.orderCount} 单</strong><br /><span class="hint">${money(item.orderAmount)}</span></td></tr>`).join("") : `<tr><td colspan="5">员工列表暂无已授权员工。</td></tr>`}
      </tbody></table></section>`;
    $("staffListLink").addEventListener("click", () => switchPage("员工列表"));
    return;
  }
  if (page !== "员工列表") {
    $("pageContent").innerHTML = `<section class="panel"><div class="panel-head"><h2>${page}</h2><button type="button" id="staffListLink">前往员工列表</button></div>
      <table><thead><tr><th>员工</th><th>类型</th><th>等级</th><th>状态</th><th>保证金</th></tr></thead><tbody>
      ${staff.length ? staff.map((item) => `<tr><td>${escapeHtml(item.name)}<br /><code>${escapeHtml(item.numericId || "-")}</code></td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.level)}</td><td><span class="tag">${escapeHtml(item.status)}</span></td><td>${item.deposit === null ? "未设置" : money(item.deposit)}</td></tr>`).join("") : `<tr><td colspan="5">员工列表暂无已授权员工。</td></tr>`}
      </tbody></table></section>`;
    $("staffListLink").addEventListener("click", () => switchPage("员工列表"));
    return;
  }
  const balances = walletBalanceMap(wallets);
  $("pageContent").innerHTML = `<section class="panel"><div class="panel-head"><h2>${page}</h2><div class="admin-toolbar-actions"><button type="button" class="admin-icon-reset" id="staffResetBtn" aria-label="重置打手搜索" title="重置打手搜索">↻</button></div></div>
    <div class="wallet-list-toolbar"><label><span>打手模糊搜索</span><input id="staffListSearch" type="search" placeholder="输入数字 ID、名称、类型、等级或状态" autocomplete="off" /></label><span id="staffListSearchCount">共 ${staff.length} 名打手</span></div>
    <table class="wallet-table"><thead><tr><th>员工</th><th>类型</th><th>等级</th><th>状态</th><th>保证金</th><th>邀请来源</th><th>余额</th><th>操作</th></tr></thead><tbody>
    ${staff.map((item) => {
      const balance = balances.get(String(item.customerId)) || 0;
      const searchable = [item.numericId, item.name, item.type, item.level, item.status].join(" ");
      // 后台加余额只有客户一种身份：打手钱包只由打手端自身产生，这里只读展示，
      // 不再给打手加款入口，避免钱进了打手钱包而客户在小程序里看不到。
      return `<tr data-staff-search-row data-wallet-search="${escapeHtml(searchable)}"><td>${escapeHtml(item.name)}<br /><code>${escapeHtml(item.numericId || "-")}</code></td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.level)}</td><td><span class="tag">${escapeHtml(item.status)}</span></td><td>${item.deposit === null ? "未设置" : money(item.deposit)}</td><td>${item.invitedBy ? `${escapeHtml(item.invitedBy.displayName)}<br /><code>${escapeHtml(item.invitedBy.numericId || "-")}</code>` : '<span class="hint">商户开通</span>'}</td><td><strong class="wallet-balance">${money(balance)}</strong></td><td><span class="hint">打手端钱包只读，加余额请到「余额变化」给客户加</span></td></tr>`;
    }).join("")}
    <tr id="staffListSearchEmpty" class="wallet-search-empty" hidden><td colspan="8">没有找到匹配的打手</td></tr>
    </tbody></table></section>${staffGrantPanelHtml(grants)}`;
  bindWalletCreditButtons(() => renderStaffModule(page));
  bindWalletListSearch({ inputId: "staffListSearch", rowSelector: "[data-staff-search-row]", emptyRowId: "staffListSearchEmpty", countId: "staffListSearchCount", unit: "名打手" });
  bindStaffGrantPanel(() => renderStaffModule(page));
  $("staffResetBtn")?.addEventListener("click", () => {
    const input = $("staffListSearch");
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input"));
    animateListEnter("[data-staff-search-row]");
    input.focus();
  });
}

// —— 员工管理 / 管事邀请码 ——
// 商户在这里生成"升级为管事"的邀请码；打手拿去在小程序打手工作台的「管事功能」里兑换，
// 兑换后本人变成管事，并自动获得一张自己的长期邀请码，用来邀请别人成为自己的下级打手。
const stewardCodeStatusLabels = { active: "长期有效（我的邀请码）", unused: "未使用", used: "已使用", disabled: "已停用" };

async function loadStewardInvites() {
  const response = await fetch(`/api/steward-invites/${encodeURIComponent(activeMerchant.account)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "管事邀请码读取失败");
  return {
    codes: Array.isArray(result.codes) ? result.codes : [],
    stewards: Array.isArray(result.stewards) ? result.stewards : [],
  };
}

async function mutateStewardInvites(payload) {
  const response = await fetch(`/api/steward-invites/${encodeURIComponent(activeMerchant.account)}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.message || "操作失败");
  return result;
}

function stewardTimeText(value) {
  const timestamp = Number(value || 0);
  return timestamp ? formatDateTime(new Date(timestamp)) : "—";
}

async function renderStewardInvites() {
  const loadId = ++stewardInviteLoadId;
  const account = activeMerchant.account;
  $("pageContent").innerHTML = `<section class="panel wallet-loading"><h2>管事邀请码</h2><p>正在读取邀请码...</p></section>`;
  let data;
  try {
    data = await loadStewardInvites();
  } catch (error) {
    if (loadId === stewardInviteLoadId && currentPage === "管事邀请码" && activeMerchant?.account === account) {
      $("pageContent").innerHTML = `<section class="panel"><h2>管事邀请码</h2><p class="wallet-error">${escapeHtml(error.message)}</p></section>`;
    }
    return;
  }
  if (loadId !== stewardInviteLoadId || currentPage !== "管事邀请码" || activeMerchant?.account !== account) return;

  // 这一页只管"后台发出去的升级码"；管事自己发的拉人码在下面的管事名单里按人展示。
  const upgradeCodes = data.codes.filter((row) => row.kind === "steward");
  const myCodes = new Map(
    data.stewards
      .map((item) => [item.customerId, data.codes.find((row) => row.issuerKey === item.customerId && row.status === "active")])
      .filter(([, row]) => row),
  );
  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head"><h2>管事邀请码</h2><button type="button" id="createStewardCodeBtn">生成邀请码</button></div>
    <p class="hint">把码发给打手，他在小程序「打手工作台 → 陪玩中心 → 管事功能」里输入，就会升级为管事。每个码只能用一次。</p>
    <table class="wallet-table"><thead><tr><th>邀请码</th><th>状态</th><th>使用人</th><th>使用时间</th><th>生成时间</th><th>操作</th></tr></thead><tbody>
    ${upgradeCodes.length ? upgradeCodes.map((row) => `<tr>
      <td><code>${escapeHtml(row.code)}</code></td>
      <td><span class="tag">${escapeHtml(stewardCodeStatusLabels[row.status] || row.status)}</span></td>
      <td>${row.status === "used" ? `${escapeHtml(row.usedByName || "未知用户")}<br /><code>${escapeHtml(row.usedByNumeric || "-")}</code>` : "—"}</td>
      <td>${stewardTimeText(row.usedAt)}</td>
      <td>${stewardTimeText(row.createdAt)}</td>
      <td>${row.status === "unused" ? `<button type="button" data-disable-steward-code="${escapeHtml(row.code)}">停用</button>` : '<span class="hint">—</span>'}</td>
    </tr>`).join("") : '<tr><td colspan="6">还没有生成过邀请码。</td></tr>'}
    </tbody></table>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>管事名单</h2><span class="hint">共 ${data.stewards.length} 名管事</span></div>
    <p class="hint">管事的「我的邀请码」由系统在升级时自动发放，长期有效，可以反复邀请打手成为他的下级。</p>
    <table class="wallet-table"><thead><tr><th>管事</th><th>我的邀请码</th><th>下级打手</th><th>升级时间</th><th>来源</th></tr></thead><tbody>
    ${data.stewards.length ? data.stewards.map((item) => `<tr>
      <td>${escapeHtml(item.displayName)}<br /><code>${escapeHtml(item.numericId || "-")}</code></td>
      <td>${myCodes.has(item.customerId) ? `<code>${escapeHtml(myCodes.get(item.customerId).code)}</code>` : '<span class="hint">—</span>'}</td>
      <td><strong>${item.subordinateCount}</strong> 人</td>
      <td>${stewardTimeText(item.createdAt)}</td>
      <td><code>${escapeHtml(item.redeemedFrom || "-")}</code></td>
    </tr>`).join("") : '<tr><td colspan="5">还没有管事。先生成一张邀请码发给打手。</td></tr>'}
    </tbody></table>
  </section>`;

  $("createStewardCodeBtn").addEventListener("click", async () => {
    const input = await adminPrompt({ title: "生成管事邀请码", message: "一次可以生成多张，每张只能用一次。", placeholder: "生成数量，默认 1", confirmText: "生成" });
    if (input === null) return;
    const count = Math.min(20, Math.max(1, Math.floor(Number(input || 1)) || 1));
    try {
      const result = await mutateStewardInvites({ action: "create", count });
      adminToast(`已生成 ${result.codes.length} 张邀请码`, result.codes.join("、"));
      renderStewardInvites();
    } catch (error) {
      adminToast("生成失败", error.message, "error");
    }
  });

  document.querySelectorAll("[data-disable-steward-code]").forEach((button) => button.addEventListener("click", async () => {
    const code = button.dataset.disableStewardCode;
    const confirmed = await adminConfirm({ title: "停用邀请码", message: "停用后这个码就不能再被兑换了。", target: code, confirmText: "停用", danger: true });
    if (!confirmed) return;
    try {
      await mutateStewardInvites({ action: "disable", code });
      adminToast("已停用", code);
      renderStewardInvites();
    } catch (error) {
      adminToast("停用失败", error.message, "error");
    }
  }));
}

// 这一个页面只管「发码 + 看名单」。管事抽成 / 提现手续费都收口在「分销管理」，
// 别在这里再加第二个费率输入框 —— 同一笔钱两处可改必然对不上。
/* ---- 分销管理：提现手续费设置（用户 2026-09-18 定的口径）-------------------
 * 这笔钱怎么走：
 *   打手提现被收一笔「总手续费」 → 这笔钱里管事抽走一部分 → 剩下的归商户；
 *   打手没有上级管事 → 总手续费整笔归商户。
 * 三层继承与覆盖、以及所有算钱逻辑，全部只在 shared.js 的
 * resolveWithdrawFee / normalizeWithdrawFee 里（网页两端共用一份，别在这里再算一遍）。
 * ⚠️ 输入框留空 = 「没配，交给下一层继承」；填 0 = 「这一层明确不收」。两者不一样。
 * ponytail: 打手专项只给填数值，模式（比例/固定金额）跟随全局那一档 —— 一页里混两种单位
 *   最容易看错。真要按打手单独换模式，normalizeWithdrawFee 已经支持（专项里自带 mode 即可）。
 */
async function renderDistributorPanel() {
  $("pageContent").innerHTML = '<section class="panel"><div class="panel-head"><h2>分销管理</h2></div><p class="hint">正在读取管事名单…</p></section>';
  let stewards = [];
  let grants = [];
  let loadError = "";
  try {
    const [stewardData, staffGrants] = await Promise.all([loadStewardInvites(), loadStaffGrants()]);
    stewards = Array.isArray(stewardData.stewards) ? stewardData.stewards : [];
    grants = staffGrants;
  } catch (error) {
    loadError = error.message || "管事名单读取失败";
  }
  if (currentPage !== "分销管理") return;
  renderDistributorPanelBody(stewards, grants, loadError);
}

function withdrawFeeText(part) {
  return part.mode === "amount" ? money(part.value) : `${part.value}%`;
}

function renderDistributorPanelBody(stewards, grants, loadError) {
  const fee = normalizeWithdrawFee(workingConfig.withdrawFee);
  const settings = normalizeWithdrawSettings(workingConfig.withdrawSettings);
  const modeOptions = (current) => ["rate", "amount"]
    .map((mode) => `<option value="${mode}"${mode === current ? " selected" : ""}>${mode === "rate" ? "按比例 %" : "固定金额 ¥"}</option>`)
    .join("");
  const stewardBlocks = stewards.map((steward) => {
    const key = String(steward.customerId || "");
    const hasOwn = Object.prototype.hasOwnProperty.call(fee.stewardOverrides, key);
    const subordinates = grants.filter((grant) => grant.invitedBy && grant.invitedBy.customerId === key);
    const staffRows = subordinates.length ? subordinates.map((grant) => {
      const staffKey = String(grant.customerId || "");
      const override = fee.staffOverrides[staffKey];
      return `<tr>
        <td>${escapeHtml(grant.displayName)}<br /><code>${escapeHtml(grant.numericId || "-")}</code></td>
        <td><input type="number" min="0" step="0.01" data-staff-fee="${escapeHtml(staffKey)}" value="${override ? override.value : ""}" placeholder="留空 = 用默认 ${escapeHtml(withdrawFeeText(fee.staff))}" /></td>
      </tr>`;
    }).join("") : '<tr><td colspan="2" class="hint">这个管事名下还没有打手。</td></tr>';
    return `<details class="distributor-item">
      <summary><strong>${escapeHtml(steward.displayName)}</strong> <span class="hint">${escapeHtml(steward.numericId || "-")} · 下级 ${steward.subordinateCount} 人</span></summary>
      <div class="distributor-item-body">
        <label>这个管事从总手续费里抽多少（%）<input type="number" min="0" max="100" step="0.1" data-steward-rate="${escapeHtml(key)}" value="${hasOwn ? fee.stewardOverrides[key] : ""}" placeholder="留空 = 用默认 ${fee.stewardShareRate}%" /></label>
        <table class="wallet-table"><thead><tr><th>名下打手</th><th>提现手续费（总）</th></tr></thead><tbody>${staffRows}</tbody></table>
      </div>
    </details>`;
  }).join("");

  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head"><h2>分销管理</h2><button type="button" id="saveWithdrawFeeBtn">保存</button></div>
    <p class="hint">打手提现时收一笔「总手续费」，这笔钱里管事抽走一部分，剩下的归商户。打手没有上级管事时，整笔手续费归商户。</p>
    <div class="switch-grid">
      <label>打手提现手续费（总）
        <select id="withdrawFeeMode">${modeOptions(fee.staff.mode)}</select>
        <input id="withdrawFeeValue" type="number" min="0" step="0.01" value="${fee.staff.value}" />
      </label>
      <label>管事默认抽取比例（%）
        <input id="stewardShareRate" type="number" min="0" max="100" step="0.1" value="${fee.stewardShareRate}" />
      </label>
      <label><input id="stewardSelfEnabled" type="checkbox" ${fee.stewardSelf.enabled ? "checked" : ""} /> 管事本人提现收手续费</label>
      <label>管事本人提现手续费
        <select id="stewardSelfMode">${modeOptions(fee.stewardSelf.mode)}</select>
        <input id="stewardSelfValue" type="number" min="0" step="0.01" value="${fee.stewardSelf.value}" />
      </label>
    </div>
    <p class="hint">「管事抽取比例」是从上面那笔总手续费里分给管事的百分比（例如总手续费 10%、抽取比例 30% → 管事拿 3%、商户拿 7%）。单个管事可以在这里单独设，留空就用默认值；填 0 表示这个管事一分不抽。</p>
    <p class="hint" id="withdrawFeePreview"></p>
    <div class="panel-head"><h3>提现运营设置</h3><span class="hint">打手端每次进提现页都会重拉，改完立刻生效</span></div>
    <div class="switch-grid">
      <label>最低提现金额（元）
        <input id="withdrawMinAmount" type="number" min="0.01" step="0.01" value="${settings.minAmount}" />
      </label>
      ${WITHDRAW_CHANNELS.map((channel) => `<label><input type="checkbox" data-withdraw-channel="${channel.key}"${settings.channels.includes(channel.key) ? " checked" : ""} /> 开放${channel.label}提现</label>`).join("")}
    </div>
    <label class="hint">打手端提现说明（小程序提现页底部那段，留空用默认三段）
      <textarea id="withdrawNotice" rows="3">${escapeHtml(settings.notice)}</textarea>
    </label>
    <p class="hint">一个渠道都不勾保存时，会自动退回「只开支付宝」（和小程序接口失败时的降级一致）。最低提现金额必须大于 0，填 0 或留空会退回 10 元。</p>
    <div class="panel-head"><h3>管事与名下打手</h3><span class="hint">共 ${stewards.length} 名管事</span></div>
    ${loadError ? `<p class="hint">管事名单读取失败：${escapeHtml(loadError)}</p>` : ""}
    ${!loadError && !stewards.length ? '<p class="hint">还没有管事。先在「员工管理 → 管事邀请码」里发码给打手升级。</p>' : ""}
    ${stewardBlocks}
  </section>`;

  updateWithdrawFeePreview();
  document.querySelectorAll("#withdrawFeeMode, #withdrawFeeValue, #stewardShareRate, #stewardSelfEnabled, #stewardSelfMode, #stewardSelfValue, [data-steward-rate], [data-staff-fee]")
    .forEach((input) => {
      input.addEventListener("input", updateWithdrawFeePreview);
      input.addEventListener("change", updateWithdrawFeePreview);
    });
  $("saveWithdrawFeeBtn").addEventListener("click", async () => {
    const withdrawFee = readWithdrawFeeForm();
    // 抽取比例一律 0~100。**全局默认那一档也要查**：只查按管事的专项时，商户在默认框里填 150
    // 会被 withdrawShareRate 悄悄压成 100，而输入框还留着 150，看着像存上了（静默改数）。
    const rateInputs = [$("stewardShareRate"), ...document.querySelectorAll("[data-steward-rate]")];
    const tooBig = rateInputs.some((input) => {
      const raw = String(input.value).trim();
      return raw !== "" && !(Number(raw) >= 0 && Number(raw) <= 100);
    });
    if (tooBig) {
      adminToast("抽取比例不对", "管事抽取比例请填 0 到 100 之间的数字，留空表示用默认值", "error");
      return;
    }
    const settings = readWithdrawSettingsForm();
    // 归一化会把非法值悄悄换回兜底值（0 元 → 10 元、没勾渠道 → 只开支付宝）。
    // 商户那边输入框还留着他填的内容，看着像存上了 —— 所以这里先拦下来，别静默改数。
    if (!(Number(settings.minAmount) > 0)) {
      adminToast("最低提现金额不对", "请填一个大于 0 的数字（例如 10）", "error");
      return;
    }
    if (!settings.channels.length) {
      adminToast("一个提现渠道都没开", "至少要勾一个，打手才有通道可以选", "error");
      return;
    }
    workingConfig.withdrawFee = withdrawFee;
    workingConfig.withdrawSettings = normalizeWithdrawSettings(settings);
    // saveMerchantConfig 不抛错：失败时返回 { ok: false, error }，必须判 result.ok，
    // 否则保存真的失败也会弹"已保存"（静默失败）。它内部已经归一化，这里不用再套一层。
    const result = await saveMerchantConfig(activeMerchant.account, workingConfig);
    if (!result.ok) {
      adminToast("保存失败", result.error?.message || "请重新登录后台或检查服务是否正常", "error");
      return;
    }
    adminToast("已保存", `打手提现手续费 ${withdrawFeeText(withdrawFee.staff)} · 管事默认抽 ${withdrawFee.stewardShareRate}% · 最低提现 ${money(workingConfig.withdrawSettings.minAmount)}`);
  });
}

// 从「提现运营设置」读回三项。渠道按勾选顺序取 WITHDRAW_CHANNELS 里的 key（顺序固定，不跟着 DOM 走）。
function readWithdrawSettingsForm() {
  return {
    minAmount: $("withdrawMinAmount").value,
    channels: WITHDRAW_CHANNELS.filter((channel) => document.querySelector(`[data-withdraw-channel="${channel.key}"]`)?.checked).map((channel) => channel.key),
    notice: $("withdrawNotice").value,
  };
}

// 从表单读回配置。留空 = 不写这一层（normalizeWithdrawFee 会把它当「没配」丢掉，交给下一层继承）。
function readWithdrawFeeForm() {
  const readOverride = (selector, keyName, build) => {
    const overrides = {};
    document.querySelectorAll(selector).forEach((input) => {
      const raw = String(input.value).trim();
      if (raw === "") return;
      const number = Number(raw);
      if (Number.isFinite(number) && number >= 0) overrides[input.dataset[keyName]] = build(number);
    });
    return overrides;
  };
  return normalizeWithdrawFee({
    staff: { mode: $("withdrawFeeMode").value, value: $("withdrawFeeValue").value },
    stewardShareRate: $("stewardShareRate").value,
    staffOverrides: readOverride("[data-staff-fee]", "staffFee", (value) => ({ value })),
    stewardOverrides: readOverride("[data-steward-rate]", "stewardRate", (shareRate) => ({ shareRate })),
    stewardSelf: { enabled: $("stewardSelfEnabled").checked, mode: $("stewardSelfMode").value, value: $("stewardSelfValue").value },
  });
}

// 试算：拿当前表单里的配置算一遍 100 元提现，商户能直接看出这个比例到底扣多少钱。
function updateWithdrawFeePreview() {
  const target = $("withdrawFeePreview");
  if (!target) return;
  const config = { withdrawFee: readWithdrawFeeForm() };
  const sample = 10000;
  const withSteward = resolveWithdrawFee(config, { stewardKey: "preview", amountCents: sample });
  const withoutSteward = resolveWithdrawFee(config, { amountCents: sample });
  const self = resolveStewardSelfFee(config, sample);
  target.textContent = `试算（提现 ${money(100)}）：有上级管事的打手 → 手续费 ${money(withSteward.totalCents / 100)}（管事 ${money(withSteward.stewardCents / 100)}、商户 ${money(withSteward.merchantCents / 100)}）；没有上级管事 → ${money(withoutSteward.totalCents / 100)} 整笔归商户；管事本人提现 → ${self.enabled ? money(self.totalCents / 100) : "不收"}。`;
}

function renderFinanceModule(page) {
  const orders = getMerchantOrders();
  const paidTotal = orders.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const staffTotal = orders.reduce((sum, item) => sum + getOrderStaffIncome(item), 0);
  const clubBalance = Math.max(0, paidTotal - staffTotal);
  $("pageContent").innerHTML = `<section class="stats-grid">
    <div class="stat-card"><span>俱乐部余额</span><strong>${money(clubBalance)}</strong></div>
    <div class="stat-card"><span>待结算打手余额</span><strong>${money(staffTotal)}</strong></div>
    <div class="stat-card"><span>订单入账</span><strong>${money(paidTotal)}</strong></div>
    <div class="stat-card"><span>订单数量</span><strong>${orders.length}</strong></div>
  </section><section class="panel"><h2>${page}</h2><table><thead><tr><th>流水</th><th>类型</th><th>金额</th><th>状态</th></tr></thead><tbody>
    <tr><td>CW${Date.now()}</td><td>订单入账</td><td>${money(paidTotal)}</td><td><span class="tag">已入账</span></td></tr>
    <tr><td>GZ${Date.now()}</td><td>打手分成余额</td><td>${money(staffTotal)}</td><td><span class="tag">待发放</span></td></tr>
  </tbody></table></section>`;
}

function renderPermissionModule(page) {
  if (page !== "员工权限") {
    $("pageContent").innerHTML = `<section class="panel"><h2>${page}</h2><div class="switch-grid"><label><input type="checkbox" checked> 允许查看订单</label><label><input type="checkbox" checked> 允许修改商品</label><label><input type="checkbox"> 允许财务导出</label><label><input type="checkbox"> 允许创建员工</label></div></section>`;
    return;
  }
  const levels = workingConfig.staffLevels || clone(defaultConfig.staffLevels);
  const grabbers = workingConfig.staffGrabbers || clone(defaultConfig.staffGrabbers);
  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head"><h2>打手分层</h2><button id="addStaffLevelBtn">新增层级</button></div>
    <table class="staff-level-table"><thead><tr><th>层级</th><th>优先顺序</th><th>提前抢单秒数</th><th>提前抢单</th><th>高价单</th><th>可被指定</th><th>说明</th><th>操作</th></tr></thead><tbody id="staffLevelBody"></tbody></table>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>指定打手提前抢单</h2><button id="addGrabberBtn">新增打手</button></div>
    <table class="staff-level-table"><thead><tr><th>打手名称</th><th>所属层级</th><th>是否开启</th><th>个人提前秒数</th><th>操作</th></tr></thead><tbody id="grabberBody"></tbody></table>
    <p class="hint">规则说明：先看指定打手个人秒数；没有指定时，按打手层级的提前抢单秒数放单。</p>
  </section>`;
  renderStaffLevelRows(levels, grabbers);
  $("addStaffLevelBtn").addEventListener("click", () => {
    workingConfig.staffLevels.push({ name: "自定义层级", prioritySeconds: 0, order: workingConfig.staffLevels.length + 1, canPreGrab: true, canTakeHighValue: false, canBeSpecified: true, note: "" });
    renderPermissionModule("员工权限");
  });
  $("addGrabberBtn").addEventListener("click", () => {
    workingConfig.staffGrabbers.push({ name: "新打手", level: workingConfig.staffLevels[0]?.name || "金牌", preGrabEnabled: true, preGrabSeconds: 10 });
    renderPermissionModule("员工权限");
  });
}

function renderStaffLevelRows(levels, grabbers) {
  $("staffLevelBody").innerHTML = levels.map((level, index) => `<tr>
    <td><input data-level-field="name" data-index="${index}" value="${level.name}"></td>
    <td><input type="number" data-level-field="order" data-index="${index}" value="${level.order}"></td>
    <td><input type="number" min="0" data-level-field="prioritySeconds" data-index="${index}" value="${level.prioritySeconds}"></td>
    <td><input type="checkbox" data-level-field="canPreGrab" data-index="${index}" ${level.canPreGrab ? "checked" : ""}></td>
    <td><input type="checkbox" data-level-field="canTakeHighValue" data-index="${index}" ${level.canTakeHighValue ? "checked" : ""}></td>
    <td><input type="checkbox" data-level-field="canBeSpecified" data-index="${index}" ${level.canBeSpecified ? "checked" : ""}></td>
    <td><input data-level-field="note" data-index="${index}" value="${level.note || ""}"></td>
    <td><button data-delete-level="${index}">删除</button></td>
  </tr>`).join("");
  $("grabberBody").innerHTML = grabbers.map((item, index) => `<tr>
    <td><input data-grabber-field="name" data-index="${index}" value="${item.name}"></td>
    <td><select data-grabber-field="level" data-index="${index}">${levels.map((level) => `<option ${item.level === level.name ? "selected" : ""}>${level.name}</option>`).join("")}</select></td>
    <td><input type="checkbox" data-grabber-field="preGrabEnabled" data-index="${index}" ${item.preGrabEnabled ? "checked" : ""}></td>
    <td><input type="number" min="0" data-grabber-field="preGrabSeconds" data-index="${index}" value="${item.preGrabSeconds}"></td>
    <td><button data-delete-grabber="${index}">删除</button></td>
  </tr>`).join("");
  document.querySelectorAll("[data-level-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const field = input.dataset.levelField;
      const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value || 0) : input.value;
      workingConfig.staffLevels[Number(input.dataset.index)][field] = value;
      saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    });
  });
  document.querySelectorAll("[data-grabber-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const field = input.dataset.grabberField;
      const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value || 0) : input.value;
      workingConfig.staffGrabbers[Number(input.dataset.index)][field] = value;
      saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    });
  });
  document.querySelectorAll("[data-delete-level]").forEach((button) => button.addEventListener("click", () => {
    if (workingConfig.staffLevels.length <= 1) return alert("至少保留一个层级");
    workingConfig.staffLevels.splice(Number(button.dataset.deleteLevel), 1);
    saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    renderPermissionModule("员工权限");
  }));
  document.querySelectorAll("[data-delete-grabber]").forEach((button) => button.addEventListener("click", () => {
    workingConfig.staffGrabbers.splice(Number(button.dataset.deleteGrabber), 1);
    saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    renderPermissionModule("员工权限");
  }));
}

function renderProductExtraModule(page) {
  if (page === menuGroups[2].items[2]) {
    renderGameServerManager();
    return;
  }
  if (page === "商品分类") {
    renderCategoryTreeManager();
    return;
  }
  if (page === "奖池管理") {
    renderLotteryPoolManager();
    return;
  }
  const map = {
    "游戏区服": workingConfig.gameServers,
    "商品评论": ["很好，都去点", "速度很快", "客服处理及时"],
  };
  const rows = map[page] || [];
  $("pageContent").innerHTML = `<section class="panel"><div class="panel-head"><h2>${page}</h2><button>新增</button></div><div class="data-list">${rows.map((item, index) => `<div class="list-item"><div><strong>${item}</strong><small>ID ${index + 1}</small></div><div class="list-actions"><button>编辑</button><button>启用</button></div></div>`).join("")}</div></section>`;
}

function renderLotteryPoolManager(feedback = "") {
  const products = workingConfig.products.filter((product) => product.lotteryEnabled);
  const pools = normalizeLotteryPools(workingConfig.lotteryPools);
  $("pageContent").innerHTML = `<section class="panel lottery-pool-manager">
    <div class="panel-head"><h2>奖池管理</h2><div class="admin-toolbar-actions"><button type="button" id="addLotteryPoolBtn" class="admin-add-button">+ 新增</button></div></div>
    ${feedback ? `<div class="admin-save-feedback" role="status">${escapeHtml(feedback)}</div>` : ""}
    <div class="lottery-pool-table-wrap"><table class="lottery-pool-table"><thead><tr><th>商品</th><th>奖品 / 概率</th><th>配置状态</th><th>操作</th></tr></thead><tbody>
    ${products.length ? products.map((product) => {
      const pool = pools.find((item) => item.id === product.lotteryPoolId && item.enabled);
      const prizes = pool?.prizes.filter((prize) => prize.productIds.includes(String(product.id))) || [];
      const total = prizes.reduce((sum, prize) => sum + Math.round(prize.weight * 100), 0);
      return `<tr><td>${escapeHtml(product.title || product.orderTitle)}</td><td>${prizes.map((prize) => `<span class="lottery-prize-tag">${prize.imageUrl ? `<img src="${escapeHtml(prize.imageUrl)}" alt="" />` : ""}<span>${escapeHtml(prize.name)} · ${(Math.round(prize.weight * 100) / total * 100).toFixed(2)}%</span></span>`).join("") || "-"}</td><td>${prizes.length ? "已配置" : "待配置"}</td><td><button type="button" class="wallet-ledger-link" data-configure-lottery="${escapeHtml(product.id)}">配置奖品</button></td></tr>`;
    }).join("") : '<tr><td colspan="4">暂无开启抽奖模式的商品</td></tr>'}
    </tbody></table></div></section>`;
  $("addLotteryPoolBtn").onclick = () => openLotteryPoolEditor();
  document.querySelectorAll("[data-configure-lottery]").forEach((button) => button.onclick = () => openLotteryPoolEditor(button.dataset.configureLottery));
}

function syncLotteryPoolDraftFromDialog() {
  if (!lotteryPoolDraft) return;
  document.querySelectorAll("[data-lottery-prize-name]").forEach((input) => {
    lotteryPoolDraft.prizes[Number(input.dataset.lotteryPrizeName)].name = input.value;
  });
  document.querySelectorAll("[data-lottery-prize-weight]").forEach((input) => {
    lotteryPoolDraft.prizes[Number(input.dataset.lotteryPrizeWeight)].weight = Number(input.value);
  });
  lotteryPoolDraft.prizes.forEach((prize) => { prize.productIds = lotteryPoolDraft.productId ? [lotteryPoolDraft.productId] : []; });
}

function openLotteryPoolEditor(productId = "") {
  const product = workingConfig.products.find((item) => String(item.id) === String(productId));
  const pool = normalizeLotteryPools(workingConfig.lotteryPools).find((item) => item.id === product?.lotteryPoolId);
  const prizes = pool?.prizes.filter((prize) => prize.productIds.includes(String(productId))) || [];
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  const shared = pool?.prizes.some((prize) => prize.productIds.some((id) => id !== String(productId)));
  lotteryPoolDraft = {
    id: pool && !shared ? pool.id : `pool_${Date.now()}`,
    productId: String(productId), enabled: true,
    name: product ? `${product.title || product.orderTitle}奖池` : "",
    prizes: prizes.length ? prizes.map((prize, i) => ({ ...clone(prize), productIds: [String(productId)], weight: i === prizes.length - 1 ? Number((100 - prizes.slice(0, i).reduce((sum, p) => sum + Math.round(p.weight / total * 10000) / 100, 0)).toFixed(2)) : Math.round(prize.weight / total * 10000) / 100 })) : [{ id: `prize_${Date.now()}`, name: "", weight: 100, productIds: productId ? [String(productId)] : [], imageUrl: "" }]
  };
  renderLotteryPoolDialog();
}

function renderLotteryPoolDialog() {
  document.querySelector(".lottery-pool-backdrop")?.remove();
  const draft = lotteryPoolDraft;
  if (!draft) return;
  const products = workingConfig.products.filter((product) => product.lotteryEnabled);
  $("pageContent").insertAdjacentHTML("beforeend", `<div class="lottery-pool-backdrop"><section class="lottery-pool-dialog admin-dialog" role="dialog" aria-modal="true" aria-labelledby="lotteryPoolDialogTitle">
    <header><h3 id="lotteryPoolDialogTitle">商品抽奖奖品</h3><button type="button" id="closeLotteryPoolDialog" aria-label="关闭">×</button></header>
    <form class="lottery-pool-form" id="lotteryPoolForm" novalidate>
      <div class="lottery-form-row"><label for="lotteryProductSearch">搜索商品：</label><input type="search" id="lotteryProductSearch" placeholder="输入商品名字" /></div>
      <div class="lottery-form-row"><label for="lotteryProductSelect">商品名称：</label><select id="lotteryProductSelect"><option value="">请选择商品</option>${products.map((product) => `<option value="${escapeHtml(product.id)}" ${String(product.id) === draft.productId ? "selected" : ""}>${escapeHtml(product.title || product.orderTitle)}</option>`).join("")}</select></div>
      <div class="lottery-prize-editor-head"><strong>奖品设置</strong><button type="button" id="addLotteryPrizeBtn">+ 添加奖品</button></div>
      <div class="lottery-prize-rows">${draft.prizes.map((prize, index) => `<section class="lottery-prize-row">
        <button type="button" class="lottery-remove-prize" data-remove-lottery-prize="${index}" title="删除奖品" aria-label="删除奖品">×</button>
        <div class="lottery-form-row"><label for="lotteryPrizeName${index}">奖品名称：</label><input id="lotteryPrizeName${index}" data-lottery-prize-name="${index}" value="${escapeHtml(prize.name)}" /></div>
        <div class="lottery-form-row"><label for="lotteryPrizeWeight${index}">中奖概率：</label><div class="lottery-percent-input"><input id="lotteryPrizeWeight${index}" data-lottery-prize-weight="${index}" type="number" min="0.01" max="100" step="0.01" value="${prize.weight}" /><span>%</span></div></div>
        <div class="lottery-form-row"><span class="lottery-row-label">奖品图片：</span><div class="lottery-prize-image-control"><div class="lottery-prize-image-value">${prize.imageUrl ? `<img src="${escapeHtml(prize.imageUrl)}" alt="奖品图片预览" />` : ""}<span>${escapeHtml(prize.imageName || "未上传")}</span></div><input class="visually-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" data-lottery-prize-image-file="${index}" /><button type="button" class="lottery-upload-image" data-lottery-prize-upload="${index}">上传图片</button></div></div>
      </section>`).join("")}</div><p id="lotteryProbabilityTotal" class="lottery-probability-total"></p>
    </form>
    <footer><span class="lottery-save-status" id="lotteryPoolSaveStatus" role="status"></span><button type="button" class="plain" id="cancelLotteryPoolBtn">取消</button><button type="submit" form="lotteryPoolForm" id="saveLotteryPoolBtn">确定</button></footer>
  </section></div>`);
  const close = () => { if ($("saveLotteryPoolBtn")?.disabled) return; lotteryPoolDraft = null; document.querySelector(".lottery-pool-backdrop")?.remove(); };
  $("closeLotteryPoolDialog").onclick = $("cancelLotteryPoolBtn").onclick = close;
  $("lotteryProductSearch").oninput = (event) => {
    const keyword = event.target.value.trim().toLocaleLowerCase("zh-CN");
    Array.from($("lotteryProductSelect").options).forEach((option) => { option.hidden = !!option.value && !option.textContent.toLocaleLowerCase("zh-CN").includes(keyword); });
  };
  $("lotteryProductSelect").onchange = (event) => openLotteryPoolEditor(event.target.value);
  const updateTotal = () => {
    syncLotteryPoolDraftFromDialog();
    const sum = draft.prizes.reduce((total, prize) => total + Math.round(prize.weight * 100), 0);
    $("lotteryProbabilityTotal").textContent = `概率合计：${(sum / 100).toFixed(2)}% / 100%`;
  };
  $("addLotteryPrizeBtn").onclick = () => {
    syncLotteryPoolDraftFromDialog();
    draft.prizes.push({ id: `prize_${Date.now()}`, name: "", weight: 0, productIds: [draft.productId], imageUrl: "" });
    renderLotteryPoolDialog();
  };
  document.querySelectorAll("[data-remove-lottery-prize]").forEach((button) => button.onclick = () => {
    if (draft.prizes.length <= 1) return;
    syncLotteryPoolDraftFromDialog();
    draft.prizes.splice(Number(button.dataset.removeLotteryPrize), 1);
    renderLotteryPoolDialog();
  });
  document.querySelectorAll("[data-lottery-prize-weight]").forEach((input) => input.oninput = updateTotal);
  document.querySelectorAll("[data-lottery-prize-upload]").forEach((button) => button.onclick = () => document.querySelector(`[data-lottery-prize-image-file="${button.dataset.lotteryPrizeUpload}"]`).click());
  document.querySelectorAll("[data-lottery-prize-image-file]").forEach((input) => input.onchange = onLotteryPrizeImage);
  $("lotteryPoolForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("saveLotteryPoolBtn"), status = $("lotteryPoolSaveStatus");
    if (button.disabled) return;
    syncLotteryPoolDraftFromDialog();
    const product = workingConfig.products.find((item) => String(item.id) === draft.productId && item.lotteryEnabled);
    let error = !product ? "请选择已开启抽奖模式的商品" : "";
    if (draft.prizes.some((prize) => !prize.name.trim() || !prize.imageUrl)) error = "每个奖品都需要名称和图片";
    if (draft.prizes.some((prize) => !Number.isFinite(prize.weight) || prize.weight < .01 || prize.weight > 100 || Math.abs(prize.weight * 100 - Math.round(prize.weight * 100)) > 1e-6) || draft.prizes.reduce((sum, prize) => sum + Math.round(prize.weight * 100), 0) !== 10000) error = "中奖概率合计必须为 100%，每项至少 0.01%";
    if (error) { status.textContent = error; status.classList.add("is-error"); return; }
    const previousPools = clone(workingConfig.lotteryPools), previousProducts = clone(workingConfig.products);
    const candidate = { ...clone(draft), name: `${product.title || product.orderTitle}奖池` };
    const controls = [...document.querySelectorAll('.lottery-pool-dialog input, .lottery-pool-dialog select, .lottery-pool-dialog button')];
    const disabledStates = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    button.disabled = true; status.classList.remove("is-error"); status.textContent = "正在保存并同步商品...";
    try {
      workingConfig.lotteryPools = [...previousPools.filter((pool) => pool.id !== candidate.id), candidate];
      product.lotteryPoolId = candidate.id;
      const result = await publishLotteryPools();
      if (!result.ok) throw result.error || new Error("保存失败");
      lotteryPoolDraft = null;
      renderLotteryPoolManager("奖池保存成功，已同步到关联商品。");
    } catch (error) {
      workingConfig.lotteryPools = previousPools;
      workingConfig.products = previousProducts;
      status.textContent = error.message || "保存失败，请重试";
      status.classList.add("is-error"); button.disabled = false;
    } finally {
      controls.forEach((control, i) => { control.disabled = disabledStates[i]; });
    }
  };
  updateTotal();
}

async function onLotteryPrizeImage(event) {
  const input = event.currentTarget;
  const index = Number(input.dataset.lotteryPrizeImageFile);
  const file = input.files?.[0];
  if (!file || !lotteryPoolDraft?.prizes?.[index]) return;
  syncLotteryPoolDraftFromDialog();
  const draft = lotteryPoolDraft;
  const prize = draft.prizes[index];
  const merchantAccount = activeMerchant.account;
  const controls = [...document.querySelectorAll('.lottery-pool-dialog input, .lottery-pool-dialog select, .lottery-pool-dialog button')];
  const disabledStates = controls.map((control) => control.disabled);
  controls.forEach((control) => { control.disabled = true; });
  const button = document.querySelector(`[data-lottery-prize-upload="${index}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = "上传中";
  }
  try {
    const imageDataUrl = await imageFileToDataUrl(file, 1000, 0.88);
    const response = await fetch(`/api/merchant-assets/${encodeURIComponent(merchantAccount)}/lottery-prizes/${encodeURIComponent(prize.id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ imageDataUrl, fileName: file.name }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok || !result.asset) throw new Error(result.message || "奖品图片保存失败");
    if (lotteryPoolDraft !== draft || activeMerchant.account !== merchantAccount) return;
    prize.imageUrl = result.asset.url;
    prize.imageName = result.asset.fileName;
    prize.imagePath = result.asset.path;
    renderLotteryPoolDialog();
  } catch (error) {
    alert(error.message || "奖品图片上传失败");
    if (button) {
      button.disabled = false;
      button.textContent = "上传图片";
    }
  } finally {
    controls.forEach((control, i) => { control.disabled = disabledStates[i]; });
    input.value = "";
  }
}

function renderGameServerManager() {
  workingConfig.gameServers = normalizeGameServers(workingConfig.gameServers);
  workingConfig.categoryTree = normalizeCategoryTree(
    workingConfig.categoryTree || workingConfig.categories,
    workingConfig.gameServers,
  );
  $("pageContent").innerHTML = `<section class="panel game-server-manager">
    <div class="panel-head">
      <div><h2>游戏区服</h2><p class="hint">区服跟随大分类。该分类下的所有商品和订单，只会使用这里启用的区服。</p></div>
    </div>
    <div class="game-server-category-grid">
      ${workingConfig.categoryTree.map((group, groupIndex) => `<article class="category-server-card">
        <header>
          <div>
            <strong>${escapeHtml(group.name)}</strong>
            <small>${group.gameServers.filter((item) => item.enabled).length} 个区服正在用于该大分类的订单</small>
          </div>
        </header>
        <div class="category-create-row compact server-add-row">
          <input data-new-category-server="${groupIndex}" placeholder="例如：手机端、电脑端、苹果微信区" />
          <button data-add-category-server="${groupIndex}">添加区服</button>
        </div>
        <div class="data-list">
          ${group.gameServers.map((item, serverIndex) => `<div class="list-item">
            <div class="server-edit-main">
              <input data-category-server-name="${groupIndex}-${serverIndex}" value="${escapeHtml(item.name)}" />
              <small>${item.enabled ? "该分类下单时显示" : "已停用"}</small>
            </div>
            <div class="list-actions">
              <button data-toggle-category-server="${groupIndex}-${serverIndex}">${item.enabled ? "停用" : "启用"}</button>
              <button class="danger" data-delete-category-server="${groupIndex}-${serverIndex}">删除</button>
            </div>
          </div>`).join("")}
        </div>
      </article>`).join("")}
    </div>
  </section>`;

  const persistGameServerDraft = () => {
    workingConfig.categoryTree = normalizeCategoryTree(workingConfig.categoryTree, workingConfig.gameServers);
    workingConfig.categories = flattenCategoryTree(workingConfig.categoryTree);
    saveDraftConfig(activeMerchant.account, collectVisibleConfig());
  };

  const addGameServer = (groupIndex) => {
    const input = document.querySelector(`[data-new-category-server="${groupIndex}"]`);
    const name = input.value.trim();
    if (!name) return alert("请先输入区服名称");
    const group = workingConfig.categoryTree[groupIndex];
    if (group.gameServers.some((item) => item.name === name)) return alert("这个大分类中已经有同名区服");
    group.gameServers.push({ id: `server_${Date.now()}_${groupIndex}`, name, enabled: true });
    persistGameServerDraft();
    renderGameServerManager();
  };

  document.querySelectorAll("[data-add-category-server]").forEach((button) => {
    button.addEventListener("click", () => addGameServer(Number(button.dataset.addCategoryServer)));
  });
  document.querySelectorAll("[data-new-category-server]").forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") addGameServer(Number(input.dataset.newCategoryServer));
    });
  });
  document.querySelectorAll("[data-category-server-name]").forEach((input) => {
    input.addEventListener("change", () => {
      const [groupIndex, serverIndex] = input.dataset.categoryServerName.split("-").map(Number);
      const group = workingConfig.categoryTree[groupIndex];
      const name = input.value.trim();
      if (!name) {
        input.value = group.gameServers[serverIndex].name;
        return alert("区服名称不能为空");
      }
      if (group.gameServers.some((item, index) => index !== serverIndex && item.name === name)) {
        input.value = group.gameServers[serverIndex].name;
        return alert("这个大分类中已经有同名区服");
      }
      group.gameServers[serverIndex].name = name;
      persistGameServerDraft();
      renderGameServerManager();
    });
  });
  document.querySelectorAll("[data-toggle-category-server]").forEach((button) => {
    button.addEventListener("click", () => {
      const [groupIndex, serverIndex] = button.dataset.toggleCategoryServer.split("-").map(Number);
      const group = workingConfig.categoryTree[groupIndex];
      const server = group.gameServers[serverIndex];
      if (server.enabled && group.gameServers.filter((item) => item.enabled).length <= 1) {
        return alert("每个大分类至少启用一个区服");
      }
      server.enabled = !server.enabled;
      persistGameServerDraft();
      renderGameServerManager();
    });
  });
  document.querySelectorAll("[data-delete-category-server]").forEach((button) => {
    button.addEventListener("click", () => {
      const [groupIndex, serverIndex] = button.dataset.deleteCategoryServer.split("-").map(Number);
      const group = workingConfig.categoryTree[groupIndex];
      if (group.gameServers.length <= 1) return alert("每个大分类至少保留一个区服");
      group.gameServers.splice(serverIndex, 1);
      if (!group.gameServers.some((item) => item.enabled)) group.gameServers[0].enabled = true;
      persistGameServerDraft();
      renderGameServerManager();
    });
  });
}

function renderCategoryTreeManager() {
  const editorScrollTop = document.querySelector(".category-editor-backdrop .admin-detail-scroll")?.scrollTop || 0;
  document.querySelector(".category-editor-backdrop")?.remove();
  workingConfig.categoryTree = normalizeCategoryTree(workingConfig.categoryTree || workingConfig.categories);
  workingConfig.categories = flattenCategoryTree(workingConfig.categoryTree);
  const keyword = categoryManagerState.keyword.trim().toLowerCase();
  const visibleGroups = workingConfig.categoryTree
    .map((group, groupIndex) => ({ group, groupIndex }))
    .filter(({ group }) => {
      const searchable = [group.name, ...(group.children || [])].join(" ").toLowerCase();
      return !keyword || searchable.includes(keyword);
    });
  const editingGroupIndex = categoryManagerState.editingIndex;
  const editingGroup = editingGroupIndex >= 0 ? workingConfig.categoryTree[editingGroupIndex] : null;
  const renderCategoryEditor = (group, groupIndex) => `<div class="category-inline-editor">
    <div class="category-editor-grid">
      <label class="category-field"><span>大分类名称</span><input data-main-category-name="${groupIndex}" value="${escapeHtml(group.name)}" /></label>
      <label class="category-field"><span>前台显示</span>
        <select data-main-category-status="${groupIndex}">
          <option value="visible" ${group.status !== "hidden" ? "selected" : ""}>显示</option>
          <option value="hidden" ${group.status === "hidden" ? "selected" : ""}>隐藏</option>
        </select>
        <small>隐藏后客户看不到该分类</small>
      </label>
      <div class="category-image-row">
        <div class="category-image-preview ${group.imageUrl ? "has-image" : ""}">
          ${group.imageUrl ? `<img src="${group.imageUrl}" alt="${escapeHtml(group.name)}">` : "无图片"}
        </div>
        <div class="category-image-copy">
          <span>分类图片</span>
          <label class="category-image-upload">${group.imageUrl ? "更换" : "选择图片"}<input type="file" accept="image/*" data-main-category-image="${groupIndex}" /></label>
        </div>
      </div>
    </div>
    <div class="category-editor-section">
      <div class="category-editor-title"><strong>小分类</strong><span>共 ${(group.children || []).length} 个</span></div>
      <div class="sub-category-list">
        ${(group.children || []).map((child, childIndex) => `<span class="sub-category-chip"><input data-sub-category-name="${groupIndex}-${childIndex}" value="${escapeHtml(child)}" /><button type="button" title="删除小分类" data-delete-sub-category="${groupIndex}-${childIndex}">×</button></span>`).join("") || `<p class="hint">还没有小分类，先添加一个。</p>`}
      </div>
      <div class="category-create-row compact">
        <input data-new-sub-category="${groupIndex}" placeholder="输入小分类，例如 保底单" />
        <button type="button" data-add-sub-category="${groupIndex}">添加小分类</button>
      </div>
    </div>
  </div>`;
  $("pageContent").innerHTML = `<section class="panel category-manager">
    <div class="category-table-toolbar">
      <div class="category-toolbar-actions">
        <button type="button" class="category-action refresh" id="refreshCategoryBtn">刷新</button>
        <button type="button" class="category-action add" id="addMainCategoryBtn">新增</button>
        <button type="button" class="category-action edit" id="editSelectedCategoryBtn" ${categoryManagerSelection.size !== 1 ? "disabled" : ""}>编辑</button>
        <button type="button" class="category-action delete" id="deleteSelectedCategoryBtn" ${categoryManagerSelection.size === 0 ? "disabled" : ""}>删除</button>
        <button type="button" class="category-action servers" id="openCategoryServersBtn">区服配置</button>
        <span class="category-auto-save-note">修改后自动保存并同步前端</span>
      </div>
      <div class="category-search">
        <input id="categorySearchInput" value="${escapeHtml(categoryManagerState.keyword)}" placeholder="搜索大分类或小分类" />
        <button type="button" id="categorySearchBtn">搜索</button>
      </div>
    </div>
    ${categoryManagerState.creating ? `<div class="category-create-panel">
      <div>
        <strong>新增大分类</strong>
        <p class="hint">添加后可继续配置分类图片、小分类和游戏区服。</p>
      </div>
      <div class="category-create-row">
        <input id="newMainCategoryName" placeholder="输入大分类，例如 和平精英" />
        <button type="button" id="confirmMainCategoryBtn">确认添加</button>
        <button type="button" class="category-create-cancel" id="cancelMainCategoryBtn">取消</button>
      </div>
    </div>` : ""}
    <div class="category-drag-banner" role="status" aria-live="polite">
      <strong>正在拖动排序</strong>
      <span>移动到目标位置后松开</span>
    </div>
    <div class="category-table-wrap">
      <table class="category-data-table">
        <thead><tr>
          <th><input type="checkbox" id="selectVisibleCategories" aria-label="选择当前分类"></th>
          <th>ID</th><th>名称</th><th>图片</th><th>小分类</th><th>状态</th><th>游戏区服</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${visibleGroups.length ? visibleGroups.map(({ group, groupIndex }) => {
            const enabledServers = normalizeGameServers(group.gameServers).filter((server) => server.enabled).length;
            const isEditing = categoryManagerState.editingIndex === groupIndex;
            return `<tr class="category-data-row ${isEditing ? "is-editing" : ""}" data-category-row="${groupIndex}">
              <td><input type="checkbox" data-category-select="${groupIndex}" ${categoryManagerSelection.has(groupIndex) ? "checked" : ""} aria-label="选择${escapeHtml(group.name)}"></td>
              <td><span class="category-id">${groupIndex + 1}</span></td>
              <td><strong>${escapeHtml(group.name)}</strong><small>${(group.children || []).length} 个小分类</small></td>
              <td><div class="category-table-image ${group.imageUrl ? "has-image" : ""}">${group.imageUrl ? `<img src="${group.imageUrl}" alt="${escapeHtml(group.name)}">` : "无"}</div></td>
              <td><span class="category-count-badge">${(group.children || []).length}</span></td>
              <td><span class="category-visibility-status ${group.status === "hidden" ? "hidden" : "visible"}"><i></i>${group.status === "hidden" ? "隐藏" : "显示"}</span></td>
              <td><span class="category-server-status"><i></i>${enabledServers} 个启用</span></td>
              <td><div class="category-row-actions">
                <button type="button" class="category-drag-handle" data-category-drag-handle="${groupIndex}" draggable="true" aria-label="拖动排序：${escapeHtml(group.name)}" title="长按拖动排序">
                  <span class="category-drag-dots" aria-hidden="true">${"<i></i>".repeat(6)}</span>
                  <span class="category-drag-label">拖动</span>
                </button>
                <button type="button" class="edit" data-edit-main-category="${groupIndex}">${isEditing ? "关闭" : "编辑"}</button>
                <button type="button" class="delete" data-delete-main-category="${groupIndex}">删除</button>
              </div></td>
            </tr>`;
          }).join("") : `<tr><td class="category-empty-row" colspan="8">没有符合条件的分类</td></tr>`}
        </tbody>
      </table>
    </div>
    <footer class="category-table-footer">
      <span>共 ${workingConfig.categoryTree.length} 个大分类</span>
      <span id="categorySelectedCount">已选择 ${categoryManagerSelection.size} 项</span>
    </footer>
    ${editingGroup ? `<div class="category-editor-backdrop" data-category-editor-backdrop>
      <section class="category-editor-dialog admin-dialog admin-detail-page" role="dialog" aria-modal="true" aria-labelledby="categoryEditorTitle">
        <header class="category-editor-dialog-head">
          <div>
            <h3 id="categoryEditorTitle">编辑大分类</h3>
            <p>${escapeHtml(editingGroup.name)}</p>
          </div>
          <button type="button" class="category-editor-close" data-close-category-editor aria-label="关闭分类编辑" title="关闭">×</button>
        </header>
        <div class="admin-detail-scroll">${renderCategoryEditor(editingGroup, editingGroupIndex)}</div>
        <footer class="category-editor-dialog-footer">
          <button type="button" data-close-category-editor>完成</button>
        </footer>
      </section>
    </div>` : ""}
  </section>`;
  const editorBackdrop = document.querySelector("[data-category-editor-backdrop]");
  if (editorBackdrop) {
    document.body.appendChild(editorBackdrop);
    editorBackdrop.querySelector(".admin-detail-scroll").scrollTop = editorScrollTop;
  }
  document.body.classList.toggle("admin-detail-open", Boolean(editorBackdrop));

  const persistCategories = () => {
    workingConfig.categoryTree = normalizeCategoryTree(workingConfig.categoryTree);
    workingConfig.categories = flattenCategoryTree(workingConfig.categoryTree);
    const snapshot = saveDraftConfig(activeMerchant.account, collectVisibleConfig());
    publishCategories(snapshot).then((result) => {
      if (!result.ok) alert(result.error?.message || "分类保存同步失败，请检查服务后重试");
    });
  };
  const reorderCategory = (sourceIndex, targetIndex, insertAfter = false) => {
    if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) return false;
    const [movedCategory] = workingConfig.categoryTree.splice(sourceIndex, 1);
    let insertionIndex = targetIndex + (insertAfter ? 1 : 0);
    if (sourceIndex < insertionIndex) insertionIndex -= 1;
    workingConfig.categoryTree.splice(Math.max(0, insertionIndex), 0, movedCategory);
    categoryManagerSelection.clear();
    categoryManagerState.editingIndex = -1;
    persistCategories();
    return true;
  };
  let desktopDragSourceIndex = -1;
  const clearDesktopDragState = () => {
    desktopDragSourceIndex = -1;
    document.body.classList.remove("category-reordering");
    document.querySelectorAll(".category-drag-handle.is-active").forEach((button) => {
      button.classList.remove("is-active");
      const label = button.querySelector(".category-drag-label");
      if (label) label.textContent = "拖动";
    });
    document.querySelectorAll(".category-data-row.is-dragging, .category-data-row.drop-before, .category-data-row.drop-after").forEach((row) => row.classList.remove("is-dragging", "drop-before", "drop-after"));
  };
  const addMainCategory = () => {
    const input = $("newMainCategoryName");
    const name = input.value.trim();
    if (!name) return alert("请先输入大分类名称");
    if (workingConfig.categoryTree.some((item) => item.name === name)) return alert("这个大分类已存在");
    workingConfig.categoryTree.push({
      name,
      status: "visible",
      children: [],
      gameServers: clone(normalizeGameServers(workingConfig.gameServers)),
    });
    categoryManagerState.creating = false;
    categoryManagerState.editingIndex = workingConfig.categoryTree.length - 1;
    categoryManagerSelection.clear();
    categoryManagerSelection.add(categoryManagerState.editingIndex);
    persistCategories();
    renderCategoryTreeManager();
  };

  $("refreshCategoryBtn").addEventListener("click", renderCategoryTreeManager);
  $("addMainCategoryBtn").addEventListener("click", () => {
    categoryManagerState.creating = true;
    renderCategoryTreeManager();
    $("newMainCategoryName")?.focus();
  });
  $("cancelMainCategoryBtn")?.addEventListener("click", () => {
    categoryManagerState.creating = false;
    renderCategoryTreeManager();
  });
  $("confirmMainCategoryBtn")?.addEventListener("click", addMainCategory);
  $("newMainCategoryName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") addMainCategory();
  });
  const applyCategorySearch = () => {
    categoryManagerState.keyword = $("categorySearchInput").value;
    renderCategoryTreeManager();
  };
  $("categorySearchBtn").addEventListener("click", applyCategorySearch);
  $("categorySearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") applyCategorySearch();
  });
  $("openCategoryServersBtn").addEventListener("click", () => switchPage("游戏区服"));
  document.querySelectorAll("[data-category-select]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.categorySelect);
      if (input.checked) categoryManagerSelection.add(index);
      else categoryManagerSelection.delete(index);
      $("categorySelectedCount").textContent = `已选择 ${categoryManagerSelection.size} 项`;
      $("editSelectedCategoryBtn").disabled = categoryManagerSelection.size !== 1;
      $("deleteSelectedCategoryBtn").disabled = categoryManagerSelection.size === 0;
    });
  });
  $("selectVisibleCategories").addEventListener("change", (event) => {
    visibleGroups.forEach(({ groupIndex }) => {
      if (event.target.checked) categoryManagerSelection.add(groupIndex);
      else categoryManagerSelection.delete(groupIndex);
    });
    renderCategoryTreeManager();
  });
  $("editSelectedCategoryBtn").addEventListener("click", () => {
    if (categoryManagerSelection.size !== 1) return;
    categoryManagerState.editingIndex = [...categoryManagerSelection][0];
    renderCategoryTreeManager();
  });
  $("deleteSelectedCategoryBtn").addEventListener("click", () => {
    if (!categoryManagerSelection.size) return;
    if (workingConfig.categoryTree.length - categoryManagerSelection.size < 1) return alert("至少保留一个大分类");
    [...categoryManagerSelection].sort((a, b) => b - a).forEach((index) => workingConfig.categoryTree.splice(index, 1));
    categoryManagerSelection.clear();
    categoryManagerState.editingIndex = -1;
    persistCategories();
    renderCategoryTreeManager();
  });
  document.querySelectorAll("[data-edit-main-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.editMainCategory);
      categoryManagerState.editingIndex = categoryManagerState.editingIndex === index ? -1 : index;
      categoryManagerSelection.clear();
      if (categoryManagerState.editingIndex >= 0) categoryManagerSelection.add(index);
      renderCategoryTreeManager();
    });
  });
  const closeCategoryEditor = () => {
    categoryManagerState.editingIndex = -1;
    renderCategoryTreeManager();
  };
  document.querySelectorAll("[data-close-category-editor]").forEach((button) => {
    button.addEventListener("click", closeCategoryEditor);
  });
  const categoryEditorBackdrop = document.querySelector("[data-category-editor-backdrop]");
  categoryEditorBackdrop?.addEventListener("click", (event) => {
    if (event.target === categoryEditorBackdrop) closeCategoryEditor();
  });
  document.querySelectorAll("[data-category-drag-handle]").forEach((button) => {
    button.addEventListener("contextmenu", (event) => event.preventDefault());
    button.addEventListener("dragstart", (event) => {
      desktopDragSourceIndex = Number(button.dataset.categoryDragHandle);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(desktopDragSourceIndex));
      button.classList.add("is-active");
      const label = button.querySelector(".category-drag-label");
      if (label) label.textContent = "拖动中";
      button.closest("[data-category-row]")?.classList.add("is-dragging");
      document.body.classList.add("category-reordering");
    });
    button.addEventListener("dragend", clearDesktopDragState);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      const sourceIndex = Number(button.dataset.categoryDragHandle);
      const targetIndex = sourceIndex + (event.key === "ArrowUp" ? -1 : 1);
      if (targetIndex < 0 || targetIndex >= workingConfig.categoryTree.length) return;
      const [movedCategory] = workingConfig.categoryTree.splice(sourceIndex, 1);
      workingConfig.categoryTree.splice(targetIndex, 0, movedCategory);
      persistCategories();
      renderCategoryTreeManager();
      requestAnimationFrame(() => document.querySelector(`[data-category-drag-handle="${targetIndex}"]`)?.focus());
    });
    button.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      if (event.button != null && event.button !== 0) return;
      const sourceIndex = Number(button.dataset.categoryDragHandle);
      const sourceRow = button.closest("[data-category-row]");
      const startX = event.clientX;
      const startY = event.clientY;
      let active = false;
      let targetIndex = sourceIndex;
      let insertAfter = false;
      const clearDropMarkers = () => {
        document.querySelectorAll(".category-data-row.drop-before, .category-data-row.drop-after").forEach((row) => row.classList.remove("drop-before", "drop-after"));
      };
      const cleanup = () => {
        window.clearTimeout(holdTimer);
        button.classList.remove("is-arming", "is-active");
        const label = button.querySelector(".category-drag-label");
        if (label) label.textContent = "拖动";
        sourceRow?.classList.remove("is-dragging");
        document.body.classList.remove("category-reordering");
        clearDropMarkers();
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerCancel);
      };
      const onPointerMove = (moveEvent) => {
        if (!active) {
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > 8) cleanup();
          return;
        }
        moveEvent.preventDefault();
        const targetRow = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest("[data-category-row]");
        if (!targetRow) return;
        targetIndex = Number(targetRow.dataset.categoryRow);
        const rect = targetRow.getBoundingClientRect();
        insertAfter = moveEvent.clientY > rect.top + rect.height / 2;
        clearDropMarkers();
        if (targetIndex !== sourceIndex) targetRow.classList.add(insertAfter ? "drop-after" : "drop-before");
      };
      const onPointerUp = () => {
        const shouldRender = active && reorderCategory(sourceIndex, targetIndex, insertAfter);
        cleanup();
        if (shouldRender) renderCategoryTreeManager();
      };
      const onPointerCancel = () => cleanup();
      const holdTimer = window.setTimeout(() => {
        active = true;
        button.classList.remove("is-arming");
        button.classList.add("is-active");
        const label = button.querySelector(".category-drag-label");
        if (label) label.textContent = "拖动中";
        sourceRow?.classList.add("is-dragging");
        document.body.classList.add("category-reordering");
        button.setPointerCapture?.(event.pointerId);
      }, 300);
      button.classList.add("is-arming");
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    });
  });
  document.querySelectorAll("[data-category-row]").forEach((row) => {
    row.addEventListener("dragover", (event) => {
      if (desktopDragSourceIndex < 0) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const targetIndex = Number(row.dataset.categoryRow);
      const rect = row.getBoundingClientRect();
      const insertAfter = event.clientY > rect.top + rect.height / 2;
      document.querySelectorAll(".category-data-row.drop-before, .category-data-row.drop-after").forEach((item) => item.classList.remove("drop-before", "drop-after"));
      if (targetIndex !== desktopDragSourceIndex) row.classList.add(insertAfter ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", (event) => {
      if (desktopDragSourceIndex < 0) return;
      event.preventDefault();
      const sourceIndex = desktopDragSourceIndex;
      const targetIndex = Number(row.dataset.categoryRow);
      const rect = row.getBoundingClientRect();
      const insertAfter = event.clientY > rect.top + rect.height / 2;
      const shouldRender = reorderCategory(sourceIndex, targetIndex, insertAfter);
      clearDesktopDragState();
      if (shouldRender) renderCategoryTreeManager();
    });
  });
  document.querySelectorAll("[data-main-category-name]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.mainCategoryName);
      const oldName = workingConfig.categoryTree[index].name;
      const nextName = input.value.trim() || oldName;
      workingConfig.categoryTree[index].name = nextName;
      workingConfig.products.forEach((product) => {
        if (product.mainCategory === oldName) product.mainCategory = nextName;
      });
      persistCategories();
      renderCategoryTreeManager();
    });
  });
  document.querySelectorAll("[data-main-category-status]").forEach((input) => {
    input.addEventListener("change", () => {
      const index = Number(input.dataset.mainCategoryStatus);
      workingConfig.categoryTree[index].status = input.value === "hidden" ? "hidden" : "visible";
      persistCategories();
      renderCategoryTreeManager();
    });
  });
  document.querySelectorAll("[data-main-category-image]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const index = Number(input.dataset.mainCategoryImage);
      try {
        workingConfig.categoryTree[index].imageUrl = await imageFileToDataUrl(file, 900, 0.86);
        persistCategories();
        renderCategoryTreeManager();
      } catch (error) {
        alert(error.message);
      }
    });
  });
  document.querySelectorAll("[data-delete-main-category]").forEach((button) => {
    button.addEventListener("click", () => {
      if (workingConfig.categoryTree.length <= 1) return alert("至少保留一个大分类");
      const index = Number(button.dataset.deleteMainCategory);
      workingConfig.categoryTree.splice(index, 1);
      categoryManagerSelection.clear();
      categoryManagerState.editingIndex = -1;
      persistCategories();
      renderCategoryTreeManager();
    });
  });
  document.querySelectorAll("[data-sub-category-name]").forEach((input) => {
    input.addEventListener("change", () => {
      const [groupIndex, childIndex] = input.dataset.subCategoryName.split("-").map(Number);
      workingConfig.categoryTree[groupIndex].children[childIndex] = input.value.trim() || workingConfig.categoryTree[groupIndex].children[childIndex];
      persistCategories();
      renderCategoryTreeManager();
    });
  });
  document.querySelectorAll("[data-delete-sub-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const [groupIndex, childIndex] = button.dataset.deleteSubCategory.split("-").map(Number);
      workingConfig.categoryTree[groupIndex].children.splice(childIndex, 1);
      persistCategories();
      renderCategoryTreeManager();
    });
  });
  document.querySelectorAll("[data-add-sub-category]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupIndex = Number(button.dataset.addSubCategory);
      const input = document.querySelector(`[data-new-sub-category="${groupIndex}"]`);
      const name = input.value.trim();
      if (!name) return alert("请先输入小分类名称");
      const children = workingConfig.categoryTree[groupIndex].children || [];
      if (children.includes(name)) return alert("这个小分类已存在");
      workingConfig.categoryTree[groupIndex].children = [...children, name];
      persistCategories();
      renderCategoryTreeManager();
    });
  });
}

function renderActivityModule(page) {
  const features = workingConfig.activityFeatures || clone(defaultConfig.activityFeatures);
  const enabled = features[page] !== false;
  const rows = {
    "跳转配置": [
      ["首页 banner", "商品详情", enabled ? "已开启" : "已关闭"],
      ["客服按钮", "在线客服", enabled ? "已开启" : "已关闭"],
    ],
    "会话管理": [
      ["客户会话", "下单后自动创建客服会话", enabled ? "已开启" : "已关闭"],
      ["客服跟进", "可记录客服跟进状态", enabled ? "已开启" : "已关闭"],
    ],
    "聊天管理": [
      ["聊天入口", "前台客服聊天入口", enabled ? "已开启" : "已关闭"],
      ["消息提醒", "新消息后台提醒", enabled ? "已开启" : "已关闭"],
    ],
  }[page] || [];
  $("pageContent").innerHTML = `<section class="panel">
    <h2>活动功能开关</h2>
    <div class="switch-grid">
      ${Object.keys(defaultConfig.activityFeatures).map((name) => `<label><input type="checkbox" data-activity-feature="${name}" ${features[name] !== false ? "checked" : ""}> ${name}</label>`).join("")}
    </div>
    <p class="hint">商户可自行控制这些活动功能是否打开，关闭后对应入口按关闭状态处理。</p>
  </section>
  <section class="panel">
    <div class="panel-head"><h2>${page}</h2><span class="tag">${enabled ? "已开启" : "已关闭"}</span></div>
    <table><thead><tr><th>入口</th><th>功能说明</th><th>状态</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${row[0]}</td><td>${row[1]}</td><td><span class="tag">${row[2]}</span></td></tr>`).join("")}
    </tbody></table>
  </section>`;
  document.querySelectorAll("[data-activity-feature]").forEach((input) => {
    input.addEventListener("change", () => {
      workingConfig.activityFeatures = { ...features, [input.dataset.activityFeature]: input.checked };
      saveDraftConfig(activeMerchant.account, collectVisibleConfig());
      recordOperation("切换活动功能", `${input.dataset.activityFeature}：${input.checked ? "开启" : "关闭"}`);
      renderActivityModule(page);
    });
  });
}

function renderLogModule(page) {
  const logs = getOperationLogs();
  $("pageContent").innerHTML = `<section class="panel">
    <div class="panel-head">
      <div><h2>${page}</h2><p class="hint">实时记录当前商户后台的登录、页面访问、保存、审核、切换等操作，最新记录在最上方。</p></div>
      <div class="button-row"><button id="refreshLogsBtn">刷新日志</button><button class="danger" id="clearLogsBtn">清空日志</button></div>
    </div>
    <div class="log-summary">
      <div><span>当前日志</span><strong>${logs.length}</strong></div>
      <div><span>当前商户</span><strong>${activeMerchant.clubName}</strong></div>
      <div><span>当前操作人</span><strong>${session.account}</strong></div>
    </div>
    <table><thead><tr><th>时间</th><th>操作人</th><th>身份</th><th>商户</th><th>内容</th><th>详情</th><th>IP</th></tr></thead><tbody>
      ${logs.length ? logs.map((item) => `<tr><td>${item.time}</td><td>${item.operator}</td><td><span class="tag">${item.role}</span></td><td>${item.merchant}</td><td>${item.content}</td><td>${item.detail || "-"}</td><td>${item.ip}</td></tr>`).join("") : `<tr><td colspan="7">暂无操作日志。登录、打开页面、保存配置后会自动出现在这里。</td></tr>`}
    </tbody></table>
  </section>`;
  $("refreshLogsBtn").addEventListener("click", async () => {
    await syncOperationLogsFromServer();
    renderLogModule(page);
  });
  $("clearLogsBtn").addEventListener("click", () => {
    if (!confirm("确定清空当前商户的 PC 操作日志吗？")) return;
    saveOperationLogs([]);
    recordOperation("清空 PC 操作日志", activeMerchant.clubName);
    renderLogModule(page);
  });
}

function bindExportButtons() {
  document.querySelectorAll("[data-export]").forEach((button) => {
    button.addEventListener("click", () => {
      recordOperation("触发导出", button.dataset.export || "数据导出");
      alert("演示版已生成导出动作。正式版接数据库后可下载 Excel。");
    });
  });
}

$("loginBtn").addEventListener("click", () => login($("loginAccount").value.trim(), $("loginPassword").value.trim()));
$("loginPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("loginBtn").click();
});
$("logoutBtn").addEventListener("click", () => {
  stopLiveOrderTracker();
  recordOperation("退出登录", "手动退出后台");
  localStorage.removeItem(SESSION_KEY);
  fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  session = null;
  activeMerchant = null;
  showLogin();
});
$("saveBtn").addEventListener("click", async () => {
  if (!activeMerchant) return alert("请先选择商户");
  if ($("staffBondRequirement") && staffBondRequirementValue($("staffBondRequirement").value) === null) {
    $("staffBondRequirement").focus();
    return alert("接单保证金需为 0 至 1000000 元，最多两位小数");
  }
  $("saveBtn").disabled = true;
  const result = await saveMerchantConfig(activeMerchant.account, collectVisibleConfig());
  $("saveBtn").disabled = false;
  if (!result.ok) return alert(result.error?.message || "保存失败，请重新登录后台或检查预览服务。");
  workingConfig = result.config;
  recordOperation("点击顶部保存按钮", "保存并关联前端");
  const original = $("saveBtn").textContent;
  $("saveBtn").textContent = "已发布到前端";
  $("saveBtn").classList.add("saved");
  window.setTimeout(() => {
    $("saveBtn").textContent = original;
    $("saveBtn").classList.remove("saved");
  }, 1400);
  alert(`已保存 ${activeMerchant.clubName} 的配置，小程序刷新后生效。`);
});
$("menuSearch").addEventListener("input", renderMenu);

async function initAdmin() {
  await restoreSession();
}

initAdmin();
