// 管事相关（邀请码 / 我的下级）已接通真实接口；其余界面仍是"未接通"占位，
// 不读取客户钱包冒充佣金，不存储收款资料，不发送写请求。
const titles = {
  center: '陪玩中心', withdraw: '佣金提现', bound: '保证金充值', fine: '我的罚单',
  settlement: '提现资料', withdrawLog: '提现记录', balanceLog: '余额明细', subordinates: '我的下级',
  level: '陪玩等级', ranking: '排行榜', support: '平台客服', notice: '平台通知',
  assistance: '协助订单', settings: '工作台设置'
};
Component({
  properties: {
    mode: { type: String, value: 'center', observer(value) { this.setData({ title: titles[value] || '功能说明', selected: 0 }); } },
    profile: { type: Object, value: {} },
    // 管事身份全貌，由页面拉接口后透传进来（见 pages/staff/index.js）。
    steward: { type: Object, value: {} },
    // 商户后台配的「打手提现手续费（总）」文案，如 "10%" / "2 元/笔"。
    withdrawFeeText: { type: String, value: '0%' }
  },
  data: {
    title: '陪玩中心', selected: 0,
    fineTabs: ['全部', '待缴纳', '已缴纳', '已撤销'], balanceTabs: ['全部', '收入', '支出'],
    methods: ['支付宝', '微信', '银行卡'],
    funds: [
      { name: '保证金', target: 'bound' }, { name: '可用佣金', target: 'withdraw' },
      { name: '冻结佣金', target: 'balanceLog' }, { name: '累计结算', target: 'balanceLog' },
      { name: '本月结算', target: 'balanceLog' }, { name: '上月结算', target: 'balanceLog' },
      { name: '总已交罚款', target: 'fine' }, { name: '待交罚款', target: 'fine' }
    ]
  },
  methods: {
    navigate(event) {
      const target = event.currentTarget.dataset.target;
      if (titles[target]) this.triggerEvent('navigate', target);
    },
    select(event) { this.setData({ selected: Number(event.currentTarget.dataset.index) || 0 }); },
    // 管事三件事都交给页面处理（组件只管展示，不自己发请求）。
    redeem() { this.triggerEvent('redeem'); },
    copyCode() { this.triggerEvent('copycode'); },
    generate() { this.triggerEvent('generate'); },
    explain() {
      wx.showModal({ title: '功能暂未接通', content: '页面已适配，但对应业务接口尚未接通。这里的“—”不是零余额；不会保存收款资料、发起支付、提现或扣款。', showCancel: false });
    }
  }
});
