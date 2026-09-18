const fallbackConfig = {
  clubName: "示例电竞俱乐部",
  productsPerRow: 2,
  popupEnabled: true,
  broadcastEnabled: true,
  detailFloatEnabled: true,
  // 详情页飘屏与评价区都只用「商户审核通过」的真实评价，服务端随公开配置一起下发。
  reviews: [],
  // 注：orderMustReadEnabled（「下单必看」弹窗开关）已随弹窗一起从客户端删除（2026-09-17 用户要求），
  //     网页端与后台的对应功能仍在，配置字段照旧下发，客户端不再读它。
  popupHeader: "公告通知",
  popupTitle: "下单前请阅读",
  popupContent: "当前是真机本地预览。正式服务器接通后，这里会显示商户后台配置的公告、商品和订单数据。",
  mustReadText: "请填写真实游戏昵称、ID 和区服。下单后请保持在线，客服会尽快安排接单。",
  // 提现手续费：打手提现被收的总手续费，再在管事和商户之间分。
  // 结构、含义与继承覆盖规则见 shared.js 的 normalizeWithdrawFee；
  // 商户在后台「分销管理」里配（2026-09-18 用户要求，原来那三个 stewardWithdrawFee* 字段已并入这里）。
  withdrawFee: { staff: { mode: "rate", value: 0 }, stewardShareRate: 0, staffOverrides: {}, stewardOverrides: {}, stewardSelf: { enabled: false, mode: "rate", value: 0 } },
  heroEyebrow: "俱乐部服务承诺",
  heroTitle: "客户下单，客服全程跟进",
  heroSubtitle: "自助下单 · 状态可查 · 售后可追踪",
  heroEyebrowEnabled: true,
  heroTitleEnabled: true,
  heroSubtitleEnabled: true,
  categoryTree: [
    { name: "和平精英", imageUrl: "", children: ["保底单", "基础单", "加急单", "售后单"], gameServers: ["手机端", "电脑端"] },
    { name: "三角洲行动", imageUrl: "", children: ["大红单", "保险单", "清图单"], gameServers: ["手机端", "电脑端"] },
    { name: "王者荣耀", imageUrl: "", children: ["上分单", "陪玩单", "冲榜单"], gameServers: ["手机端", "电脑端"] }
  ],
  quickActions: {
    free: { enabled: true, icon: "免", title: "免单保障", text: "服务问题可联系商户客服处理。", type: "notice" },
    compensate: { enabled: true, icon: "赔", title: "问题赔付", text: "请保留截图或录屏，客服核实后按规则处理。", type: "notice" },
    auto: { enabled: true, icon: "快", title: "自动安排", text: "提交订单后进入商户订单池。", type: "scrollProducts" },
    service: { enabled: true, icon: "客", title: "联系客服", text: "正式上线后跳转商户配置的微信客服。", type: "customerService" }
  },
  gameServers: [
    { id: "server_1", name: "手机端", enabled: true },
    { id: "server_2", name: "电脑端", enabled: true }
  ],
  products: [
    {
      id: "preview_1",
      title: "开荒保底单",
      orderTitle: "开荒保底单",
      mainCategory: "和平精英",
      subCategory: "保底单",
      category: "保底单",
      tag: "保底",
      price: 16.8,
      orderPrice: 16.8,
      oldPrice: 39.9,
      sold: 8698,
      views: 34960,
      status: "selling",
      desc: "本地预览商品。接通 HTTPS 接口后自动显示商户后台商品。"
    },
    {
      id: "preview_2",
      title: "新人体验单",
      orderTitle: "新人体验单",
      mainCategory: "和平精英",
      subCategory: "基础单",
      category: "基础单",
      tag: "新人",
      price: 48.8,
      orderPrice: 48.8,
      oldPrice: 68.8,
      sold: 1997,
      views: 8602,
      status: "selling",
      desc: "适合先体验下单流程和售后保障。"
    }
  ]
};

function createFallbackConfig() {
  return JSON.parse(JSON.stringify(fallbackConfig));
}

module.exports = { createFallbackConfig };
