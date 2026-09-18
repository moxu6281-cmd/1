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

test('order tabs and scroll loading use real orders, then reset on status and search', async () => {
  const orders = Array.from({ length: 13 }, (_, index) => ({
    no: `DD${index}`, product: `商品${index}`, productId: 'p1', price: 8.8, quantity: 1,
    paymentStatus: index === 0 ? 'pending' : 'paid', status: index === 0 ? '待付款' : '待接单',
    gameName: `玩家${index}`, gameId: `ID${index}`, productDescription: '服务说明'
  }));
  const { page } = createPage(async () => orders);
  await page.load();
  assert.equal(page.data.visibleOrders.length, 10);
  assert.equal(page.data.hasMore, true);
  assert.equal(page.data.statusTabs.find((tab) => tab.label === '待付款').hasOrders, true);
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
  page.search({ detail: { value: 'ID12' } });
  assert.equal(page.data.visibleOrders.length, 1);
  assert.equal(page.data.visibleOrders[0].no, 'DD12');
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
  assert.equal(page.data.statusTabs.find((tab) => tab.label === '待付款').hasOrders, false);
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
