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
//   mode="demo"   是本机演示（不付钱直接到账），只有开发环境才可能出现。
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

function getStaffOrders(account) {
  return request(`/api/public/orders/${encodeURIComponent(account)}?scope=staff&t=${Date.now()}`)
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

module.exports = {
  configure,
  getConfig,
  getConfigMeta,
  createOrder,
  payOrder,
  cancelOrder,
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
  createStewardCode
};
