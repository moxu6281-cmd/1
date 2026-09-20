const api = require("../../services/api");
const {
  TEXT, SETTLEMENT_FORMS, WITHDRAW_CHANNELS, QR_UPLOAD_TEXT, SAVE_TEXT,
  calcWithdraw, feeLabel: withdrawFeeLabel, normalizeSettings, channelsWithState,
  settlementKey, validateSubmit, validateSettlement, formatRecordTime
} = require("../../utils/withdraw");

// 提现页（打手 / 用户共用一套界面，身份由服务端判）：三块视图 —— 提现 / 提现资料 / 提现记录。
// 钱的部分一律由服务端算（最低提现额、渠道开关、手续费都重算一遍），这里只负责展示与收集。
// ⚠️ 每次进页（onShow）都重拉一次配置：最低提现额 / 开放渠道 / 说明文案都是商户后台随时可调的运营值，
//    长期缓存会让商户改完不生效（文档硬性要求）。
// ⚠️ 收款信息按文档第七节存在**本地** Storage（settlement_<channel>），提交时直接读，不另发请求。
const TWO = (value) => Number(value || 0).toFixed(2);

Page({
  data: {
    view: "main",
    loading: true, ready: false, error: "",
    identity: "staff", availableText: "0.00",
    minAmount: 10, notice: "",
    fee: { mode: "rate", value: 0 }, feeLabel: "0%",
    amount: "", feeText: "0.00", actualText: "0.00",
    channels: [], channelIndex: 0, channel: "", channelLabel: "",
    copy: TEXT, qrUploadText: QR_UPLOAD_TEXT, saveText: SAVE_TEXT,
    // 提现资料页的三个渠道 tab，标签就是渠道名（`支付宝提现资料` 这种完整标题由 settlementTitle 给）。
    settlementTabs: WITHDRAW_CHANNELS.map(({ key, label }) => ({ key, label })),
    settlementIndex: 0, settlementFields: [], settlementTitle: "", settlementQr: "", formValues: {}, qrImage: "",
    recordTabs: TEXT.recordTabs, recordTab: "all", records: [], visibleRecords: [], recordsLoading: false,
    submitting: false
  },
  onShow() { this.loadPage(); },
  onPullDownRefresh() { Promise.resolve(this.loadPage()).finally(() => wx.stopPullDownRefresh()); },
  // 离开就作废在途请求，避免回来时被旧响应覆盖（切商户/连点返回都可能发生）。
  onHide() { this.loadSequence = (this.loadSequence || 0) + 1; this.recordSequence = (this.recordSequence || 0) + 1; },
  onUnload() { this.onHide(); },

  async loadPage() {
    const sequence = this.loadSequence = (this.loadSequence || 0) + 1;
    if (!this.data.ready) this.setData({ loading: true });
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const payload = await api.getWithdrawPage(app.globalData.merchantAccount);
      if (sequence !== this.loadSequence) return;
      const settings = normalizeSettings(payload);
      // ⚠️ 这里必须是 settings.openKeys（归一化后的结果），不是 settings.channels ——
      //    normalizeSettings 只返回 { minAmount, openKeys, notice }，写成 .channels 会拿到 undefined，
      //    channelsWithState 把「一个渠道都没开」当成全部禁用 → 三个渠道全灰、点哪个都提示
      //    「该通道未开放提现」，打手根本提不出钱（tests/withdraw.test.cjs 有行为用例钉着）。
      const { list, firstEnabled } = channelsWithState(settings.openKeys);
      const raw = payload.fee || {};
      const fee = { mode: raw.mode === "amount" ? "amount" : "rate", value: Number(raw.value || 0) };
      const identity = payload.identity === "user" ? "user" : "staff";
      // 原来选的渠道还开放就留着；否则回到第一个开放渠道（一个都没开时就是支付宝）。
      const kept = list.findIndex((item, index) => index === this.data.channelIndex && !item.disabled && item.key === this.data.channel);
      const channelIndex = kept >= 0 ? kept : firstEnabled;
      const current = list[channelIndex] || list[0];
      const numbers = calcWithdraw(this.data.amount, fee, identity);
      this.setData({
        loading: false, ready: true, error: "",
        identity, availableText: TWO(payload.available),
        minAmount: settings.minAmount, notice: settings.notice,
        fee, feeLabel: withdrawFeeLabel(fee, identity),
        channels: list, channelIndex, channel: current.key, channelLabel: current.label,
        feeText: numbers.fee, actualText: numbers.actual
      });
    } catch (error) {
      if (sequence !== this.loadSequence) return;
      this.setData({ loading: false, ready: false, error: error.message || "提现信息加载失败" });
    }
  },
  retry() { this.loadPage(); },

  // —— 提现金额 ——
  onAmountInput(event) {
    const amount = event.detail.value;
    const numbers = calcWithdraw(amount, this.data.fee, this.data.identity);
    this.setData({ amount, feeText: numbers.fee, actualText: numbers.actual });
  },
  // 「全部提现」＝把可用金额填进输入框，再走同一个公式（文档第五节）。
  fillAll() {
    const amount = this.data.availableText;
    const numbers = calcWithdraw(amount, this.data.fee, this.data.identity);
    this.setData({ amount, feeText: numbers.fee, actualText: numbers.actual });
  },
  chooseChannel(event) {
    const item = this.data.channels[Number(event.currentTarget.dataset.index) || 0];
    if (!item) return;
    if (item.disabled) return wx.showToast({ title: TEXT.channelClosed, icon: "none" });
    this.setData({ channelIndex: Number(event.currentTarget.dataset.index) || 0, channel: item.key, channelLabel: item.label });
  },

  // —— 提现资料（本地 Storage，按渠道各存一份）——
  openSettlement() {
    const index = WITHDRAW_CHANNELS.findIndex((item) => item.key === this.data.channel);
    this.setData({ view: "settlement" });
    this.loadSettlement(index < 0 ? 0 : index);
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  loadSettlement(index) {
    const channel = WITHDRAW_CHANNELS[index] || WITHDRAW_CHANNELS[0];
    const spec = SETTLEMENT_FORMS[channel.key];
    const saved = wx.getStorageSync(settlementKey(channel.key)) || {};
    const formValues = {};
    spec.fields.forEach((field) => { formValues[field.key] = String(saved[field.key] || ""); });
    this.setData({
      settlementIndex: WITHDRAW_CHANNELS.indexOf(channel),
      settlementTitle: spec.title,
      settlementQr: spec.hasQr ? spec.qrLabel : "",
      settlementFields: spec.fields.map((field) => ({ ...field, value: formValues[field.key] })),
      formValues,
      qrImage: spec.hasQr ? String(saved.images || "") : ""
    });
  },
  chooseSettlementTab(event) { this.loadSettlement(Number(event.currentTarget.dataset.index) || 0); },
  onFieldInput(event) {
    const key = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({
      formValues: { ...this.data.formValues, [key]: value },
      settlementFields: this.data.settlementFields.map((field) => (field.key === key ? { ...field, value } : field))
    });
  },
  // 收款码只存本机路径（文档第七节明确不服务端化），所以这里不做上传。
  chooseQr() {
    wx.chooseMedia({
      count: 1, mediaType: ["image"], sizeType: ["compressed"],
      success: (result) => { const file = result.tempFiles && result.tempFiles[0]; if (file) this.setData({ qrImage: file.tempFilePath }); }
    });
  },
  saveSettlement() {
    const channel = WITHDRAW_CHANNELS[this.data.settlementIndex] || WITHDRAW_CHANNELS[0];
    const values = this.data.formValues;
    const problem = validateSettlement(channel.key, values);
    if (problem) return wx.showToast({ title: problem, icon: "none" });
    const record = { account: String(values.account || ""), name: String(values.name || ""), images: this.data.qrImage, imagesFull: this.data.qrImage };
    if (channel.key === "bank") record.bankName = String(values.bankName || "");
    wx.setStorageSync(settlementKey(channel.key), record);
    wx.showToast({ title: TEXT.saved, icon: "success" });
    setTimeout(() => { if (this.data.view === "settlement") this.backToMain(); }, 1000);
  },
  backToMain() { this.setData({ view: "main" }); wx.pageScrollTo({ scrollTop: 0, duration: 0 }); },

  // —— 提现记录（收入 + 提现合并下发，按 tab 拆）——
  openRecords() {
    this.setData({ view: "records", recordsLoading: true });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.loadRecords();
  },
  async loadRecords() {
    const sequence = this.recordSequence = (this.recordSequence || 0) + 1;
    try {
      const items = await api.getWithdrawRecords(getApp().globalData.merchantAccount);
      if (sequence !== this.recordSequence) return;
      this.setData({ recordsLoading: false, records: items.map((item) => ({
        ...item,
        amountText: TWO(item.actualMoney || item.money || 0),
        timeText: formatRecordTime(item.createtime)
      })) }, () => this.applyRecordTab());
    } catch (error) {
      if (sequence !== this.recordSequence) return;
      this.setData({ recordsLoading: false, records: [] }, () => this.applyRecordTab());
      wx.showToast({ title: error.message || "提现记录加载失败", icon: "none" });
    }
  },
  chooseRecordTab(event) { this.setData({ recordTab: event.currentTarget.dataset.tab }, () => this.applyRecordTab()); },
  applyRecordTab() {
    const tab = this.data.recordTab;
    this.setData({ visibleRecords: tab === "all" ? this.data.records : this.data.records.filter((item) => item.kind === tab) });
  },

  // —— 提交（校验顺序严格照文档第八节，先命中先返回）——
  async submit() {
    if (this.data.submitting) return;
    const channel = this.data.channel;
    const settlement = wx.getStorageSync(settlementKey(channel)) || {};
    const problem = validateSubmit({ amount: this.data.amount, minAmount: this.data.minAmount, settlement });
    if (problem) return wx.showToast({ title: problem, icon: "none" });
    this.setData({ submitting: true });
    try {
      const result = await api.submitWithdraw(getApp().globalData.merchantAccount, {
        name: settlement.name,
        account: settlement.account,
        money: Number(this.data.amount),
        images: settlement.images || "",
        channel,
        bankName: channel === "bank" ? String(settlement.bankName || "") : ""
      });
      wx.showToast({ title: result.message || "提现申请已提交", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 1500);
    } catch (error) {
      wx.showToast({ title: error.message || "提现申请失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
