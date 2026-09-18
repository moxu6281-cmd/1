const api = require("../../services/api");
const { payAndConfirm } = require("../../utils/pay");

// 余额只有「客户」一种身份：同一个人可能既下单（客户）又接单（打手），但钱只记在一本账上，
// 所以「我的」页只显示一个余额，不再拆成「客户余额 / 打手余额」两个数字。
// 会员等级说明与网页 getMemberMeta 一一对应，两端文案必须一样（改一头要改两头）。
function memberMetaOf(level) {
  const map = {
    黄金: { text: "黄金会员", className: "gold", tip: "基础权益 · 售后优先登记" },
    铂金: { text: "铂金会员", className: "platinum", tip: "进阶权益 · 客服优先跟进" },
    钻石: { text: "钻石会员", className: "diamond", tip: "高级权益 · 加急安排提醒" },
    黑金: { text: "黑金会员", className: "blackgold", tip: "顶级权益 · 专属客服通道" }
  };
  return map[level] || map["黄金"];
}

// 累计消费一律以整数分从服务端下发（server.js getCustomerTotalSpentFen），
// 这里固定两位小数，和网页 moneyFen() 用同一套算式，免得两端显示不一样。
function spentTextOf(fen) {
  return (Number(fen || 0) / 100).toFixed(2);
}

