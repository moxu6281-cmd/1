const env = require("./config/env");
const api = require("./services/api");
const { prepareConfigImages } = require("./utils/image");

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => result && result.code ? resolve(result.code) : reject(new Error("微信登录凭证获取失败")),
      fail: () => reject(new Error("微信登录失败，请检查网络后重试"))
    });
  });
}

App({
  globalData: {
    merchantAccount: env.merchantAccount,
    apiBaseUrl: env.apiBaseUrl,
    customerId: "",
    customerToken: "",
    customer: null,
    customerReady: null,
    config: null,
    configLoadedAt: 0,
    configError: ""
  },

  onLaunch() {
    const ext = typeof wx.getExtConfigSync === "function" ? wx.getExtConfigSync() : {};
    if (ext && ext.merchantAccount) this.globalData.merchantAccount = ext.merchantAccount;
    if (ext && ext.apiBaseUrl) this.globalData.apiBaseUrl = String(ext.apiBaseUrl).replace(/\/$/, "");
    // The locally stored id is only kept as a migration hint so the server can bind
    // historical orders/wallet data to the real WeChat identity on first login.
    this.globalData.customerId = wx.getStorageSync("club_customer_id") || "";
    this.globalData.customerToken = wx.getStorageSync("club_customer_token") || "";
    api.configure(
      () => this.globalData,
      () => this.ensureCustomerIdentity(true)
    );
    this.ensureCustomerIdentity().catch(() => {});
  },

  async ensureCustomerIdentity(force = false) {
    if (!force && this.globalData.customer && this.globalData.customerToken) return this.globalData.customer;
    if (!force && this.globalData.customerReady) return this.globalData.customerReady;
    const task = (async () => {
      try {
        const code = await wxLogin();
        const result = await api.loginCustomer(code, this.globalData.customerId, this.globalData.merchantAccount);
        const customer = result && result.customer;
        if (!customer || !customer.displayName || !customer.numericId || !result.token) {
          throw new Error("用户身份数据无效");
        }
        customer.staffGranted = result.staffGranted === true;
        this.globalData.customer = customer;
        this.globalData.customerId = customer.customerId;
        this.globalData.customerToken = result.token;
        wx.setStorageSync("club_customer_id", customer.customerId);
        wx.setStorageSync("club_customer_token", result.token);
        wx.setStorageSync("club_customer_profile", customer);
        wx.setStorageSync("club_owner_name", customer.displayName);
        wx.setStorageSync("club_user_numeric_id", customer.numericId);
        return customer;
      } catch (error) {
        this.globalData.configError = error.message || "登录失败";
        throw error;
      } finally {
        this.globalData.customerReady = null;
      }
    })();
    this.globalData.customerReady = task;
    return task;
  },

  async loadConfig(force = false) {
    const age = Date.now() - this.globalData.configLoadedAt;
    if (!force && this.globalData.config && age < 10000) return this.globalData.config;
    let raw;
    try {
      raw = await api.getConfig(this.globalData.merchantAccount);
      this.globalData.configError = "";
    } catch (error) {
      // 不使用任何本地兜底/示例配置：取不到商户数据就明确报错，不拿假数据顶上。
      this.globalData.configError = error.message || "无法连接俱乐部服务器";
      throw error;
    }
    const config = await prepareConfigImages(raw || {}, this.globalData.apiBaseUrl);
    this.globalData.config = config;
    this.globalData.configLoadedAt = Date.now();
    return config;
  },

  async loadOrders() {
    await this.ensureCustomerIdentity();
    return api.getOrders(this.globalData.merchantAccount);
  }
});
