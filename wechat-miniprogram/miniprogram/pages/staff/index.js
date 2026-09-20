const api = require("../../services/api");
const funds = require("../../utils/funds");
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

function pageTitle(data) {
  if (data.detailOrder) return '订单详情';
  if (data.previewOrder) return '订单预览';
  if (data.activeTab === 'hall') return '接单大厅';
  if (data.activeTab === 'orders') return '我的订单';
  return '打手工作台';
}

// 打手身份就是他自己微信登录出来的 customer id，服务端再核对商户侧的开通记录，
// 服务端授权才是准入依据；本地身份开关只决定页面入口。
Page({
  data: {
    activeTab: 'home', feature: '', tabs, features, statuses,
    activeStatus: '全部', activeGame: '', keyword: '', visibleOrders: [],
    // searchTerm = 已经点过「搜索」、交给服务端模糊匹配的词（空 = 没在搜索）。
    // 它和 keyword 是两个东西：keyword 是输入框当前内容（负责输入时的本地即时过滤），
    // searchTerm 一旦非空，本地就不再做关键词过滤，一切以服务端结果为准。
    searchTerm: '', searching: false,
    profile: { name: '加载中', numericId: '', avatarUrl: '', granted: false },
    // 管事：isSteward / myCode / superior / subordinates，全部来自服务端。
    steward: { isSteward: false, myCode: '', superior: null, subordinates: [] },
    // 提现手续费文案（商户在后台「分销管理」里配的「总手续费」，只作说明用；
    // 真正的算钱在提现页由服务端做）。
    withdrawFeeText: '0%',
    // 8 格资金指标：服务端聚合好的原样 data（字段名下划线），整份透传给 staff-panel 渲染。
    // 页面不在这里做任何加减 —— 提示词第 1 / 11 节：前端零计算。
    // null = 没拿到数据（8 格显示「—」），而不是「钱是 0」。
    fundData: null,
    bondRequirementText: '0.00', bondBalanceText: '—', bondEligible: true,
    // 罚单：status -1 全部 / 0 待缴 / 1 已缴 / 2 已撤销，page 从 1 开始。
    fines: [], finesUnpaid: '0.00', finesEnded: false, finesLoading: false,
    fineStatus: -1, finePage: 1,
    // 佣金流水：一页 15 条（提示词 6.1），翻页往后接。
    commission: [], commissionEnded: false, commissionLoading: false, commissionPage: 1,
    // 排行榜：与后台「员工管理 / 排行榜」同一份接单流水数据，前 20 名。
    ranking: [], rankingLoading: false, rankingError: '',
    // 防重复提交标志位：保证金充值 / 罚单缴纳各一个（提示词 6.4）。
    bondSubmitting: false, payingIndex: -1,
    games: [], stats: [], unreadCount: 0, error: '', ready: false,
    identityVisible: false, previewOrder: null, detailOrder: null, sending: false,
    loading: true,
    acceptingNo: "", flowNotice: null,
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
    this.updateTitle();
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
  onHide() { this.active = false; this.showRevision = (this.showRevision || 0) + 1; this.chatSequence = (this.chatSequence || 0) + 1; this.setData({ sending: false, flowNotice: null }); clearInterval(this.orderTimer); clearTimeout(this.flowTimer); },
  onUnload() { this.onHide(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  // silent = true：5 秒轮询、以及接单/结单后的自动刷新都走这条。
  // 静默的含义有三层：① 不置 loading（不插那行提示、不顶内容）；② 出错不弹 toast
  // （网络抖一下不该每 5 秒骚扰一次，下一轮会自愈）；③ 数据和上一轮逐字节相同就一个字段都不动，
  // 页面彻底静止（连 wx:for 的 diff 都不做）。
  async load({ silent = false, force = false } = {}) {
    if (this.syncing) {
      await this.syncing;
      if (this.active && (force || this.loadedRevision !== this.showRevision)) return this.load({ silent });
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
          // 搜索词带上走服务端模糊匹配；5 秒轮询也带着它，否则搜索结果会被下一轮全量覆盖。
          orders = await api.getStaffOrders(account, { q: this.data.searchTerm });
        } catch (error) {
          if (!this.active || revision !== this.showRevision) return;
          if (error.code === "STAFF_FORBIDDEN") {
            this.chatSequence = (this.chatSequence || 0) + 1;
            this.renderedSnapshot = null;
            this.setData({ loading: false, ready: false, pendingOrders: [], myTasks: [], visibleOrders: [], chatVisible: false, previewOrder: null, detailOrder: null });
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
        // 8 格资金指标（含可用佣金）。**只在非静默加载时拉** —— 它一次要跑好几条聚合 SQL，
        // 跟着 5 秒轮询每轮都拉会把服务端打爆；进页 / 下拉刷新 / 充值缴罚后本来就是非静默加载，
        // 提示词第 4 节要求的「每次进页面都重新拉」照样满足。静默轮询里沿用上一份数据。
        let fundData = this.data.fundData;
        if (!silent) {
          const fundResult = await api.thugMsg(account);
          // code !== 1 或 data 为空一律**保留上一份**（首次就是 null → 8 格显示「—」，
          // 不是编一排 0.00：「查不到」和「真的是 0」不是一回事）。
          if (fundResult && fundResult.code === 1 && fundResult.data) fundData = fundResult.data;
        }
        if (!this.active || revision !== this.showRevision) return;
        this.loadedRevision = revision;
        const requiredFen = Math.round(Number(config.staffBondRequirement || 0) * 100);
        const balanceFen = fundData ? Math.round(Number(fundData.bond) * 100) : NaN;
        const next = {
          loading: false, ready: true, error: '',
          profile: { name: customer.displayName, numericId: customer.numericId,
            avatarUrl: wx.getStorageSync('club_owner_avatar') || '', granted: true },
          steward: steward || { isSteward: false, myCode: '', superior: null, subordinates: [] },
          withdrawFeeText: withdrawFeeLabel(config),
          fundData,
          bondRequirementText: (requiredFen / 100).toFixed(2),
          bondBalanceText: Number.isFinite(balanceFen) ? (balanceFen / 100).toFixed(2) : '—',
          bondEligible: requiredFen === 0 || Number.isFinite(balanceFen) && balanceFen >= requiredFen,
          ...dashboard(orders, customer, config, app.globalData.apiBaseUrl, unread)
        };
        const selected = this.data.detailOrder || this.data.previewOrder;
        const refreshed = selected && [...next.pendingOrders, ...next.myTasks].find(order => order.no === selected.no);
        if (selected && !refreshed) {
          this.setData({ previewOrder: null, detailOrder: null });
          this.updateTitle();
        } else if (refreshed && JSON.stringify(refreshed) !== JSON.stringify(selected)) {
          this.setData({ previewOrder: this.data.previewOrder ? refreshed : null,
            detailOrder: this.data.detailOrder ? refreshed : null });
        }
        // 快照要带上 searchTerm：点「搜索」只换搜索词、订单数据可能一模一样，
        // 只比 next 会误判成"没变化"跳过刷新，可本地过滤口径已经换了，列表就停在旧结果。
        const snapshot = JSON.stringify({ ...next, searchTerm: this.data.searchTerm });
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
  updateTitle() { if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: pageTitle(this.data) }); },
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
    // 佣金提现是独立页面（界面分「提现 / 提现资料 / 提现记录」三块，每次进页都要重拉商户配置），
    // 不在工作台里内嵌，所以这个 tab 直接跳走。
    if (activeTab === 'withdraw') return wx.navigateTo({ url: '/pages/withdraw/index' });
    if (!tabs.some(tab => tab.id === activeTab)) return;
    const wasSearching = this.dropSearchFilter();
    this.setData({ activeTab, feature: '', keyword: '', activeStatus: '全部', activeGame: '', previewOrder: null, detailOrder: null }, () => {
      if (wasSearching) this.load({ silent: true }); else this.filter();
      this.updateTitle();
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  filter() { this.setData({ visibleOrders: filterOrders(this.data) }); },
  // 输入框打字：先本地即时过滤已加载的列表，反馈快，不打扰服务端。
  search(event) { this.setData({ keyword: event.detail.value }, () => this.filter()); },
  // 点「搜索」/ 键盘回车：关键词正式交给服务端做模糊匹配（订单号、商品、游戏昵称 / ID、
  // 区服、备注、客户昵称、状态都能搜，空格分隔多个词 = 同时命中）。
  // 清空输入框再点一次 = 退出搜索，回到全量。
  async submitSearch() {
    if (this.data.searching) return;
    const term = String(this.data.keyword || '').trim();
    if (term === this.data.searchTerm) return;
    this.setData({ searchTerm: term, searching: true });
    // force 不能省：点「搜索」的瞬间如果正好有一轮 5 秒轮询在跑，load() 会先 await 它，
    // 然后发现「本 revision 已经加载过」直接 return —— 搜索词被设进去了、数据却没重新拉，
    // 而本地过滤因为 searchTerm 非空已经让位给服务端，用户看到的就是「点搜索毫无反应」。
    try { await this.load({ silent: true, force: true }); }
    finally { this.setData({ searching: false }); }
  },
  // 切 tab / 切游戏会离开当前结果集：搜索态必须回落到全量 —— myTasks 是服务端按词过滤过的，
  // 本地还原不回来。返回 true 表示调用方得重新拉一次数据。
  dropSearchFilter() {
    if (!this.data.searchTerm) return false;
    this.setData({ keyword: '', searchTerm: '' });
    return true;
  },
  chooseStatus(event) {
    const status = event.currentTarget.dataset.status;
    if (status === '协助单') return this.showFeature('assistance');
    if (!statuses.includes(status)) return;
    this.setData({ activeTab: 'orders', activeStatus: status, keyword: '', feature: '' }, () => { this.filter(); this.updateTitle(); });
  },
  showOrderStep(no, status, message) {
    if (!this.active || !this.data.myTasks.some(order => order.no === no && order.status === status)) {
      if (this.active) wx.showToast({ title: '订单已更新，请下拉刷新', icon: 'none' });
      return;
    }
    clearTimeout(this.flowTimer);
    this.setData({ detailOrder: null, previewOrder: null, flowNotice: { message, status } });
    this.chooseStatus({ currentTarget: { dataset: { status } } });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.flowTimer = setTimeout(() => this.setData({ flowNotice: null }), 900);
  },
  chooseGame(event) {
    const wasSearching = this.dropSearchFilter();
    this.setData({ activeTab: 'hall', activeGame: event.currentTarget.dataset.game || '', keyword: '' }, () => {
      if (wasSearching) this.load({ silent: true }); else this.filter();
      this.updateTitle();
    });
  },
  openFeature(event) { this.showFeature(event.currentTarget?.dataset?.feature || event.detail); },
  openBond() {
    this.setData({ previewOrder: null, detailOrder: null }, () => this.updateTitle());
    this.showFeature('bound');
  },
  showFeature(feature) {
    // 「我的资金 → 可用佣金」也走这条路：直接去提现页，不在工作台里再嵌一份提现界面。
    if (feature === 'withdraw') return wx.navigateTo({ url: '/pages/withdraw/index' });
    if (feature === 'identity') return this.setData({ identityVisible: true });
    if (feature === 'orders') return this.chooseStatus({ currentTarget: { dataset: { status: '全部' } } });
    this.setData({ feature });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    // 罚单 / 佣金流水进功能页时按需拉第一页 —— 不放进 5 秒轮询（那是订单列表的节奏）。
    // 把 promise 返回出去，用例才能 await 到数据真的落下来（页面自己不看这个返回值）。
    if (feature === 'fine') return this.loadFines({ page: 1 });
    if (feature === 'balanceLog') return this.loadCommission({ page: 1 });
    if (feature === 'ranking') return this.loadRanking();
    return undefined;
  },
  closeFeature() { this.setData({ feature: '' }); },
  // —— 资金模块（保证金 / 罚单 / 佣金流水）——
  // 接口一律返回 { code, data } / { code, msg }（契约见 services/api.js 的 asContract）：
  // 成功判 code === 1，失败直接 toast msg。不 throw、不靠 HTTP 状态码。
  //
  // 罚单：status -1 全部 / 0 待缴 / 1 已缴 / 2 已撤销，翻页往后接（一页 15 条）。
  async loadFines({ page = 1, status = this.data.fineStatus } = {}) {
    if (this.data.finesLoading) return;
    const account = getApp().globalData.merchantAccount;
    this.setData({ finesLoading: true });
    const result = await api.fineList(account, { status, page, limit: funds.FINE_LIMIT });
    if (result.code !== 1) {
      this.setData({ finesLoading: false });
      return wx.showToast({ title: result.msg || '罚单加载失败', icon: 'none' });
    }
    const incoming = Array.isArray(result.data.list) ? result.data.list : [];
    this.setData({
      fines: page > 1 ? [...this.data.fines, ...incoming] : incoming,
      finesUnpaid: funds.money(result.data.unpaid_total),
      // 返回条数不足一页就是到底了（提示词 6.1）。
      finesEnded: funds.fineListEnded(incoming.length, funds.FINE_LIMIT),
      fineStatus: status, finePage: page, finesLoading: false
    });
  },
  moreFines() {
    if (this.data.finesEnded || this.data.finesLoading) return;
    return this.loadFines({ page: this.data.finePage + 1 });
  },
  selectFineTab(event) {
    const status = Number(event.detail && event.detail.status);
    if (!Number.isFinite(status) || status === this.data.fineStatus) return;
    return this.loadFines({ page: 1, status });
  },
  async payFine(event) {
    const index = Number(event.detail && event.detail.index);
    const fine = this.data.fines[index];
    if (!fine || this.data.payingIndex > -1) return;
    // 只有待缴（status === 0）能交 —— 服务端也会再判一次，这里先挡一道免得点了没反应。
    if (!funds.isFinePayable(fine.status)) return wx.showToast({ title: '这张罚单不能缴纳', icon: 'none' });
    const account = getApp().globalData.merchantAccount;
    this.setData({ payingIndex: index });
    try {
      const result = await api.finePay(account, { id: fine.id, fine_no: fine.fine_no, pay_type: 'balance', methods: 'miniapp' });
      if (result.code !== 1) throw new Error(result.msg || '缴纳失败');
      wx.showToast({ title: (result.data && result.data.message) || '缴纳成功', icon: 'success' });
      // 缴完三处一起刷新：罚单列表、8 格里的「待交罚款」、佣金流水（多了一笔罚款支出）。
      await this.loadFines({ page: 1 });
      await this.loadCommission({ page: 1 });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '缴纳异常', icon: 'none' });
    } finally {
      this.setData({ payingIndex: -1 });
    }
  },
  // 佣金流水：一页 15 条，tab 过滤（全部/收入/支出）在组件里本地做，不重新请求。
  async loadCommission({ page = 1 } = {}) {
    if (this.data.commissionLoading) return;
    const account = getApp().globalData.merchantAccount;
    this.setData({ commissionLoading: true });
    const result = await api.thugCommissionLog(account, { page, limit: funds.FINE_LIMIT });
    if (result.code !== 1) {
      this.setData({ commissionLoading: false });
      return wx.showToast({ title: result.msg || '流水加载失败', icon: 'none' });
    }
    const incoming = Array.isArray(result.data) ? result.data : [];
    this.setData({
      commission: page > 1 ? [...this.data.commission, ...incoming] : incoming,
      commissionEnded: funds.fineListEnded(incoming.length, funds.FINE_LIMIT),
      commissionPage: page, commissionLoading: false
    });
  },
  moreCommission() {
    if (this.data.commissionEnded || this.data.commissionLoading) return;
    return this.loadCommission({ page: this.data.commissionPage + 1 });
  },
  // 排行榜：与后台「员工管理 / 排行榜」同一份接单流水数据，服务端已按笔数排好并截前 20。
  async loadRanking() {
    if (this.data.rankingLoading) return;
    const account = getApp().globalData.merchantAccount;
    this.setData({ rankingLoading: true, rankingError: '' });
    try {
      const list = await api.getStaffRanking(account, 20);
      this.setData({ ranking: list, rankingLoading: false });
    } catch (error) {
      this.setData({ rankingError: error.message || '加载失败', rankingLoading: false });
    }
  },
  // 保证金充值。服务端目前不接真实支付（返回 mode='direct' 即已直接到账）；
  // 以后接虚拟支付，这里按 mode 分支多调一次 wx.requestPayment 即可，接口契约不用改。
  async submitBond(event) {
    const money = Number(event.detail && event.detail.money);
    if (this.data.bondSubmitting) return;
    const error = funds.validateBondAmount(money);
    if (error) return wx.showToast({ title: error, icon: 'none' });
    const account = getApp().globalData.merchantAccount;
    this.setData({ bondSubmitting: true });
    try {
      const result = await api.thugBond(account, { money, pay_type: 'balance', methods: 'miniapp' });
      if (result.code !== 1) throw new Error(result.msg || '充值失败');
      wx.showToast({ title: (result.data && result.data.message) || '保证金充值成功', icon: 'success' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '充值失败', icon: 'none' });
    } finally {
      this.setData({ bondSubmitting: false });
    }
  },
  closeIdentity() { this.setData({ identityVisible: false }); },
  unavailable() { wx.showModal({ title: '暂未接通', content: '该功能尚未接通业务接口，当前不会提交资料、变更接单状态或产生资金操作。', showCancel: false }); },
  // 订单编号 / 游戏昵称 / 游戏 ID 三行都能复制：打手是拿着昵称和 ID 去游戏里加客户好友的，
  // 手抄一遍必错。⚠️ 没填的字段复制出来是「未填写」三个字，等于把占位文案当成真数据发给打手，
  // 所以空值直接提示、不写剪贴板（值用 data-value 单独传，不读页面上的显示文案）。
  copyField(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const value = String(dataset.value || "");
    if (!value) {
      wx.showToast({ title: `客户没填${dataset.label || "这一项"}`, icon: "none" });
      return;
    }
    wx.setClipboardData({ data: value });
  },
  openDetail(event) {
    const order = [...this.data.pendingOrders, ...this.data.myTasks].find(item => item.no === event.currentTarget.dataset.no);
    if (order) this.setData({ detailOrder: order }, () => this.updateTitle());
  },
  openPreview(event) {
    const order = this.data.pendingOrders.find(item => item.no === event.currentTarget.dataset.no);
    if (order) this.setData({ previewOrder: order, detailOrder: null }, () => this.updateTitle());
  },
  previewDetail() {
    if (this.data.previewOrder) this.setData({ detailOrder: this.data.previewOrder }, () => this.updateTitle());
  },
  closePreview() { this.setData({ previewOrder: null }, () => this.updateTitle()); },
  closeDetail() { this.setData({ detailOrder: null }, () => this.updateTitle()); },
  moreOrderActions() {
    const order = this.data.detailOrder;
    if (!order) return;
    wx.showActionSheet({ itemList: ['复制订单编号'], success: (result) => {
      if (result.tapIndex === 0) wx.setClipboardData({ data: order.no });
    } });
  },
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
        // 服务端 imageAssetFromDataUrl 收 8MB（解码后字节），这里留一档余量：
        // 图片会以 base64 塞进 JSON body，膨胀约 1/3，5MB 图 ≈ 6.7MB 字符串，
        // 仍在 MAX_BODY_BYTES(24MB) 之内。
        if (file.size > 5 * 1024 * 1024) throw new Error('截图请控制在 5MB 以内');
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
      await this.load({ silent: true, force: true });
      this.showOrderStep(no, action === 'start' ? '服务中' : '待结单', action === 'start' ? '服务已开始' : '截图已提交');
    } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); }
    finally { this.setData({ acceptingNo: '' }); }
  },
  async acceptOrder(event) {
    const orderNo = event.currentTarget.dataset.no;
    if (!orderNo || this.data.acceptingNo || !this.data.ready || !this.active) return;
    if (!this.data.bondEligible) return wx.showModal({ title: '保证金不足', content: `接单需保证金 ¥${this.data.bondRequirementText}，当前 ¥${this.data.bondBalanceText}。`, showCancel: false });
    this.setData({ acceptingNo: orderNo });
    try {
      const app = getApp();
      await api.acceptStaffOrder(app.globalData.merchantAccount, orderNo);
      this.setData({ previewOrder: null, detailOrder: null });
      await this.load({ silent: true, force: true });
      this.showOrderStep(orderNo, '待开始', '接单成功');
    } catch (error) {
      if (error.code === 'BOND_INSUFFICIENT') wx.showModal({ title: '保证金不足', content: error.message, showCancel: false });
      else wx.showToast({ title: error.message || "接单失败", icon: "none" });
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
