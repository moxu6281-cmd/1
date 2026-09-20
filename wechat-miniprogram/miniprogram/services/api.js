let getRuntime = () => ({ apiBaseUrl: "", merchantAccount: "club001", customerToken: "" });
let relogin = null;

function configure(provider, reloginHandler) {
  getRuntime = provider;
  relogin = typeof reloginHandler === "function" ? reloginHandler : null;
}

function rawRequest(path, options = {}) {
  const runtime = getRuntime();
  const header = { "content-type": "application/json", ...(options.header || {}) };
  // Every authenticated call carries the server-issued session token; the server
  // ignores any customer/staff id sent in the body or URL and trusts the token.
  if (runtime.customerToken) header["X-Customer-Token"] = runtime.customerToken;
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${runtime.apiBaseUrl}${path}`,
      method: options.method || "GET",
      data: options.data,
      timeout: 12000,
      header,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data);
        const error = new Error(response.data?.message || `请求失败（${response.statusCode}）`);
        error.statusCode = response.statusCode;
        error.code = response.data?.code || "";
        reject(error);
      },
      fail(error) {
        reject(new Error(error.errMsg || "无法连接俱乐部服务器"));
      }
    });
  });
}

async function request(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (error) {
    // Token expired or revoked: re-login once through WeChat and retry the call.
    if ((error.statusCode === 401 || error.code === "AUTH_REQUIRED") && relogin && !options._retried) {
      await relogin();
      return rawRequest(path, { ...options, _retried: true });
    }
    throw error;
  }
}

function getConfig(account) {
  return request(`/api/public/config/${encodeURIComponent(account)}?t=${Date.now()}`, {
    header: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache"
    }
  });
}

// Cheap version probe: lets the owner app notice an admin config change and refresh
// the storefront without re-downloading the whole config payload.
function getConfigMeta(account) {
  return request(`/api/public/config/${encodeURIComponent(account)}/meta?t=${Date.now()}`)
    .then((result) => (result && result.ok === true ? `${Number(result.version || 0)}.${Number(result.updatedAt || 0)}` : ""))
    .catch(() => "");
}

function createOrder(account, order, checkoutOnly = false) {
  return request(`/api/public/orders/${encodeURIComponent(account)}`, { method: "POST", data: { order, checkoutOnly } });
}

function payOrder(account, orderNo, paymentMethod) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/pay`, { method: "POST", data: { paymentMethod } });
}

function cancelOrder(account, orderNo) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/cancel`, { method: "POST", data: {} });
}

// 老板端「确认结单」：打手上传结单截图后订单停在「待结单」，由下单老板确认收尾。
// 和商户后台的结单是同一个收尾（订单进已完成 + 打手佣金入账），只是操作人记客户。
function confirmOrder(account, orderNo) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/confirm`, { method: "POST", data: {} });
}

function submitOrderComplaint(account, orderNo, content) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/complaint`, { method: "POST", data: { content } });
}

function staffOrderAction(account, orderNo, action, imageDataUrl) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/${action}`, { method: "POST", data: { imageDataUrl } });
}

function getWallet(account, customerId) {
  return request(`/api/public/wallets/${encodeURIComponent(account)}/${encodeURIComponent(customerId || "me")}?t=${Date.now()}`)
    .then((result) => result && result.wallet ? result.wallet : { balance: 0 });
}

// 充值返回 { mode, wallet, payment?, tradeNo? }：
//   mode="wechat" 时 payment 是 wx.requestPayment 需要的参数，付款结果以 confirmPayment 为准；
//   mode="direct" 是服务端直连到账（开发/演示环境，不经过微信支付）。
function rechargeWallet(account, customerId, amount) {
  return request(`/api/public/wallets/${encodeURIComponent(account)}/${encodeURIComponent(customerId || "me")}/recharge`, {
    method: "POST",
    data: { amount, note: "客户小程序充值" }
  });
}

// 主动向微信查单：回调可能延迟或丢失，付完钱立刻确认一次，避免"付了却显示没到账"。
function confirmPayment(account, tradeNo) {
  return request(`/api/public/payments/${encodeURIComponent(account)}/${encodeURIComponent(tradeNo)}/confirm`, {
    method: "POST",
    data: {}
  });
}

function drawLottery(account, orderNo, drawIndex) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/lottery/draw`, {
    method: "POST",
    data: { drawIndex }
  });
}

function getOrderDetail(account, orderNo) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}`).then((result) => result.order);
}

function loginCustomer(code, legacyCustomerId, account) {
  // The login call itself must not trigger the 401 retry loop.
  return rawRequest("/api/public/customer/session", {
    method: "POST",
    data: { code, customerId: legacyCustomerId || "", account: account || "" }
  }).then((result) => ({ customer: result && result.customer, token: result && result.token, staffGranted: result && result.staffGranted === true }));
}

