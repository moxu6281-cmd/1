const api = require("../../services/api");
const { statuses, tabs, features, dashboard, filterOrders } = require('./view-model');

// 工作台自动同步节奏：5 秒足够让「接单池」及时冒出新单，又不会把接口打爆。
// 配合下面的静默同步（silent），轮询期间页面完全不闪。
const SYNC_INTERVAL = 5000;

// 提现手续费的说明文字：取商户在后台「分销管理」里设的「打手提现手续费（总）」。
// 这只是给打手看的一句提示（提现链路还没接通），不参与算钱——真正的结算由服务端
// 用 shared.js 的 resolveWithdrawFee 解析。所以这里不重复实现继承/覆盖逻辑。
function withdrawFeeLabel(config) {
  const staff = (config && config.withdrawFee && config.withdrawFee.staff) || {};
  const value = Number(staff.value || 0);
  return staff.mode === 'amount' ? `${value} 元/笔` : `${value}%`;
}

// 打手身份就是他自己微信登录出来的 customer id，服务端再核对商户侧的开通记录，
// 服务端授权才是准入依据；本地身份开关只决定页面入口。
Page({
  data: {
    activeTab: 'home', feature: '', tabs, features, statuses,
    activeStatus: '全部', activeGame: '', keyword: '', visibleOrders: [],
    profile: { name: '加载中', numericId: '', avatarUrl: '', granted: false },
    // 管事：isSteward / myCode / superior / subordinates，全部来自服务端。
    steward: { isSteward: false, myCode: '', superior: null, subordinates: [] },
    // 提现手续费文案（商户在后台「分销管理」里配，只作说明用——提现链路还没接通）。
    withdrawFeeText: '0%',
    games: [], stats: [], unreadCount: 0, error: '', ready: false,
    identityVisible: false, detailOrder: null, sending: false,
    loading: true,
    acceptingNo: "",
    pendingOrders: [],
    myTasks: [],
    pendingCount: 0,
    doingCount: 0,
    chatVisible: false,
    chatOrder: null,
    chatMessages: [],
    chatInput: ""
  },
  onShow() {
    this.active = true;
    this.showRevision = (this.showRevision || 0) + 1;
    this.load();
    clearInterval(this.orderTimer);
    // 5 秒轮询走静默同步：不置 loading、不弹错误、数据没变就不 setData。
    // 之前这里是无差别 `this.load()`，而 load() 一上来就 setData({ loading: true })，
    // 模板里 `wx:if="{{loading}}"` 的「正在同步工作台...」会插到统计卡和「接单池」之间，
    // 把下面整块内容往下顶、数据回来再弹回去 —— 用户看到的「呆几秒突然刷新一次」就是这个。
    this.orderTimer = setInterval(() => {
      if (this.data.chatVisible) { this.refreshChat(); return; }
      if (this.data.acceptingNo) return;
      this.load({ silent: true });
    }, SYNC_INTERVAL);
  },
  onHide() { this.active = false; this.showRevision = (this.showRevision || 0) + 1; this.chatSequence = (this.chatSequence || 0) + 1; this.setData({ sending: false }); clearInterval(this.orderTimer); },
  onUnload() { this.onHide(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  // silent = true：5 秒轮询、以及接单/结单后的自动刷新都走这条。
  // 静默的含义有三层：① 不置 loading（不插那行提示、不顶内容）；② 出错不弹 toast
  // （网络抖一下不该每 5 秒骚扰一次，下一轮会自愈）；③ 数据和上一轮逐字节相同就一个字段都不动，
  // 页面彻底静止（连 wx:for 的 diff 都不做）。
  async load({ silent = false } = {}) {
    if (this.syncing) {
      await this.syncing;
      if (this.active && this.loadedRevision !== this.showRevision) return this.load({ silent });
      return;
    }
    const revision = this.showRevision;
    if (!silent) this.setData({ loading: true });
    this.syncing = (async () => {
      try {
        const app = getApp();
        const customer = await app.ensureCustomerIdentity();
        // 用带缓存的版本（app 侧本来就有 10 秒缓存）。之前写死 force=true，
        // 等于每 5 秒白拉一次 70 多 KB 的全量配置。
        const config = await app.loadConfig();
        if (!this.active || revision !== this.showRevision) return;
        if (wx.getStorageSync("club_active_identity") !== "staff") {
          wx.showToast({ title: "请先切换打手身份", icon: "none" });
          this.setData({ loading: false, ready: false, pendingOrders: [], myTasks: [], visibleOrders: [] });
          wx.switchTab({ url: '/pages/mine/index' });
          return;
        }
        const account = app.globalData.merchantAccount;
        let orders;
        try {
          orders = await api.getStaffOrders(account);
        } catch (error) {
          if (!this.active || revision !== this.showRevision) return;
          if (error.code === "STAFF_FORBIDDEN") {
            this.chatSequence = (this.chatSequence || 0) + 1;
            this.renderedSnapshot = null;
            this.setData({ loading: false, ready: false, pendingOrders: [], myTasks: [], visibleOrders: [], chatVisible: false, detailOrder: null });
            wx.showModal({ title: "打手权限未开通", content: "请把“我的”页面的数字 ID 发给商户，由商户后台开通打手权限。", showCancel: false });
            wx.switchTab({ url: '/pages/mine/index' });
            return;
          }
          throw error;
        }
        const myId = customer.customerId;
        const tasks = orders.filter((order) => order.staffId === myId);
        const unread = await api.getChatUnread(account, "staff", tasks.map((item) => item.no)).catch(() => ({}));
        // 管事身份、我的邀请码、上级和下级都取服务端真实数据；接口不通时退回"不是管事"的空壳，
        // 不让工作台本身跟着崩。抽成比例是商户后台配置的值（不是编的）。
        const steward = await api.getSteward(account).catch(() => null);
        if (!this.active || revision !== this.showRevision) return;
        this.loadedRevision = revision;
        const next = {
          loading: false, ready: true, error: '',
          profile: { name: customer.displayName, numericId: customer.numericId,
            avatarUrl: wx.getStorageSync('club_owner_avatar') || '', granted: true },
          steward: steward || { isSteward: false, myCode: '', superior: null, subordinates: [] },
          withdrawFeeText: withdrawFeeLabel(config),
          ...dashboard(orders, customer, config, app.globalData.apiBaseUrl, unread)
        };
        const snapshot = JSON.stringify(next);
        if (silent && snapshot === this.renderedSnapshot) return;
        this.renderedSnapshot = snapshot;
        this.setData({ ...next, visibleOrders: filterOrders({ ...this.data, ...next }) });
      } catch (error) {
        if (!silent && this.active && revision === this.showRevision) {
          this.renderedSnapshot = null;
          this.setData({ loading: false, error: error.message || '工作台加载失败' });
          wx.showToast({ title: error.message || "工作台加载失败", icon: "none" });
        }
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  },
  backToMine() { wx.navigateBack(); },
  retry() { this.load(); },
  // —— 管事三件事：兑换邀请码成为管事 / 复制我的邀请码 / 生成下级邀请码 ——
  async redeemSteward() {
    const input = await new Promise((resolve) => {
      wx.showModal({
        title: '输入管事邀请码',
        editable: true,
        placeholderText: '例如 7K3M9QRT',
        success: (res) => resolve(res.confirm ? String(res.content || '').trim() : null),
        fail: () => resolve(null)
      });
    });
    if (input === null) return;
    if (!input) return wx.showToast({ title: '请先输入邀请码', icon: 'none' });
    const account = getApp().globalData.merchantAccount;
    wx.showLoading({ title: '兑换中', mask: true });
    try {
      const result = await api.redeemStewardCode(account, input);
      wx.hideLoading();
      wx.showModal({
        title: result.kind === 'steward' ? '已成为管事' : '已加入上级管事',
        content: result.kind === 'steward'
          ? '你现在是管事，可以把「我的邀请码」发给打手，让他成为你的下级。'
          : '你已成为这位管事的下级打手。',
        showCancel: false
      });
      await this.load();
    } catch (error) {
      wx.hideLoading();
      wx.showModal({ title: '兑换失败', content: error.message || '请核对邀请码后重试', showCancel: false });
    }
  },
  copyStewardCode() {
    const code = (this.data.steward && this.data.steward.myCode) || '';
    if (!code) return wx.showToast({ title: '邀请码还没生成出来', icon: 'none' });
    wx.setClipboardData({ data: code });
  },
  async generateStewardCode() {
    const account = getApp().globalData.merchantAccount;
    wx.showLoading({ title: '生成中', mask: true });
    try {
      const code = await api.createStewardCode(account);
      wx.hideLoading();
      wx.showModal({
        title: '新的下级邀请码',
        content: `${code}\n\n一次性使用。发给打手，他输入后就会成为你的下级。`,
        confirmText: '复制',
        success: (res) => { if (res.confirm) wx.setClipboardData({ data: code }); }
      });
      await this.load();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || '生成失败', icon: 'none' });
    }
  },
  chooseTab(event) {
    const activeTab = event.currentTarget.dataset.tab;
    if (!tabs.some(tab => tab.id === activeTab)) return;
    this.setData({ activeTab, feature: '', keyword: '', activeStatus: '全部', activeGame: '' }, () => this.filter());
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  filter() { this.setData({ visibleOrders: filterOrders(this.data) }); },
  search(event) { this.setData({ keyword: event.detail.value }, () => this.filter()); },
  chooseStatus(event) {
    const status = event.currentTarget.dataset.status;
    if (status === '协助单') return this.showFeature('assistance');
    if (!statuses.includes(status)) return;
    this.setData({ activeTab: 'orders', activeStatus: status, keyword: '', feature: '' }, () => this.filter());
  },
  chooseGame(event) {
    this.setData({ activeTab: 'hall', activeGame: event.currentTarget.dataset.game || '', keyword: '' }, () => this.filter());
  },
  openFeature(event) { this.showFeature(event.currentTarget?.dataset?.feature || event.detail); },
  showFeature(feature) {
    if (feature === 'identity') return this.setData({ identityVisible: true });
    if (feature === 'orders') return this.chooseStatus({ currentTarget: { dataset: { status: '全部' } } });
    this.setData({ feature });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  closeFeature() { this.setData({ feature: '' }); },
  closeIdentity() { this.setData({ identityVisible: false }); },
  unavailable() { wx.showModal({ title: '暂未接通', content: '该功能尚未接通业务接口，当前不会提交资料、变更接单状态或产生资金操作。', showCancel: false }); },
  copyOrder(event) { wx.setClipboardData({ data: String(event.currentTarget.dataset.no || '') }); },
  openDetail(event) {
    const order = [...this.data.pendingOrders, ...this.data.myTasks].find(item => item.no === event.currentTarget.dataset.no);
    if (order) this.setData({ detailOrder: order });
  },
  closeDetail() { this.setData({ detailOrder: null }); },
  // 反向身份切换：切回老板身份并回到「我的」页。存的还是同一个值，和「我的」页那格共用
  // `club_active_identity`；切换后立即 showToast（toast 是全局的，跨 tab 不会丢）。
  switchToBoss() {
    this.active = false;
    clearInterval(this.orderTimer);
    wx.setStorageSync("club_active_identity", "boss");
    wx.showToast({ title: "已切换回老板身份", icon: "success" });
    wx.switchTab({ url: "/pages/mine/index" });
  },
  async startOrder(event) { await this.performOrderAction(event.currentTarget.dataset.no, 'start'); },
  uploadProof(event) {
    const no = event.currentTarget.dataset.no;
    if (this.data.acceptingNo || !this.data.ready || !this.active) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], success: async (result) => {
      try {
        const file = result.tempFiles[0];
        if (file.size > 2 * 1024 * 1024) throw new Error('截图请控制在 2MB 以内');
        const data = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: file.tempFilePath, encoding: 'base64', success: (res) => resolve(res.data), fail: reject }));
        const type = data.startsWith('/9j/') ? 'jpeg' : data.startsWith('iVBOR') ? 'png' : data.startsWith('UklGR') ? 'webp' : '';
        if (!type) throw new Error('请上传 JPG、PNG 或 WebP 图片');
        await this.performOrderAction(no, 'submit-proof', `data:image/${type};base64,${data}`);
      } catch (error) { wx.showToast({ title: error.message || '读取截图失败', icon: 'none' }); }
    } });
  },
  async performOrderAction(no, action, imageDataUrl) {
    if (!no || this.data.acceptingNo || !this.data.ready || !this.active) return;
    this.setData({ acceptingNo: no });
    try {
      await api.staffOrderAction(getApp().globalData.merchantAccount, no, action, imageDataUrl);
      wx.showToast({ title: action === 'start' ? '服务已开始' : '已提交结单', icon: 'success' });
      await this.load({ silent: true });
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    finally { this.setData({ acceptingNo: '' }); }
  },
  async acceptOrder(event) {
    const orderNo = event.currentTarget.dataset.no;
    if (!orderNo || this.data.acceptingNo || !this.data.ready || !this.active) return;
    this.setData({ acceptingNo: orderNo });
    try {
      const app = getApp();
      await api.acceptStaffOrder(app.globalData.merchantAccount, orderNo);
      wx.showToast({ title: "接单成功", icon: "success" });
      await this.load({ silent: true });
      this.chooseStatus({ currentTarget: { dataset: { status: '待开始' } } });
    } catch (error) {
      wx.showToast({ title: error.message || "接单失败", icon: "none" });
    } finally {
      this.setData({ acceptingNo: "" });
    }
  },
  async openChat(event) {
    const order = this.data.myTasks.find((item) => item.no === event.currentTarget.dataset.no);
    if (!order) return;
    const sequence = this.chatSequence = (this.chatSequence || 0) + 1;
    try {
      const app = getApp();
      const result = await api.getOrderChat(app.globalData.merchantAccount, order.no, { role: "staff" });
      if (!this.active || sequence !== this.chatSequence) return;
      this.chatSnapshot = JSON.stringify(result.messages || []);
      this.setData({ chatVisible: true, chatOrder: order, chatMessages: result.messages || [], chatInput: '', sending: false });
    } catch (error) {
      wx.showToast({ title: error.message || "无法打开聊天", icon: "none" });
    }
  },
  // 关掉聊天后同步一次，同样走静默：聊天面板刚收起，别再插一行提示把列表顶一下。
  closeChat() { this.chatSequence = (this.chatSequence || 0) + 1; this.setData({ chatVisible: false, chatOrder: null, chatMessages: [], chatInput: "", sending: false }); this.load({ silent: true }); },
  async refreshChat() {
    const order = this.data.chatOrder, sequence = this.chatSequence;
    if (!order || this.readingChat || this.data.sending || !this.active) return;
    this.readingChat = true;
    try {
      const result = await api.getOrderChat(getApp().globalData.merchantAccount, order.no, { role: 'staff' });
      if (!this.active || this.chatSequence !== sequence || this.data.sending) return;
      const snapshot = JSON.stringify(result.messages || []);
      if (snapshot !== this.chatSnapshot) {
        this.chatSnapshot = snapshot;
        this.setData({ chatMessages: result.messages || [] });
      }
    } catch { /* 静默重试，不清空已有消息。 */ }
    finally { this.readingChat = false; }
  },
  onChatInput(event) { this.setData({ chatInput: event.detail.value }); },
  async sendChat() {
    const text = this.data.chatInput.trim();
    const order = this.data.chatOrder;
    if (!text || !order || this.data.sending) return;
    const sequence = this.chatSequence = (this.chatSequence || 0) + 1;
    this.setData({ sending: true });
    try {
      const app = getApp();
      const result = await api.sendOrderChat(app.globalData.merchantAccount, order.no, { role: "staff", text });
      if (!this.active || sequence !== this.chatSequence) return;
      this.chatSnapshot = JSON.stringify(result.messages || []);
      this.setData({ chatMessages: result.messages || [], chatInput: this.data.chatInput.trim() === text ? '' : this.data.chatInput });
    } catch (error) {
      wx.showToast({ title: error.message || "发送失败", icon: "none" });
    } finally { if (sequence === this.chatSequence) this.setData({ sending: false }); }
  },
  noop() {}
});