Page({
  data: {
    name: "未登录用户",
    numericId: "",
    avatarUrl: "",
    memberLevel: "黄金",
    memberMeta: memberMetaOf("黄金"),
    memberBenefits: [],
    benefitsVisible: false,
    activeIdentity: "boss",
    staffPermission: false,
    walletBalanceText: "0.00",
    totalSpentText: "0.00"
  },
  async onShow() {
    this._walletVisible = true;
    clearInterval(this._walletTimer);
    const showVersion = this._walletShowVersion = (this._walletShowVersion || 0) + 1;
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 4 });
    const app = getApp();
    const avatarUrl = wx.getStorageSync("club_owner_avatar") || "";
    const memberLevel = wx.getStorageSync("club_member_level") || "黄金";
    const activeIdentity = wx.getStorageSync("club_active_identity") || "boss";
    try {
      const customer = await app.ensureCustomerIdentity();
      // 「我的」页不再显示订单状态统计（用户要求按参考图重排整页），所以这里不必再拉订单——
      // 订单列表由「订单」页自己拉，少一次无谓请求。
      const [config, wallet, staffGranted] = await Promise.all([
        app.loadConfig(true),
        api.getWallet(app.globalData.merchantAccount, customer.customerId),
        // The grant flag from login goes stale once the merchant grants/revokes it, so re-check.
        api.getStaffGrant(app.globalData.merchantAccount).catch(() => customer.staffGranted === true)
      ]);
      if (!this._walletVisible || showVersion !== this._walletShowVersion) return;
      customer.staffGranted = staffGranted === true;
      this.setData({
        name: customer.displayName,
        numericId: customer.numericId,
        avatarUrl,
        memberLevel,
        memberMeta: memberMetaOf(memberLevel),
        memberBenefits: this.normalizeMemberBenefits(config.memberBenefits),
        activeIdentity,
        staffPermission: staffGranted === true,
        walletBalanceText: Number(wallet.balance || 0).toFixed(2),
        totalSpentText: spentTextOf(wallet.totalSpentFen)
      });
    } catch {
      if (!this._walletVisible || showVersion !== this._walletShowVersion) return;
      const cached = wx.getStorageSync("club_customer_profile") || {};
      this.setData({
        name: cached.displayName || "未登录用户",
        numericId: cached.numericId || "",
        avatarUrl,
        memberLevel,
        memberMeta: memberMetaOf(memberLevel),
        memberBenefits: this.normalizeMemberBenefits([]),
        activeIdentity,
        walletBalanceText: "暂不可用",
        totalSpentText: "暂不可用"
      });
    } finally {
      if (this._walletVisible && showVersion === this._walletShowVersion) this._walletTimer = setInterval(() => this.refreshWallet(), 4000);
    }
  },
  onHide() {
    this._walletVisible = false;
    clearInterval(this._walletTimer);
  },
  onUnload() {
    this.onHide();
  },
  // 三栏卡里余额和累计消费都是真数字，一起刷新，免得停在这一页时累计消费变成过期的。
  async refreshWallet() {
    if (!this._walletVisible || this._walletLoading) return;
    this._walletLoading = true;
    const app = getApp();
    const account = app.globalData.merchantAccount;
    const showVersion = this._walletShowVersion;
    try {
      const customer = await app.ensureCustomerIdentity();
      const wallet = await api.getWallet(account, customer.customerId);
      if (!this._walletVisible || showVersion !== this._walletShowVersion || account !== app.globalData.merchantAccount) return;
      this.setData({
        walletBalanceText: Number(wallet.balance || 0).toFixed(2),
        totalSpentText: spentTextOf(wallet.totalSpentFen)
      });
    } catch {
      if (this._walletVisible) this.setData({ walletBalanceText: "暂不可用", totalSpentText: "暂不可用" });
    } finally {
      this._walletLoading = false;
    }
  },
  chooseAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    wx.setStorageSync("club_owner_avatar", avatarUrl);
    this.setData({ avatarUrl });
  },
  rechargeBalance() {
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
          if (outcome.paid) {
            const wallet = outcome.wallet || (await api.getWallet(account, customer.customerId));
            this.setData({
              walletBalanceText: Number((wallet && wallet.balance) || 0).toFixed(2),
              totalSpentText: spentTextOf(wallet && wallet.totalSpentFen)
            });
            wx.showToast({ title: "充值成功", icon: "success" });
          } else if (outcome.cancelled) {
            wx.showToast({ title: "已取消支付", icon: "none" });
          } else {
            wx.showModal({ title: "支付结果确认中", content: outcome.message || "稍后在余额里刷新即可", showCancel: false });
          }
        } catch (error) {
          wx.showModal({ title: "充值失败", content: error.message, showCancel: false });
        }
      }
    });
  },
  // 累计消费的口径：只统计已支付的订单（余额付款和微信付款都算，未付款/已取消的不算）。
  // 这也是后台「累计消费满 X 元」会员权益的判定口径，说清楚免得客户以为数字漏了。
  explainSpent() {
    wx.showModal({ title: "累计消费", content: "只统计已支付的订单；未付款和已取消的订单不计入。", showCancel: false });
  },
  normalizeMemberBenefits(source) {
    const defaults = [
      { level: "黄金", condition: "累计下单满 1 单", benefits: "售后优先登记\n专属活动提醒" },
      { level: "铂金", condition: "累计消费满 500 元", benefits: "客服优先跟进\n加急订单提醒" },
      { level: "钻石", condition: "累计消费满 1500 元", benefits: "高级售后通道\n指定打手优先安排" },
      { level: "黑金", condition: "累计消费满 3000 元", benefits: "专属客服通道\n高价值订单优先排队" }
    ];
    const saved = Array.isArray(source) ? source : [];
    return defaults.map((item) => {
      const current = saved.find((row) => row && row.level === item.level) || {};
      return {
        level: item.level,
        condition: current.condition || item.condition,
        benefits: current.benefits || item.benefits
      };
    });
  },
  openMemberBenefits() {
    this.setData({ benefitsVisible: true });
  },
  closeMemberBenefits() {
    this.setData({ benefitsVisible: false });
  },
  // 会员卡撤掉之后，权益抽屉里的等级条目就是切换会员等级的唯一入口。
  chooseMemberLevel(event) {
    const memberLevel = event.currentTarget.dataset.level;
    if (!memberLevel) return;
    wx.setStorageSync("club_member_level", memberLevel);
    this.setData({ memberLevel, memberMeta: memberMetaOf(memberLevel), benefitsVisible: false });
    wx.showToast({ title: `已切换为${memberLevel}会员`, icon: "none" });
  },
  noop() {},
  // 身份切换：客户端这一侧叫「老板」（旧版就是老板，改版时被写成了「客户」，用户 2026-09-15 要求改回来）。
  // 存的值一直没变过，一直是 "boss"，这里动的只是显示文案。
  openIdentitySwitch() {
    wx.showActionSheet({
      itemList: ["老板", "打手"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          wx.setStorageSync("club_active_identity", "boss");
          this.setData({ activeIdentity: "boss" });
          wx.showToast({ title: "已切换老板身份", icon: "success" });
          return;
        }
        if (!this.data.staffPermission) {
          wx.showToast({ title: "请联系商户开通打手权限", icon: "none" });
          return;
        }
        wx.setStorageSync("club_active_identity", "staff");
        this.setData({ activeIdentity: "staff" });
        wx.showToast({ title: "已切换打手身份", icon: "success" });
      }
    });
  },
  openStaffWorkbench() {
    if (!this.data.staffPermission) {
      wx.showToast({ title: "请联系商户开通打手权限", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/staff/index" });
  },
  // 「登录身份」入口已于 2026-09-15 按用户要求删除（它只是下面的说明弹窗，不参与登录，
  // 而登录是 app.js onLaunch 里 wx.login 静默完成的；昵称和数字 ID 在顶部会员卡已常显）。
  // 原来那个 explainLogin() 弹窗一并删掉，别让它变成死代码。
  // 昵称自取：数字 ID 才是唯一身份，改名只影响展示，已发生的历史订单/流水不受影响。
  editName() {
    wx.showModal({
      title: "修改昵称",
      editable: true,
      placeholderText: "1-16 个字，不能和别人重名",
      content: /^用户\d{4,}$/.test(this.data.name || "") ? "" : this.data.name,
      success: async ({ confirm, content }) => {
        if (!confirm) return;
        const next = String(content || "").trim();
        if (!next) return wx.showToast({ title: "昵称不能为空", icon: "none" });
        if (next === this.data.name) return;
        wx.showLoading({ title: "保存中", mask: true });
        try {
          const customer = await api.updateCustomerProfile(next);
          if (!customer || !customer.displayName) throw new Error("昵称保存失败");
          wx.hideLoading();
          this.setData({ name: customer.displayName });
          this.syncLocalProfile(customer);
          wx.showToast({ title: "昵称已更新", icon: "success" });
        } catch (error) {
          wx.hideLoading();
          wx.showToast({ title: error.message || "昵称保存失败", icon: "none" });
        }
      }
    });
  },
  // 本地缓存（首页/工作台会读）跟服务端保持一致，避免下次冷启动显示旧昵称。
  syncLocalProfile(customer) {
    const app = getApp();
    if (app && app.globalData) {
      app.globalData.customer = { ...(app.globalData.customer || {}), ...customer };
    }
    const cached = wx.getStorageSync("club_customer_profile") || {};
    wx.setStorageSync("club_customer_profile", { ...cached, ...customer });
    wx.setStorageSync("club_owner_name", customer.displayName || "");
    if (customer.numericId) wx.setStorageSync("club_user_numeric_id", customer.numericId);
  }
});