function getOrders(account) {
  return request(`/api/public/orders/${encodeURIComponent(account)}?t=${Date.now()}`)
    .then((result) => Array.isArray(result?.orders) ? result.orders : []);
}

// options.q = 搜索词，交给服务端做模糊匹配（多关键词 AND、大小写不敏感）。
// 不传就是全量列表；服务端只过滤「我的订单」，接单大厅不受影响。
function getStaffOrders(account, options = {}) {
  const keyword = String(options.q || "").trim();
  const search = keyword ? `&q=${encodeURIComponent(keyword)}` : "";
  return request(`/api/public/orders/${encodeURIComponent(account)}?scope=staff${search}&t=${Date.now()}`)
    .then((result) => Array.isArray(result?.orders) ? result.orders : []);
}

function acceptStaffOrder(account, orderNo) {
  return request(`/api/public/orders/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}/accept`, {
    method: "POST",
    data: {}
  }).then((result) => result && result.order ? result.order : null);
}

function getRecentBroadcasts(account) {
  return request(`/api/public/broadcasts/${encodeURIComponent(account)}?t=${Date.now()}`)
    .then((result) => Array.isArray(result && result.broadcasts) ? result.broadcasts : []);
}

function getConversations(account, role = "boss") {
  return request(`/api/public/conversations/${encodeURIComponent(account)}?role=${role}`);
}

function getChatUnread(account, role, orderNos) {
  return request(`/api/public/order-chat/${encodeURIComponent(account)}`, {
    method: "POST",
    data: { role, orderNos }
  }).then((result) => result && result.unread ? result.unread : {});
}

