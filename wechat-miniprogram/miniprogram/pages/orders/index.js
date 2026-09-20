const { money } = require("../../utils/data");
const api = require("../../services/api");
const { resolveAssetUrl } = require("../../utils/image");
const PAGE_SIZE = 10;
const ORDER_STATUSES = ["全部", "待付款", "待接单", "待开始", "服务中", "待结单", "已完成"];

// 订单进入这些状态就说明已经成立（覆盖不产生真实收款的虚拟单/赠送单），可以评价了。
const reviewSettledStatuses = ["待抽奖", "待接单", "待服务", "服务中", "已完成"];

// 订单上的评价状态（只用来决定画哪个按钮，不向客户展示"后台还在复核"的痕迹）：
//   ""           还不能评价（订单还没成立）
//   "todo"       可以评价，还没提交
//   "pending"    已提交 —— 客户看到的就和已放行一样（都是「已评价」）
//   "approved"   后台已放行，公开可见
//   "rejected"   后台未放行，客户可以改完重新提交（按钮叫「重新评价」，不给原因）
function reviewStateOf(order, mine) {
  if (mine) return String(mine.status || "pending");
  const settled = String(order.paymentStatus || "") === "paid" || reviewSettledStatuses.includes(String(order.status || ""));
  return settled ? "todo" : "";
}

// 按钮排布规格（用户 2026-09-20：「每个状态都给主操作，其他状态同理」）。
// 每个订单**恰好一个**主操作：先确定优先级，再按参考图显示在按钮行右侧。
// 为什么放在这里而不是散在 wxml 的 wx:if 里：模板里看不出某个状态到底会出几个主操作，
// 加个新状态就漏。这个函数由 orders-page.test.cjs 逐状态钉住（每个状态必须正好一个）。
// 顺序＝优先级：多个条件同时成立时取靠前的（如「待付款+有抽奖」以付款为先）。
const PRIMARY_ACTIONS = [
  ["pay", (order) => order.paymentStatus === "pending"],
  ["openLottery", (order) => order.paymentStatus === "paid" && order.lottery && order.lottery.status === "pending"],
  ["confirmOrder", (order) => order.status === "待结单"],
  ["buyAgain", (order) => order.status === "已完成" || order.paymentStatus === "cancelled"],
  ["openChat", (order) => Boolean(order.canChat)],
  // 兜底：没有别的可做时（待接单等打手接单），进去看进度就是这一单该点的事。
  ["openDetail", () => true],
];
function primaryActionOf(order) {
  const hit = PRIMARY_ACTIONS.find(([, matches]) => matches(order));
  return (hit || PRIMARY_ACTIONS[PRIMARY_ACTIONS.length - 1])[0];
}

