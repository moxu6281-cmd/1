const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createPage(loadOrders, apiOverrides = {}) {
  let definition;
  const app = { globalData: { merchantAccount: 'club001', apiBaseUrl: '', config: { products: [] } }, loadOrders, ensureCustomerIdentity: async () => ({}) };
  const wxMock = { modal: null, modalCount: 0, toasts: [], showToast(value) { this.toasts.push(value); }, showModal(value) { this.modal = value; this.modalCount++; }, navigateTo() {} };
  const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/orders/index.js'), 'utf8');
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    getApp: () => app,
    wx: wxMock,
    require(name) {
      if (name === '../../services/api') return { getChatUnread: async () => ({}), getMyReviews: async () => [], ...apiOverrides };
      if (name === '../../utils/data') return { money: (value) => Number(value || 0).toFixed(2) };
      if (name === '../../utils/image') return { resolveAssetUrl: (value) => value };
      throw new Error(`Unexpected import: ${name}`);
    }
  }, { filename: 'orders/index.js' });
  const page = { ...definition, data: { ...definition.data } };
  page.setData = (patch, done) => { Object.assign(page.data, patch); if (done) done(); };
  return { page, app, wxMock };
}

test('order tabs and scroll loading use real orders, then reset on status change', async () => {
  const orders = Array.from({ length: 13 }, (_, index) => ({
    no: `DD${index}`, product: `商品${index}`, productId: 'p1', price: 8.8, quantity: 1,
    paymentStatus: index === 0 ? 'pending' : 'paid', status: index === 0 ? '待付款' : '待接单',
    gameName: `玩家${index}`, gameId: `ID${index}`, productDescription: '服务说明'
  }));
  const { page } = createPage(async () => orders);
  await page.load();
  assert.equal(page.data.visibleOrders.length, 10);
  assert.equal(page.data.hasMore, true);
  // 2026-09-20 按要求删掉了状态标签红点，数据里不该再有那套 statusTabs/hasOrders。
  assert.equal('statusTabs' in page.data, false, '状态标签不该再有红点数据');
  page.loadMore();
  assert.equal(page.data.visibleOrders.length, 13);
  assert.equal(page.data.hasMore, false);
  page.choose({ currentTarget: { dataset: { status: '待付款' } } });
  assert.equal(page.data.visibleOrders.length, 1);
  assert.equal(page.data.visibleCount, 10);
  page.showServiceDetail({ currentTarget: { dataset: { no: 'DD0' } } });
  assert.equal(page.data.serviceOrder.productDescription, '服务说明');
  page.closeServiceDetail();
  assert.equal(page.data.serviceVisible, false);
  page.choose({ currentTarget: { dataset: { status: '全部' } } });
  // 2026-09-20 用户要求删掉订单页的搜索框：search()/filter()/keyword 一并撤掉，
  // 切回「全部」时列表必须仍然是全量（以前这里会残留搜索过滤）。
  assert.equal('keyword' in page.data, false, '搜索状态已删除');
  assert.equal(typeof page.search, 'undefined', '搜索处理器已删除');
  assert.equal(page.data.visibleOrders.length, 10);
});

test('older responses cannot replace the latest merchant or refresh', async () => {
  let resolveFirst;
  let resolveThird;
  let calls = 0;
  const { page, app } = createPage(() => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
    if (calls === 3) return new Promise((resolve) => { resolveThird = resolve; });
    return Promise.resolve([{ no: 'NEW', status: '待接单', paymentStatus: 'paid', price: 1 }]);
  });
  const first = page.load();
  await page.load();
  resolveFirst([{ no: 'OLD', status: '待付款', paymentStatus: 'pending', price: 1 }]);
  await first;
  assert.equal(page.data.orders[0].no, 'NEW');
  const third = page.load();
  app.globalData.merchantAccount = 'club002';
  resolveThird([{ no: 'WRONG_MERCHANT', status: '待接单', paymentStatus: 'paid', price: 1 }]);
  await third;
  assert.equal(page.data.orders[0].no, 'NEW');
});