function getOrderChat(account, orderNo, actor) {
  const params = Object.keys(actor || {})
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(actor[key])}`)
    .join("&");
  return request(`/api/public/order-chat/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}?${params}`);
}

function sendOrderChat(account, orderNo, payload) {
  return request(`/api/public/order-chat/${encodeURIComponent(account)}/${encodeURIComponent(orderNo)}`, {
    method: "POST",
    data: payload
  });
}

function getStaffGrant(account) {
  return request(`/api/public/customer/grant/${encodeURIComponent(account)}?t=${Date.now()}`)
    .then((result) => result && result.staffGranted === true);
}

// 自己提交过的评价（含"待审核/已通过/已驳回"），用来在订单列表里显示评价状态。
// 店铺前台展示的已通过评价不走这里——它们随公开配置一起下发（config.reviews）。
function getMyReviews(account) {
  return request(`/api/public/reviews/${encodeURIComponent(account)}?scope=mine&t=${Date.now()}`)
    .then((result) => (Array.isArray(result?.reviews) ? result.reviews : []));
}

// 提交订单评价。服务端会核对「这个订单确实属于当前登录客户」，提交后是待审核状态。
function submitReview(account, payload) {
  return request(`/api/public/reviews/${encodeURIComponent(account)}`, {
    method: "POST",
    data: payload
  });
}

// Nickname is self-chosen; the numeric ID stays the unique, unchangeable handle.
function updateCustomerProfile(displayName) {
  return request("/api/public/customer/profile", {
    method: "POST",
    data: { displayName }
  }).then((result) => (result && result.customer ? result.customer : null));
}

// 管事：我的管事身份 / 上级管事 / 我的邀请码 / 我的下级打手。
// 服务端只认会话令牌，客户端不传任何 id。
function getSteward(account) {
  return request(`/api/public/steward/${encodeURIComponent(account)}?t=${Date.now()}`)
    .then((result) => (result && result.ok ? result : { isSteward: false, myCode: "", superior: null, subordinates: [] }));
}

// 用邀请码兑换：后台发的码 → 本人升级为管事；管事发的码 → 成为该管事的下级打手。
function redeemStewardCode(account, code) {
  return request(`/api/public/steward/${encodeURIComponent(account)}/redeem`, {
    method: "POST",
    data: { code }
  });
}

// 管事生成一张新的下级邀请码（一次性）。
function createStewardCode(account) {
  return request(`/api/public/steward/${encodeURIComponent(account)}/codes`, { method: "POST", data: {} })
    .then((result) => (result && result.code ? String(result.code) : ""));
}

// 提现：进页配置 + 本人可用金额 + 本人手续费档位。身份（打手/用户）由服务端判。
// ⚠️ 每次进提现页都要重新拉一次（不能长期缓存）—— 最低提现额/开放渠道/说明文案都是商户后台随时可调的运营值。
function getWithdrawPage(account) {
  return request(`/api/public/withdraw/${encodeURIComponent(account)}?t=${Date.now()}`);
}

// 提交提现。只传金额、渠道和收款信息；手续费与身份判定一律以服务端为准。
function submitWithdraw(account, payload) {
  return request(`/api/public/withdraw/${encodeURIComponent(account)}`, { method: "POST", data: payload });
}

// 提现记录（收入 + 提现合并下发，前端按 kind 分 tab）。
function getWithdrawRecords(account) {
  return request(`/api/public/withdraw/${encodeURIComponent(account)}/records?t=${Date.now()}`)
    .then((result) => (Array.isArray(result?.items) ? result.items : []));
}

// ── 资金指标（打手端「我的账单」）────────────────────────────────────────────
// 契约来自《资金指标开发提示词》：**业务成功码是 `code === 1`，不是 0**。
// 本项目 HTTP 层本来用状态码表达成败（非 2xx 会被 rawRequest 抛错），所以在这一层统一翻译：
//   成功 → { code: 1, data }
//   失败 → { code: 0, msg }
// 页面于是可以完全照提示词写：`const r = await api.thugMsg(account); if (r.code !== 1) { toast(r.msg); return }`。
// ⚠️ 身份一律由服务端从会话令牌判 —— 提示词里 thugMsg 要传 thug_id，那是原版后端的口径；
//    这里不传任何 id，免得改个 id 就能看别人的账。
function asContract(promise, pick) {
  return promise
    .then((result) => ({ code: 1, data: pick ? pick(result) : result }))
    .catch((error) => ({ code: 0, msg: (error && error.message) || "加载失败" }));
}

// 8 格资金指标。服务端聚合好的最终值，前端零计算。
function thugMsg(account) {
  return asContract(
    request(`/api/public/funds/${encodeURIComponent(account)}?t=${Date.now()}`),
    // 响应里没有 funds 就当没拿到（回 null），别回一个空对象 —— 页面靠 null 区分
    // 「查不到（显示 —）」和「真的是 0（显示 0.00）」。
    (result) => (result && result.funds) || null
  );
}

// 保证金充值。目前服务端不接真实支付（项目要全面接入虚拟支付），
// 返回 mode='direct' 代表已经直接到账，不需要 wx.requestPayment。
function thugBond(account, payload) {
  return asContract(
    request(`/api/public/funds/${encodeURIComponent(account)}/bond`, { method: "POST", data: payload || {} })
  );
}

// 罚单列表。params: { status, page, limit }；status -1 全部 / 0 待缴 / 1 已缴 / 2 已撤销，limit 固定 15。
function fineList(account, params = {}) {
  const query = [
    `status=${encodeURIComponent(params.status == null ? -1 : params.status)}`,
    `page=${encodeURIComponent(params.page || 1)}`,
    `limit=${encodeURIComponent(params.limit || 15)}`
  ].join("&");
  return asContract(
    request(`/api/public/fines/${encodeURIComponent(account)}?${query}&t=${Date.now()}`),
    (result) => ({
      list: Array.isArray(result && result.list) ? result.list : [],
      // 罚款模块自己的待缴合计（提示词 6.1），和服务端 8 格里的 fine_unpaid_total 同源。
      unpaid_total: Number((result && result.unpaid_total) || 0)
    })
  );
}

// 缴纳罚单。服务端从「可用佣金」扣，客户端不传金额、不传身份。
function finePay(account, payload) {
  return asContract(
    request(`/api/public/fines/${encodeURIComponent(account)}/pay`, { method: "POST", data: payload || {} })
  );
}

// 佣金流水。params: { page, limit }。
function getStaffRanking(account, limit = 20) {
  return request(`/api/public/staff-ranking/${encodeURIComponent(account)}?limit=${encodeURIComponent(limit)}&t=${Date.now()}`)
    .then((result) => (Array.isArray(result && result.ranking) ? result.ranking : []));
}

function thugCommissionLog(account, params = {}) {
  const query = `page=${encodeURIComponent(params.page || 1)}&limit=${encodeURIComponent(params.limit || 15)}`;
  return asContract(
    request(`/api/public/commission-log/${encodeURIComponent(account)}?${query}&t=${Date.now()}`),
    (result) => (Array.isArray(result && result.list) ? result.list : [])
  );
}

module.exports = {
  configure,
  getConfig,
  getConfigMeta,
  createOrder,
  payOrder,
  cancelOrder,
  confirmOrder,
  submitOrderComplaint,
  staffOrderAction,
  getWallet,
  rechargeWallet,
  confirmPayment,
  drawLottery,
  getOrderDetail,
  getOrders,
  getStaffOrders,
  acceptStaffOrder,
  loginCustomer,
  getStaffGrant,
  getMyReviews,
  submitReview,
  updateCustomerProfile,
  getRecentBroadcasts,
  getChatUnread,
  getConversations,
  getOrderChat,
  sendOrderChat,
  getSteward,
  redeemStewardCode,
  createStewardCode,
  getWithdrawPage,
  submitWithdraw,
  getWithdrawRecords,
  thugMsg,
  thugBond,
  fineList,
  finePay,
  thugCommissionLog,
  getStaffRanking
};
