const api = require("../../services/api");
const { payAndConfirm } = require("../../utils/pay");
const {
  money,
  productView,
  isProductCategoryVisible,
  serversForProduct,
  orderUnitPrice
} = require("../../utils/data");

Page({
  data: {
    loading: true, submitting: false, productId: "", product: null, quantity: 1, servers: [], serverIndex: 0,
    gameName: "", gameId: "", receiveMode: "随机匹配", remark: "",
    displayPrice: 0, payPrice: 0, increasePrice: 0, total: 0,
    displayPriceText: "0", payPriceText: "0", increasePriceText: "0", totalText: "0",
    walletBalance: 0, walletBalanceText: "0.00", paymentMethod: "wechat",
    paymentVisible: false, paymentConfirmed: true, paymentExpired: false, paymentCountdown: "10:00", balanceShortfallText: "0.00"
  },

  onLoad(options) {
    if (options.no) { this.resumePending(options.no); return; }
    this.setData({ productId: String(options.id || "") });
    this.loadProduct(true);
  },
  onShow() {
    if (this.data.paymentVisible) {
      if (!this.paymentCompleted) this.startPaymentCountdown();
      return;
    }
    if (this.data.product && !this.data.submitting) this.loadProduct(true);
  },
  onHide() { this.clearPaymentTimer(); },
  async loadProduct(force) {
    try {
      const config = await getApp().loadConfig(force);
      const source = (config.products || []).find((item) => String(item.id) === this.data.productId);
      const product = productView(source);
      if (!source || product.status !== "visible" || !isProductCategoryVisible(config, product)) {
        throw new Error("商品不存在或已下架");
      }
      const displayPrice = Math.max(0, Number(product.price || 0));
      const payPrice = orderUnitPrice(product);
      const servers = serversForProduct(config, product);
      let walletBalance = 0;
      if (!getApp().globalData.previewFallback) {
        const customer = await getApp().ensureCustomerIdentity();
        const wallet = await api.getWallet(getApp().globalData.merchantAccount, customer.customerId);
        walletBalance = Number(wallet.balance || 0);
      }
      // 区服列表可能被商户后台改短，选中下标要跟着收口，否则分段按钮会一个都不高亮，
      // 下单时 servers[serverIndex] 还会是 undefined。
      const serverList = servers.length ? servers : ["手机端", "电脑端"];
      this.setData({
        loading: false, product, config, servers: serverList,
        serverIndex: Math.min(Number(this.data.serverIndex) || 0, serverList.length - 1), displayPrice, payPrice,
        increasePrice: Math.max(0, Number((payPrice - displayPrice).toFixed(2))), total: payPrice,
        displayPriceText: money(displayPrice), payPriceText: money(payPrice),
        increasePriceText: money(Math.max(0, payPrice - displayPrice)), totalText: money(payPrice),
        walletBalance, walletBalanceText: money(walletBalance)
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showModal({ title: "无法提交", content: error.message, showCancel: false });
    }
  },

  noop() {},
  inputName(event) { this.setData({ gameName: event.detail.value }); },
  inputId(event) { this.setData({ gameId: event.detail.value }); },
  inputRemark(event) { this.setData({ remark: event.detail.value }); },
  chooseServer(event) { this.setData({ serverIndex: Number(event.currentTarget.dataset.index) }); },
  chooseMode(event) { this.setData({ receiveMode: event.currentTarget.dataset.mode }); },
  choosePayment(event) {
    if (this.data.submitting || this.expirePayment()) return;
    this.setData({ paymentMethod: event.currentTarget.dataset.method });
  },
  async resumePending(no) {
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const order = await api.getOrderDetail(app.globalData.merchantAccount, no);
      if (order.paymentStatus !== "pending") throw new Error("订单已支付或已取消");
      const wallet = await api.getWallet(app.globalData.merchantAccount);
      this.setData({ loading: false, product: { id: order.productId, title: order.product }, quantity: order.quantity, gameName: order.gameName, gameId: order.gameId, remark: order.remark, servers: [order.server], serverIndex: 0, total: order.price, totalText: money(order.price), walletBalance: Number(wallet.balance || 0), walletBalanceText: money(wallet.balance || 0) });
      await this.openPayment(order);
    } catch (error) { this.setData({ loading: false }); wx.showModal({ title: "无法继续支付", content: error.message, showCancel: false }); }
  },
  async openPayment(existing) {
    if (this.data.submitting) return;
    if (!this.data.gameName.trim() || !this.data.gameId.trim()) {
      return wx.showToast({ title: "请填写游戏昵称和 ID", icon: "none" });
    }
    this.setData({ submitting: true });
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const order = existing?.no ? existing : (await api.createOrder(app.globalData.merchantAccount, {
        no: `DD${Date.now()}${Math.random().toString(36).slice(2, 8)}`, productId: String(this.data.product.id), quantity: this.data.quantity,
        gameName: this.data.gameName.trim(), gameId: this.data.gameId.trim(), server: this.data.servers[this.data.serverIndex],
        receiveMode: this.data.receiveMode, remark: this.data.remark.trim()
      }, true)).order;
      if (!order || order.paymentStatus !== "pending") throw new Error("订单状态已变化，请刷新订单列表");
      this.pendingOrder = order;
      this.paymentExpiresAt = order.paymentExpiresAt;
      this.setData({ total: order.price, totalText: money(order.price) });
    } catch (error) { wx.showModal({ title: "下单失败", content: error.message, showCancel: false }); return; }
    finally { this.setData({ submitting: false }); }
    this.paymentCompleted = false;
    this.setData({
      paymentVisible: true,
      paymentMethod: this.pendingOrder.paymentMethod || "wechat",
      paymentConfirmed: true,
      paymentExpired: false,
      paymentCountdown: "10:00",
      balanceShortfallText: money(Math.max(0, this.data.total - this.data.walletBalance))
    });
    wx.setNavigationBarTitle({ title: "确认支付" });
    this.startPaymentCountdown();
  },
  closePayment() {
    if (this.data.submitting) return;
    this.clearPaymentTimer();
    this.paymentExpiresAt = 0;
    this.setData({ paymentVisible: false, paymentExpired: false });
    wx.setNavigationBarTitle({ title: "提交订单" });
  },
  togglePaymentConfirmed() {
    if (this.data.submitting || this.expirePayment()) return;
    this.setData({ paymentConfirmed: !this.data.paymentConfirmed });
  },
  expirePayment() {
    if (!this.data.paymentVisible || this.data.submitting || this.paymentCompleted
      || Date.now() < this.paymentExpiresAt) return false;
    this.closePayment();
    this.setData({ paymentExpired: true, paymentCountdown: "00:00" });
    wx.showModal({ title: "支付超时", content: "10 分钟内未提交付款，本次下单已取消，请重新下单。", showCancel: false });
    return true;
  },
  clearPaymentTimer() {
    if (this.paymentTimer) clearInterval(this.paymentTimer);
    this.paymentTimer = null;
  },
  startPaymentCountdown() {
    this.clearPaymentTimer();
    if (!this.data.paymentVisible || this.paymentCompleted) return;
    const expiresAt = this.paymentExpiresAt;
    const render = () => {
      const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      const paymentCountdown = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      this.setData({ paymentCountdown, paymentExpired: seconds === 0 });
      if (!seconds) {
        this.clearPaymentTimer();
        this.expirePayment();
      }
    };
    this.paymentTimer = setInterval(render, 1000);
    render();
  },
  recharge() {
    if (this.data.submitting || this.expirePayment()) return;
    wx.showActionSheet({
      itemList: ["充值 ¥50", "充值 ¥100", "充值 ¥200", "充值 ¥500"],
      success: async ({ tapIndex }) => {
        const amount = [50, 100, 200, 500][tapIndex];
        try {
          const app = getApp();
          const customer = await app.ensureCustomerIdentity();
          const account = app.globalData.merchantAccount;
          const result = await api.rechargeWallet(account, customer.customerId, amount);
          const outcome = await payAndConfirm(api, account, result);
          if (!outcome.paid) {
            if (!outcome.cancelled) wx.showModal({ title: "支付结果确认中", content: outcome.message || "稍后在余额里刷新即可", showCancel: false });
            return;
          }
          const wallet = outcome.wallet || (await api.getWallet(account, customer.customerId));
          const walletBalance = Number((wallet && wallet.balance) || 0);
          this.setData({ walletBalance, walletBalanceText: money(walletBalance), balanceShortfallText: money(Math.max(0, this.data.total - walletBalance)) });
          wx.showToast({ title: "充值成功", icon: "success" });
        } catch (error) {
          wx.showModal({ title: "充值失败", content: error.message, showCancel: false });
        }
      }
    });
  },
  minus() { if (this.data.quantity > 1) this.updateQuantity(this.data.quantity - 1); },
  plus() { if (this.data.quantity < 99) this.updateQuantity(this.data.quantity + 1); },
  updateQuantity(quantity) {
    const total = Number((this.data.payPrice * quantity).toFixed(2));
    this.setData({ quantity, total, totalText: money(total), balanceShortfallText: money(Math.max(0, total - this.data.walletBalance)) });
  },

  onUnload() { this.clearPaymentTimer(); },

  async submit() {
    if (this.data.submitting || this.paymentCompleted || this.expirePayment()) return;
    if (!this.data.paymentVisible || !this.data.paymentConfirmed || this.data.paymentExpired) return;
    if (!this.data.gameName.trim() || !this.data.gameId.trim()) {
      return wx.showToast({ title: "请填写游戏昵称和 ID", icon: "none" });
    }
    const app = getApp();
    if (app.globalData.previewFallback) {
      wx.showModal({
        title: "本地预览模式",
        content: "当前只展示本地示例，订单不会写入商户后台。接通正式 HTTPS 接口后即可真实下单。",
        showCancel: false
      });
      return;
    }
    this.setData({ submitting: true });
    try {
      await app.ensureCustomerIdentity();
      if (Date.now() >= this.paymentExpiresAt) throw new Error("支付已超时，本次下单已取消");
      const account = app.globalData.merchantAccount;
      if (!this.pendingOrder) throw new Error("待付款订单不存在，请重新下单");
      const result = await api.payOrder(account, this.pendingOrder.no, this.data.paymentMethod);
      let savedOrder = result.order;
      // 微信支付：服务端返回 requestPayment 参数 → 调起微信收银台 → 主动查单确认到账。
      // 没确认到账就不算下单成功，订单保持"待付款"留在订单列表里。
      if (result && result.payment) {
        const outcome = await payAndConfirm(api, account, result);
        if (outcome.order) savedOrder = outcome.order;
        if (!outcome.paid) {
          this.setData({ submitting: false });
          if (outcome.cancelled) {
            wx.showToast({ title: "已取消支付，订单已保留为待付款", icon: "none" });
          } else {
            wx.showModal({ title: "支付结果确认中", content: outcome.message || "稍后在订单列表刷新即可", showCancel: false });
          }
          return;
        }
      }
      if (savedOrder?.paymentStatus !== "paid") throw new Error("支付尚未确认，订单保留为待付款");
      this.paymentCompleted = true;
      this.clearPaymentTimer();
      if (savedOrder.paymentMethod === "balance") {
        const balance = Number(savedOrder.balanceAfter || 0);
        this.setData({ walletBalance: balance, walletBalanceText: money(balance) });
      }
      this.setData({ submitting: false });
      wx.redirectTo({ url: `/pages/order-detail/index?no=${encodeURIComponent(savedOrder.no)}&draw=1` });
    } catch (error) {
      this.setData({ submitting: false });
      if (!this.expirePayment()) wx.showModal({ title: "提交失败", content: error.message, showCancel: false });
    }
  }
});