test('complaint and cancellation buttons update from server results, with pending actions leaving the filter', async () => {
  let stored = { no: 'DD_ACTION', status: '待付款', paymentStatus: 'pending', paymentMethod: '', product: '商品', price: 8.8, quantity: 1 };
  let complaints = 0, cancellations = 0;
  const { page, wxMock } = createPage(async () => [stored], {
    submitOrderComplaint: async (_account, _no, content) => {
      complaints++;
      stored = { ...stored, complaint: { content, status: 'pending' } };
      return { order: stored };
    },
    cancelOrder: async () => {
      cancellations++;
      stored = { ...stored, status: '已取消', paymentStatus: 'cancelled' };
      return { order: stored };
    }
  });
  await page.load();
  page.choose({ currentTarget: { dataset: { status: '待付款' } } });
  page.openComplaint({ currentTarget: { dataset: { no: stored.no } } });
  page.onComplaintInput({ detail: { value: '服务内容需要商户核实' } });
  await page.submitComplaint();
  assert.equal(complaints, 1);
  assert.equal(page.data.complaintOrder.complaint.status, 'pending');
  await page.submitComplaint();
  assert.equal(complaints, 1);
  page.closeComplaint();
  page.cancelOrder({ currentTarget: { dataset: { no: stored.no } } });
  page.cancelOrder({ currentTarget: { dataset: { no: stored.no } } });
  assert.equal(wxMock.modalCount, 1);
  await wxMock.modal.success({ confirm: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert.equal(page.data.visibleOrders.length, 0);
  page.choose({ currentTarget: { dataset: { status: '全部' } } });
  assert.equal(page.data.visibleOrders[0].paymentStatus, 'cancelled');
  assert.equal(page.data.cancellingNo, '');
});

test('failed cancellation keeps the order payable and unlocks retry', async () => {
  const order = { no: 'DD_FAIL', status: '待付款', paymentStatus: 'pending', price: 8.8 };
  const { page, wxMock } = createPage(async () => [order], { cancelOrder: async () => { throw new Error('支付已发起'); } });
  await page.load();
  page.cancelOrder({ currentTarget: { dataset: { no: order.no } } });
  await wxMock.modal.success({ confirm: true });
  assert.equal(page.data.cancellingNo, '');
  assert.equal(page.data.visibleOrders[0].paymentStatus, 'pending');
  assert.equal(wxMock.toasts.at(-1).title, '支付已发起');
});

// 用户 2026-09-17 要求「已评价 ★★★★★」按「点亮 / 未点亮」拆两段上色（点亮橙、未点亮白）。
// 一个 <text> 只能有一个 color，所以点亮的那几颗放 reviewStars、剩下几颗放 reviewStarsEmpty，
// 两段拼起来恒为 5 颗 —— 数量对不上就会看到 3 颗或 7 颗星。
test('已评价的星星拆成点亮与未点亮两段，合计恒为 5 颗', async () => {
  const orders = ['R3', 'R5'].map((no) => ({ no, status: '已完成', paymentStatus: 'paid', price: 8.8, quantity: 1, product: '商品' }));
  const { page } = createPage(async () => orders, {
    getMyReviews: async () => [
      { orderNo: 'R3', rating: 3, status: 'approved', content: '还行' },
      { orderNo: 'R5', rating: 5, status: 'approved', content: '很好' }
    ]
  });
  await page.load();
  const byNo = Object.fromEntries(page.data.orders.map((item) => [item.no, item]));
  assert.equal(byNo.R3.reviewState, 'approved');
  assert.equal(byNo.R3.reviewStars, '★★★');
  assert.equal(byNo.R3.reviewStarsEmpty, '★★');
  assert.equal(byNo.R3.reviewStars.length + byNo.R3.reviewStarsEmpty.length, 5);
  assert.equal(byNo.R5.reviewStars, '★★★★★');
  assert.equal(byNo.R5.reviewStarsEmpty, '');
});

// 用户 2026-09-20 要求删掉状态标签右上角的红点（有订单就冒一个红色小圆点）。
// 那条红点靠 data.statusTabs[].hasOrders + .status-dot 渲染，三个都得消失，
// 所以这里同时盯住「数据不再产出」和「模板不再渲染」。
test('状态标签不再有红点数据，也不再渲染红点', async () => {
  const orders = [
    { no: 'DD1', status: '待付款', paymentStatus: 'pending', price: 8.8, quantity: 1, product: '商品' },
    { no: 'DD2', status: '待接单', paymentStatus: 'paid', price: 8.8, quantity: 1, product: '商品' }
  ];
  const { page } = createPage(async () => orders);
  await page.load();
  assert.equal('statusTabs' in page.data, false, '红点数据 statusTabs 已删除');
  assert.equal(page.data.statuses.length, 7, '状态标签仍由 statuses 驱动');
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/orders/index.wxml'), 'utf8');
  assert.equal(wxml.includes('status-dot'), false, '状态标签不能再渲染红点元素');
  assert.equal(wxml.includes('hasOrders'), false, '模板不该再引用 hasOrders');
});

// 老板端「确认结单」（2026-09-20 新增）：打手上传结单截图后订单停在「待结单」，
// 由下单老板点「确认结单」收尾（订单进已完成 + 打手佣金入账）。这里盯三件事：
// 走服务端接口（不是本地把状态改成已完成）、必须先二次确认、点取消不发请求。
test('待结单订单可以确认结单，且必须二次确认', async () => {
  let current = { no: 'DD_CONFIRM', status: '待结单', paymentStatus: 'paid', price: 8.8, quantity: 1, product: '商品', staffId: 'staff-1' };
  let calls = 0;
  const { page, wxMock } = createPage(async () => [current], {
    confirmOrder: async (account, no) => { calls += 1; current = { ...current, status: '已完成' }; return { order: current }; }
  });
  await page.load();
  page.confirmOrder({ currentTarget: { dataset: { no: current.no } } });
  assert.equal(wxMock.modalCount, 1, '确认结单必须先弹确认框');
  await wxMock.modal.success({ confirm: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 0, '点了取消不能发请求');
  assert.equal(page.data.confirmingNo, '');
  page.confirmOrder({ currentTarget: { dataset: { no: current.no } } });
  await wxMock.modal.success({ confirm: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(page.data.orders.find((item) => item.no === current.no).status, '已完成');
  assert.equal(page.data.confirmingNo, '');
});

// 每个状态先选主操作，模板先渲染它；样式按参考图显示在同一行右侧。
// 主操作由 index.js 的 primaryActionOf() 一个函数算，所以这里逐状态钉住「正好一个」，
// 再钉住模板确实按 item.primaryAction 渲染、且主操作排在第一段
// （以前是各状态在 wx:if 里各写一套，加个新状态就会漏）。
test('每个订单状态都有且只有一个主操作，视觉上排在右侧', async () => {
  const raw = [
    { no: 'A', paymentStatus: 'pending', status: '待付款' },
    { no: 'B', paymentStatus: 'paid', status: '待抽奖', lottery: { status: 'pending' } },
    { no: 'C', paymentStatus: 'paid', status: '待接单' },
    { no: 'D', paymentStatus: 'paid', status: '待开始', staffId: 's1' },
    { no: 'E', paymentStatus: 'paid', status: '服务中', staffId: 's1' },
    { no: 'F', paymentStatus: 'paid', status: '待结单', staffId: 's1', completionProof: { file: 'a.png' } },
    { no: 'G', paymentStatus: 'paid', status: '已完成', staffId: 's1' },
    { no: 'H', paymentStatus: 'cancelled', status: '已取消' }
  ];
  const { page } = createPage(async () => raw);
  await page.load();
  const actual = Object.fromEntries(page.data.orders.map((item) => [item.no, item.primaryAction]));
  assert.deepEqual(actual, {
    A: 'pay', B: 'openLottery', C: 'openDetail', D: 'openChat',
    E: 'openChat', F: 'confirmOrder', G: 'buyAgain', H: 'buyAgain'
  });
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/orders/index.wxml'), 'utf8');
  const actions = /<view class="order-actions">([\s\S]*?)<\/view>/.exec(wxml);
  assert.ok(actions, '订单卡片必须有一个 .order-actions 按钮行');
  const markup = actions[1];
  const first = /<button[^>]*>/.exec(markup)[0];
  assert.ok(first.includes('class="primary wide"'), '主操作需要独立样式');
  assert.ok(/wx:if="\{\{item\.primaryAction === 'pay'\}\}"/.test(first), '主操作必须是这一行里的第一个按钮');
  assert.equal((markup.match(/primary wide/g) || []).length, 6, '主操作按 primaryAction 分支渲染（6 个分支：付款/抽奖/结单/再次购买/聊天/兜底详情）');
  const wxss = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/orders/index.wxss'), 'utf8');
  assert.match(wxss, /\.order-actions button\.wide\s*\{\s*order:\s*1;/, '主操作视觉上应排在右侧');
  assert.doesNotMatch(wxss, /\.order-actions button\.wide\s*\{[^}]*flex:\s*0\s+0\s+100%/, '主操作不能独占一整行');
  assert.equal(markup.includes('pending-actions'), false, '不该再按状态切整套布局（pending-actions 特例已删）');
  // 次要操作顺序固定：查看详情 → 订单聊天 → 订单投诉 → 再次购买 → 取消订单
  const secondary = markup.match(/<button(?![^>]*primary wide)[^>]*>[^<]*<\/button>/g) || [];
  assert.deepEqual(secondary.map((tag) => /bindtap="(\w+)"/.exec(tag)[1]),
    ['openDetail', 'openChat', 'openComplaint', 'buyAgain', 'openReview', 'previewCancelOrder'], '次要操作的顺序乱掉了');
});

test('取消按钮暂不请求接口，服务开始后不可点击', async () => {
  let calls = 0;
  const { page, wxMock } = createPage(async () => [{ no: 'A', status: '待开始', paymentStatus: 'paid' }],
    { cancelOrder: async () => { calls++; return {}; } });
  await page.load();
  page.previewCancelOrder();
  assert.equal(calls, 0);
  assert.equal(page.data.orders[0].status, '待开始');
  assert.equal(wxMock.toasts.at(-1).title, '取消功能暂未开放');
  const markup = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/orders/index.wxml'), 'utf8');
  assert.match(markup, /bindtap="previewCancelOrder" disabled="{{item.status === '服务中' \|\| item.status === '待结单' \|\| item.status === '已完成'}}"/);
});
