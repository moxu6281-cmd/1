// 资金模块（8 格指标 / 保证金充值 / 罚单 / 佣金流水）与排行榜已全部接通真实数据；
// 陪玩等级、客服等仍未接通，那些位置照旧显示「—」，不编 0 出来。
//
// ⚠️ 组件**只渲染、不发请求**（这是原来的约定，别顺手在这里加 wx.request）：
//    数据由 pages/staff/index.js 拉好透传进来，动作一律 triggerEvent 抛回页面执行。
// 8 格指标的字段名、罚单三态、流水方向的判断规则全在 utils/funds.js 里，这里不重复实现。
const funds = require("../../utils/funds");

const titles = {
  center: '陪玩中心', bound: '保证金充值', fine: '我的罚单',
  balanceLog: '余额明细', subordinates: '我的下级', level: '陪玩等级', ranking: '排行榜',
  support: '平台客服', notice: '平台通知', assistance: '协助订单', settings: '工作台设置'
};

Component({
  properties: {
    mode: { type: String, value: 'center', observer(value) { this.setData({ title: titles[value] || '功能说明' }); } },
    profile: { type: Object, value: {} },
    // 管事身份全貌，由页面拉接口后透传进来（见 pages/staff/index.js）。
    steward: { type: Object, value: {} },
    // 商户后台配的「打手提现手续费（总）」文案，如 "10%" / "2 元/笔"。
    withdrawFeeText: { type: String, value: '0%' },
    // 打手的可用佣金（工作台九宫格「可用佣金」那格）。
    available: { type: String, value: '—' },
    // 8 格资金指标：服务端聚合好的原样 data（字段名下划线，照提示词契约）。
    // 用 type: null 而不是 Object —— 拿不到数据时页面传 null，组件要能区分
    // 「没数据（显示 —）」和「真的是 0（显示 0.00）」。
    fundData: { type: null, value: null, observer(value) { this.applyFunds(value); } },
    // 罚单：页面按 tab 重新拉，组件只渲染。finesUnpaid 是接口给的待缴合计。
    // 观察者里一律用传进来的 value，不读 this.data —— 同一批改多个属性时 this.data 可能还是旧值。
    fines: { type: Array, value: [], observer(value) { this.setData({ fineRows: funds.fineRows(value) }); } },
    finesUnpaid: { type: String, value: '0.00' },
    finesEnded: { type: Boolean, value: false },
    finesLoading: { type: Boolean, value: false },
    // 佣金流水：一次拉一页，tab 过滤在本地做（提示词第 7 节的 Tab 口径）。
    commission: { type: Array, value: [], observer(value) { this.applyCommission(value); } },
    commissionEnded: { type: Boolean, value: false },
    commissionLoading: { type: Boolean, value: false },
    // 排行榜：页面拉好 `/api/public/staff-ranking` 后透传进来，组件只渲染。
    ranking: { type: Array, value: [], observer(value) { this.applyRanking(value); } },
    rankingLoading: { type: Boolean, value: false },
    rankingError: { type: String, value: "" },
    // 提交中标志位：页面持有，用来防重复提交（充值 / 缴纳各一个）。
    bondSubmitting: { type: Boolean, value: false },
    payingIndex: { type: Number, value: -1 }
  },
  data: {
    title: '陪玩中心',
    fundGrid: funds.indicatorList({}),
    bondText: '0.00',
    bondTiers: funds.bondTierList(),
    bondPick: funds.BOND_RECOMMENDED,
    bondCustom: '',
    fineTabs: funds.FINE_TABS,
    fineTab: 0,
    fineRows: [],
    commissionTabs: funds.COMMISSION_TABS,
    commissionTab: 0,
    commissionRows: [],
    commissionAll: [],
    headerSums: { available: '0.00', frozen: '0.00', settled: '0.00' },
    rankingRows: [],
    fineEmpty: funds.FINE_EMPTY,
    fineEnd: funds.FINE_END,
    commissionEmpty: funds.COMMISSION_EMPTY,
    commissionEnd: funds.COMMISSION_END
  },
  methods: {
    // 8 格 + 保证金卡 + 流水页头部，全部走 utils/funds.js 的同一个 money()（提示词第 3 节）。
    // raw 为 null = 接口没拿到数据 → 一律「—」，绝不编成 0.00。
    applyFunds(raw) {
      const known = Boolean(raw) && typeof raw === 'object';
      const source = known ? raw : {};
      const recommended = Number(source.bond_recommended) > 0 ? Number(source.bond_recommended) : funds.BOND_RECOMMENDED;
      this.setData({
        fundGrid: funds.indicatorList(known ? source : null),
        bondText: known ? funds.money(source.bond) : '—',
        bondTiers: funds.bondTierList(source.bond_tiers, recommended),
        bondPick: recommended,
        headerSums: {
          available: known ? funds.money(source.available_money) : '—',
          frozen: known ? funds.money(source.frozen_money) : '—',
          settled: known ? funds.money(source.total_settled) : '—'
        }
      });
    },
    applyRanking(list) {
      const rows = (Array.isArray(list) ? list : []).map((item, index) => ({
        rank: index + 1,
        medal: index < 3 ? ['🥇', '🥈', '🥉'][index] : '',
        name: String(item.name || '—'),
        numericId: String(item.numeric_id || item.numericId || ''),
        orderCount: Number(item.order_count || item.orderCount || 0),
        orderAmount: funds.money(item.order_amount || item.orderAmount || 0),
      }));
      this.setData({ rankingRows: rows });
    },
    applyCommission(list) {
      const all = funds.commissionRows(list == null ? this.data.commission : list);
      const tab = funds.COMMISSION_TABS[this.data.commissionTab] || funds.COMMISSION_TABS[0];
      this.setData({
        commissionAll: all,
        commissionRows: funds.filterCommissionLog(all, tab.key)
      });
    },
    navigate(event) {
      const target = event.currentTarget.dataset.target;
      if (titles[target] || target === 'withdraw') this.triggerEvent('navigate', target);
    },
    // —— 保证金充值 ——
    pickBondTier(event) {
      this.setData({ bondPick: Number(event.currentTarget.dataset.amount) || 0, bondCustom: '' });
    },
    inputBond(event) {
      this.setData({ bondCustom: event.detail.value });
    },
    submitBond() {
      if (this.data.bondSubmitting) return;
      const chosen = this.data.bondCustom ? this.data.bondCustom : String(this.data.bondPick || '');
      const error = funds.validateBondAmount(chosen);
      if (error) return wx.showToast({ title: error, icon: 'none' });
      this.triggerEvent('bondsubmit', { money: Number(chosen) });
    },
    // —— 罚单 ——
    chooseFineTab(event) {
      const index = Number(event.currentTarget.dataset.index) || 0;
      const tab = funds.FINE_TABS[index] || funds.FINE_TABS[0];
      if (index === this.data.fineTab) return;
      this.setData({ fineTab: index });
      // 筛选交给服务端（提示词 6.1 的 status 参数），页面重新拉第一页。
      this.triggerEvent('selectfine', { status: tab.status, page: 1 });
    },
    payFine(event) {
      const index = Number(event.currentTarget.dataset.index);
      if (this.data.payingIndex > -1) return;
      this.triggerEvent('payfine', { index });
    },
    moreFines() { this.triggerEvent('morefine'); },
    // —— 佣金流水 ——
    chooseCommissionTab(event) {
      const index = Number(event.currentTarget.dataset.index) || 0;
      const tab = funds.COMMISSION_TABS[index] || funds.COMMISSION_TABS[0];
      // 本地过滤已经转好的那份（commissionAll），不重新请求。
      this.setData({ commissionTab: index, commissionRows: funds.filterCommissionLog(this.data.commissionAll, tab.key) });
    },
    moreCommission() { this.triggerEvent('morecommission'); },
    // —— 管事三件事都交给页面（组件不自己发请求）——
    redeem() { this.triggerEvent('redeem'); },
    copyCode() { this.triggerEvent('copycode'); },
    generate() { this.triggerEvent('generate'); },
    explain() {
      wx.showModal({ title: '功能暂未接通', content: '页面已适配，但对应业务接口尚未接通。这里的“—”不是零余额；不会保存收款资料、发起支付、提现或扣款。', showCancel: false });
    }
  }
});