Page({
  data: {
    loading: true,
    refreshing: false,
    orders: [],
    active: "全部",
    statuses: ORDER_STATUSES,
    visibleOrders: [],
    visibleCount: PAGE_SIZE,
    hasMore: false,
    matchedCount: 0,
    serviceVisible: false,
    serviceOrder: null,
    complaintVisible: false,
    complaintOrder: null,
    complaintText: "",
    complaintSubmitting: false,
    cancellingNo: "",
    confirmingNo: "",
    chatVisible: false,
    chatOrder: null,
    chatMessages: [],
    chatInput: "",
    reviewVisible: false,
    reviewOrder: null,
    reviewRating: 5,
    reviewContent: "",
    reviewSubmitting: false,
    ratingOptions: [1, 2, 3, 4, 5]
  },
  onShow() {
    clearInterval(this.orderTimer);
    this.orderTimer = setInterval(() => { if (!this.data.chatVisible && !this.data.reviewVisible && !this.data.serviceVisible && !this.data.complaintVisible) this.load(); }, 5000);
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 2 });
    const requestedStatus = wx.getStorageSync("club_order_status_filter");
    if (this.data.statuses.includes(requestedStatus)) {
      this.setData({ active: requestedStatus, visibleCount: PAGE_SIZE });
      wx.removeStorageSync("club_order_status_filter");
    }
    this.load();
  },
  onPullDownRefresh() { Promise.resolve(this.onScrollRefresh()).finally(() => wx.stopPullDownRefresh()); },
  onScrollRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    return this.load().finally(() => this.setData({ refreshing: false }));
  },
  onHide() { clearInterval(this.orderTimer); this.orderRequestId = (this.orderRequestId || 0) + 1; },
  onUnload() { clearInterval(this.orderTimer); this.orderRequestId = (this.orderRequestId || 0) + 1; },
  async load() {
    const requestId = this.orderRequestId = (this.orderRequestId || 0) + 1;
    const app = getApp();
    const account = app.globalData.merchantAccount;
    try {
      const orders = (await app.loadOrders()).map((item) => {
        const status = ["待服务", "待抽奖"].includes(item.status) ? "待接单" : item.status === "进行中" ? "服务中" : item.status;
        const view = {
          ...item,
          status,
          canChat: Boolean(item.staffId),
          productImage: resolveAssetUrl(item.productImage || "", app.globalData.apiBaseUrl),
          priceText: money(item.price),
          paidText: money(["paid", "refund_pending", "refund_closed", "refunded"].includes(item.paymentStatus) ? item.price : 0),
          paymentLabel: item.paymentStatus === "refunded" ? "已退款" : item.paymentStatus === "refund_pending" ? item.status : item.paymentStatus === "refund_closed" ? "退款失败" : item.paymentStatus === "pending" ? "待付款" : "实付款",
          originalText: Number(item.displayPrice || 0) * Number(item.quantity || 1) > Number(item.price || 0)
            ? money(Number(item.displayPrice) * Number(item.quantity || 1)) : ""
        };
        view.primaryAction = primaryActionOf(view);
        return view;
      });
      const [unread, myReviews] = await Promise.all([
        api.getChatUnread(account, "boss", orders.map((item) => item.no)).catch(() => ({})),
        api.getMyReviews(account).catch(() => [])
      ]);
      const reviewByOrder = {};
      myReviews.forEach((item) => { reviewByOrder[String(item.orderNo || "")] = item; });
      orders.forEach((item) => {
        item.chatUnread = unread[item.no] || 0;
        const mine = reviewByOrder[String(item.no)];
        item.reviewState = reviewStateOf(item, mine);
        item.rejectReason = mine ? String(mine.rejectReason || "") : "";
        item.myReviewContent = mine ? String(mine.content || "") : "";
        // 「已评价 ★★★★★」按用户 2026-09-17 要求拆两段上色：点亮的星橙色、没点亮的星白色。
        // 未点亮那段在白色卡片上等于看不见，只为占住 5 颗的宽度，所以不点亮的订单看着就只显示点亮的。
        const litStars = mine ? Math.min(5, Math.max(1, Number(mine.rating) || 5)) : 0;
        item.reviewStars = mine ? "★★★★★".slice(0, litStars) : "";
        item.reviewStarsEmpty = mine ? "★★★★★".slice(litStars) : "";
      });
      if (requestId !== this.orderRequestId || account !== getApp().globalData.merchantAccount) return;
      this.setData({ loading: false, orders }, () => this.applyFilter());
    } catch (error) {
      if (requestId !== this.orderRequestId || account !== getApp().globalData.merchantAccount) return;
      this.setData({ loading: false });
      wx.showToast({ title: error.message, icon: "none" });
    }
  },
  choose(event) { this.setData({ active: event.currentTarget.dataset.status }, () => this.applyFilter(true)); },
  noop() {},
  openReview(event) {
    const order = this.data.orders.find((item) => item.no === event.currentTarget.dataset.no);
    if (!order) return;
    this.setData({
      reviewVisible: true,
      reviewOrder: order,
      reviewRating: 5,
      // 未放行的评价把原来写的内容带回来，客户改一改就能重新提交
      reviewContent: order.reviewState === "rejected" ? String(order.myReviewContent || "") : "",
      reviewSubmitting: false
    });
  },
  closeReview() { this.setData({ reviewVisible: false, reviewOrder: null, reviewContent: "", reviewSubmitting: false }); },
  chooseRating(event) { this.setData({ reviewRating: Number(event.currentTarget.dataset.value) || 5 }); },
  onReviewInput(event) { this.setData({ reviewContent: event.detail.value }); },
  async submitReview() {
    const order = this.data.reviewOrder;
    if (!order || this.data.reviewSubmitting) return;
    const content = String(this.data.reviewContent || "").trim();
    if (content.length < 2) return wx.showToast({ title: "至少写 2 个字", icon: "none" });
    this.setData({ reviewSubmitting: true });
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      await api.submitReview(app.globalData.merchantAccount, {
        orderNo: order.no,
        rating: this.data.reviewRating,
        content
      });
      this.setData({ reviewVisible: false, reviewOrder: null, reviewContent: "", reviewSubmitting: false });
      // 提示语固定写死、不读服务端 message：不向客户暴露后台还要复核一道（用户 2026-09-17 要求）。
      wx.showToast({ title: "评价已提交，感谢你的评价", icon: "none" });
      this.load();
    } catch (error) {
      this.setData({ reviewSubmitting: false });
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    }
  },
  openDetail(event) { wx.navigateTo({ url: `/pages/order-detail/index?no=${encodeURIComponent(event.currentTarget.dataset.no)}` }); },
  pay(event) { wx.navigateTo({ url: `/pages/submit/index?no=${encodeURIComponent(event.currentTarget.dataset.no)}` }); },
  applyServerOrder(order) {
    this.orderRequestId = (this.orderRequestId || 0) + 1;
    const status = ["待服务", "待抽奖"].includes(order.status) ? "待接单" : order.status === "进行中" ? "服务中" : order.status;
    const orders = this.data.orders.map((item) => {
      if (item.no !== order.no) return item;
      const view = {
        ...item, ...order, status, canChat: Boolean(order.staffId),
        paidText: money(["paid", "refund_pending", "refund_closed", "refunded"].includes(order.paymentStatus) ? order.price : 0),
        paymentLabel: order.paymentStatus === "refunded" ? "已退款" : order.paymentStatus === "refund_pending" ? order.status : order.paymentStatus === "refund_closed" ? "退款失败" : order.paymentStatus === "pending" ? "待付款" : "实付款",
        reviewState: ["cancelled", "refund_pending", "refunded"].includes(order.paymentStatus) ? "" : item.reviewState
      };
      // 状态变了主操作也跟着变（待结单 → 已完成就从「确认结单」换成「再次购买」）。
      view.primaryAction = primaryActionOf(view);
      return view;
    });
    this.setData({ orders }, () => this.applyFilter());
  },
  cancelOrder(event) {
    const order = this.data.orders.find((item) => item.no === event.currentTarget.dataset.no);
    if (!order || order.paymentStatus !== "pending" || this.data.cancellingNo) return;
    this.setData({ cancellingNo: order.no });
    wx.showModal({ title: "取消订单", content: "确定取消这笔待付款订单吗？", success: async ({ confirm }) => {
      if (!confirm) return this.setData({ cancellingNo: "" });
      const app = getApp();
      const account = app.globalData.merchantAccount;
      try {
        await app.ensureCustomerIdentity();
        const result = await api.cancelOrder(account, order.no);
        if (account !== getApp().globalData.merchantAccount) return;
        if (!result.order) throw new Error("订单取消结果不完整，请刷新查看");
        this.applyServerOrder(result.order);
        wx.showToast({ title: "订单已取消", icon: "success" });
        this.load();
      } catch (error) { wx.showToast({ title: error.message || "取消失败", icon: "none" }); }
      finally { this.setData({ cancellingNo: "" }); }
    }, fail: () => this.setData({ cancellingNo: "" }) });
  },
  previewCancelOrder() { wx.showToast({ title: "取消功能暂未开放", icon: "none" }); },
  // 老板端「确认结单」：订单停在「待结单」（打手已上传结单截图）时，由下单老板确认收尾。
  // 确认后订单进「已完成」，打手佣金在这一刻入账 —— 所以要二次确认，别让误触结单。
  confirmOrder(event) {
    const order = this.data.orders.find((item) => item.no === event.currentTarget.dataset.no);
    if (!order || order.status !== "待结单" || this.data.confirmingNo) return;
    this.setData({ confirmingNo: order.no });
    wx.showModal({
      title: "确认结单",
      content: "确认打手已完成本次服务？确认后订单完成，无法撤销。",
      success: async ({ confirm }) => {
        if (!confirm) return this.setData({ confirmingNo: "" });
        const app = getApp();
        const account = app.globalData.merchantAccount;
        try {
          await app.ensureCustomerIdentity();
          const result = await api.confirmOrder(account, order.no);
          if (account !== getApp().globalData.merchantAccount) return;
          if (!result.order) throw new Error("结单结果不完整，请刷新查看");
          this.applyServerOrder(result.order);
          wx.showToast({ title: "订单已完成", icon: "success" });
          this.load();
        } catch (error) { wx.showToast({ title: error.message || "结单失败", icon: "none" }); }
        finally { this.setData({ confirmingNo: "" }); }
      },
      fail: () => this.setData({ confirmingNo: "" })
    });
  },
  openComplaint(event) {
    const order = this.data.orders.find((item) => item.no === event.currentTarget.dataset.no);
    if (order && order.paymentStatus !== "cancelled") this.setData({ complaintVisible: true, complaintOrder: order, complaintText: "" });
  },
  closeComplaint() {
    if (!this.data.complaintSubmitting) this.setData({ complaintVisible: false, complaintOrder: null, complaintText: "" });
  },
  onComplaintInput(event) { this.setData({ complaintText: event.detail.value }); },
  async submitComplaint() {
    const order = this.data.complaintOrder;
    if (!order || order.complaint || this.data.complaintSubmitting) return;
    const content = String(this.data.complaintText || "").trim();
    if (content.length < 5) return wx.showToast({ title: "请至少填写 5 个字", icon: "none" });
    const app = getApp();
    const account = app.globalData.merchantAccount;
    this.setData({ complaintSubmitting: true });
    try {
      await app.ensureCustomerIdentity();
      const result = await api.submitOrderComplaint(account, order.no, content);
      if (account !== getApp().globalData.merchantAccount) return;
      if (!result.order?.complaint) throw new Error("投诉结果不完整，请刷新查看");
      this.applyServerOrder(result.order);
      this.setData({ complaintOrder: result.order, complaintText: "" });
      wx.showToast({ title: "投诉已提交", icon: "success" });
    } catch (error) { wx.showToast({ title: error.message || "提交失败", icon: "none" }); }
    finally { this.setData({ complaintSubmitting: false }); }
  },
  copy(event) { wx.setClipboardData({ data: event.currentTarget.dataset.no }); },
  buyAgain(event) { wx.navigateTo({ url: `/pages/submit/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  goGoodsDetail(event) {
    const order = this.data.orders.find((item) => item.no === event.currentTarget.dataset.no);
    if (!order) return;
    const product = (getApp().globalData.config?.products || []).find((item) => String(item.id) === String(order.productId));
    const url = product && product.status === "visible"
      ? `/pages/detail/index?id=${encodeURIComponent(order.productId)}`
      : `/pages/order-detail/index?no=${encodeURIComponent(order.no)}`;
    wx.navigateTo({ url });
  },
  showServiceDetail(event) {
    const order = this.data.orders.find((item) => item.no === event.currentTarget.dataset.no);
    if (order) this.setData({ serviceVisible: true, serviceOrder: order });
  },
  closeServiceDetail() { this.setData({ serviceVisible: false, serviceOrder: null }); },
  openLottery(event) { wx.navigateTo({ url: `/pages/order-detail/index?no=${encodeURIComponent(event.currentTarget.dataset.no)}&draw=1` }); },
  applyFilter(reset = false) {
    const matched = this.data.orders.filter((item) => this.data.active === "全部" || item.status === this.data.active);
    const visibleCount = reset ? PAGE_SIZE : this.data.visibleCount;
    this.setData({ visibleCount, matchedCount: matched.length, hasMore: matched.length > visibleCount,
      visibleOrders: matched.slice(0, visibleCount) });
  },
  loadMore() {
    if (!this.data.hasMore) return;
    this.setData({ visibleCount: this.data.visibleCount + PAGE_SIZE }, () => this.applyFilter());
  },
  async openChat(event) {
    const orderNo = event.currentTarget.dataset.no;
    const order = this.data.orders.find((item) => item.no === orderNo);
    if (!order) return;
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const result = await api.getOrderChat(app.globalData.merchantAccount, order.no, {
        role: "boss"
      });
      this.setData({
        chatVisible: true,
        chatOrder: order,
        chatMessages: result.messages || [],
        orders: this.data.orders.map((item) => item.no === order.no ? { ...item, chatUnread: 0 } : item)
      }, () => this.applyFilter());
    } catch (error) {
      wx.showToast({ title: error.message || "无法打开聊天", icon: "none" });
    }
  },
  closeChat() {
    this.setData({ chatVisible: false, chatOrder: null, chatMessages: [], chatInput: "" });
    this.load();
  },
  onChatInput(event) {
    this.setData({ chatInput: event.detail.value });
  },
  async sendChat() {
    const text = this.data.chatInput.trim();
    const order = this.data.chatOrder;
    if (!text || !order) return;
    this.setData({ chatInput: "" });
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const result = await api.sendOrderChat(app.globalData.merchantAccount, order.no, {
        role: "boss",
        text
      });
      this.setData({ chatMessages: result.messages || [] });
    } catch (error) {
      wx.showToast({ title: error.message || "发送失败", icon: "none" });
    }
  }
});
