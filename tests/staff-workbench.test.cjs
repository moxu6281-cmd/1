const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// 图像模块在载入时取得微信文件系统；这些测试只使用它的纯 URL 解析函数。
global.wx = { getFileSystemManager: () => ({}) };
const model = require('../miniprogram/pages/staff/view-model');
delete global.wx;

const config = { categoryTree: [{ name: '三角洲', imageUrl: '' }, { name: '王者', imageUrl: '' }], products: [{ id: 'p1', mainCategory: '三角洲' }], withdrawFee: { staff: { mode: 'rate', value: 10 }, stewardShareRate: 30 } };
const customer = { customerId: 'staff1', displayName: '真实昵称', numericId: '123456789' };
const fixtures = [
  { no: 'pool', productId: 'p1', product: '体验单', status: '待接单', paymentStatus: 'paid', price: 10, staffShare: 0 },
  { no: 'unpaid', status: '待接单', paymentStatus: 'pending' },
  { no: 'unknown-payment', status: '待接单' },
  { no: 'undrawn', status: '待接单', paymentStatus: 'paid', lottery: { status: 'pending' } },
  { no: 'foreign', staffId: 'staff2', status: '待开始', paymentStatus: 'paid' },
  { no: 'mine', staffId: 'staff1', status: '待开始', paymentStatus: 'paid', product: '服务A', gameId: 'id123', price: 20, staffIncome: 8.8 },
  { no: 'serving', staffId: 'staff1', status: '服务中', paymentStatus: 'paid', product: '服务B', price: 20 },
  { no: 'done', staffId: 'staff1', status: '已完成', paymentStatus: 'paid', price: 20 }
];
const event = (dataset) => ({ currentTarget: { dataset } });

function fixture() {
  let page, timer;
  const state = { orders: structuredClone(fixtures), updates: 0, actions: [], sent: [], messages: [], toasts: [], paths: [], reads: [], modals: [] };
  const storage = { club_active_identity: 'staff' };
  const api = {
    getStaffOrders: async () => { if (state.failLoad) throw state.failLoad; return state.orders; },
    getChatUnread: async () => ({ mine: 2 }),
    acceptStaffOrder: async (account, no) => { state.actions.push(['accept', account, no]); const order = state.orders.find(x => x.no === no); Object.assign(order, { staffId: 'staff1', status: '待开始' }); },
    staffOrderAction: async (account, no, action, image) => { state.actions.push([action, account, no, image]); state.orders.find(x => x.no === no).status = action === 'start' ? '服务中' : '待结单'; },
    getOrderChat: async (_, no, actor) => { state.reads.push([no, actor.role]); return { messages: [...state.messages] }; },
    sendOrderChat: async (_, no, payload) => { if (state.failSend) throw Error('网络断开'); state.sent.push([no, payload]); state.messages.push({ id: '1', body: payload.text, isMine: true }); return { messages: [...state.messages] }; },
    // 管事：默认"不是管事"；用例把 state.steward 改成"已是管事"即可验证生成/复制分支。
    getSteward: async () => (state.steward ? structuredClone(state.steward) : { isSteward: false, myCode: '', superior: null, subordinates: [] }),
    redeemStewardCode: async (_, code) => {
      state.actions.push(['redeem', code]);
      if (state.failRedeem) throw Error(state.failRedeem);
      state.steward = { isSteward: true, myCode: 'ABCD2345', superior: null, subordinates: [] };
      return { ok: true, kind: 'steward' };
    },
    createStewardCode: async () => { state.actions.push(['createCode']); state.created = 'WXYZ6789'; return state.created; }
  };
  const app = { globalData: { merchantAccount: 'fixture', apiBaseUrl: 'https://example.test' }, ensureCustomerIdentity: async () => customer, loadConfig: async () => config };
  const wx = { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
    showToast: data => state.toasts.push(data), switchTab: data => state.paths.push(data.url),
    // showModal 按 showModalAnswer 立刻回调（默认确认 + 填好的邀请码），
    // 否则 await showModal 的管事流程会永远挂住。
    showModal: data => { state.modals.push(data.title); const answer = state.showModalAnswer || { confirm: true, content: state.modalContent || '7K3M9QRT' }; if (typeof data.success === 'function') data.success(answer); },
    showLoading() {}, hideLoading() {},
    pageScrollTo() {}, stopPullDownRefresh() {}, setClipboardData: data => { state.clipboard = data.data; } };
  const context = vm.createContext({ Page: value => { page = value; }, require: name => name === './view-model' ? model : api,
    getApp: () => app, wx, setInterval: callback => { timer = callback; return 1; }, clearInterval() {}, setTimeout() {}, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../miniprogram/pages/staff/index.js'), 'utf8'), context);
  page.setData = (patch, callback) => { state.updates++; Object.assign(page.data, patch); callback?.(); };
  page.active = true;
  page.showRevision = 1;
  return { page, state, api, app, storage, timer: () => timer() };
}

test('dashboard uses paid available orders and only the current staff tasks', () => {
  const data = model.dashboard(fixtures, customer, config, '', { mine: 2 });
  assert.deepEqual(data.pendingOrders.map(x => x.no), ['pool']);
  assert.deepEqual(data.myTasks.map(x => x.no), ['mine', 'serving', 'done']);
  assert.equal(data.games[0].count, 1);
  assert.equal(data.stats.find(x => x.status === '待开始').count, 1);
  assert.equal(data.stats.find(x => x.status === '协助单').count, '—');
  assert.equal(data.unreadCount, 2);
  assert.equal(data.pendingOrders[0].incomeText, '0.00', 'zero configured share must not become 70 percent');
  assert.equal(data.myTasks[1].incomeText, '待确认', 'missing income must not be invented');
  assert.equal(data.myTasks[0].incomeText, '8.80');
});

test('status, category, search and all five tabs use actual loaded lists', async () => {
  const { page } = fixture(); await page.load();
  page.chooseGame(event({ game: '三角洲' })); assert.equal(page.data.visibleOrders[0].no, 'pool');
  page.chooseGame(event({ game: '王者' })); assert.equal(page.data.visibleOrders.length, 0);
  page.chooseStatus(event({ status: '待开始' })); assert.equal(page.data.visibleOrders[0].no, 'mine');
  page.search({ detail: { value: 'id123' } }); assert.equal(page.data.visibleOrders.length, 1);
  page.search({ detail: { value: 'not found' } }); assert.equal(page.data.visibleOrders.length, 0);
  page.chooseTab(event({ tab: 'chat' })); assert.equal(page.data.visibleOrders.length, 3);
  page.chooseTab(event({ tab: 'withdraw' })); assert.equal(page.data.activeTab, 'withdraw');
  page.chooseTab(event({ tab: 'home' })); assert.equal(page.data.activeTab, 'home');
  page.chooseStatus(event({ status: '协助单' })); assert.equal(page.data.feature, 'assistance');
});

test('silent polling with unchanged data causes no setData, draft or filter reset', async () => {
  const { page, state } = fixture(); await page.load();
  page.chooseStatus(event({ status: '服务中' }));
  const before = state.updates; await page.load({ silent: true });
  assert.equal(state.updates, before);
  assert.equal(page.data.activeStatus, '服务中');
  assert.equal(page.data.visibleOrders[0].no, 'serving');
});

test('recovering from a load error clears error even when returned orders are unchanged', async () => {
  const { page, state } = fixture(); await page.load();
  state.failLoad = Error('offline'); await page.load(); assert.equal(page.data.error, 'offline');
  state.failLoad = null; await page.load({ silent: true }); assert.equal(page.data.error, '');
});

test('accept, start and evidence submit still call original APIs and refresh statuses', async () => {
  const { page, state } = fixture(); await page.load();
  await page.acceptOrder(event({ no: 'pool' }));
  assert.equal(state.actions[0][0], 'accept'); assert.equal(page.data.activeStatus, '待开始');
  assert.equal(page.data.pendingOrders.length, 0);
  await page.startOrder(event({ no: 'pool' }));
  assert.equal(page.data.myTasks.find(x => x.no === 'pool').status, '服务中');
  await page.performOrderAction('pool', 'submit-proof', 'data:image/png;base64,fixture');
  assert.equal(page.data.myTasks.find(x => x.no === 'pool').status, '待结单');
  assert.equal(state.actions[2][3], 'data:image/png;base64,fixture');
});

test('double taps on accept do not duplicate requests', async () => {
  const { page, api } = fixture(); await page.load();
  let calls = 0, resolve;
  api.acceptStaffOrder = () => { calls++; return new Promise(r => { resolve = r; }); };
  const first = page.acceptOrder(event({ no: 'pool' }));
  await page.acceptOrder(event({ no: 'pool' })); assert.equal(calls, 1);
  resolve(); await first;
});

test('chat preserves failed drafts, uses staff role and refreshes new messages', async () => {
  const { page, state } = fixture(); await page.load();
  await page.openChat(event({ no: 'mine' }));
  page.onChatInput({ detail: { value: '保留草稿' } }); state.failSend = true;
  await page.sendChat(); assert.equal(page.data.chatInput, '保留草稿'); assert.equal(page.data.sending, false);
  state.failSend = false; await page.sendChat();
  assert.equal(state.sent[0][1].role, 'staff'); assert.equal(page.data.chatInput, '');
  state.messages.push({ id: '2', body: '客户回复' }); await page.refreshChat();
  assert.equal(page.data.chatMessages[1].body, '客户回复');
  page.closeChat(); await page.syncing;
  assert.equal(page.data.chatVisible, false);
});

test('closing chat discards a late response from that conversation', async () => {
  const { page, api } = fixture(); await page.load(); await page.openChat(event({ no: 'mine' }));
  let resolve;
  api.getOrderChat = () => new Promise(r => { resolve = r; });
  const pending = page.refreshChat(); page.closeChat(); resolve({ messages: [{ id: 'late', body: 'late' }] });
  await pending; assert.equal(page.data.chatMessages.length, 0);
});

test('revoked staff permission clears lists and returns to mine', async () => {
  const { page, state } = fixture(); await page.load();
  state.failLoad = Object.assign(Error('forbidden'), { code: 'STAFF_FORBIDDEN' });
  await page.load({ silent: true }); assert.equal(page.data.ready, false);
  assert.equal(page.data.myTasks.length, 0); assert.equal(page.data.visibleOrders.length, 0);
  assert.equal(state.paths.at(-1), '/pages/mine/index');
});

test('boss switch updates identity without creating a new wallet or login', async () => {
  const { page, state, storage } = fixture(); await page.load(); page.switchToBoss();
  assert.equal(storage.club_active_identity, 'boss'); assert.equal(page.active, false);
  assert.equal(state.paths.at(-1), '/pages/mine/index');
});

test('pending old page response cannot overwrite data after hide', async () => {
  const { page, api } = fixture();
  let resolve;
  api.getStaffOrders = () => new Promise(r => { resolve = r; });
  const load = page.load(); await new Promise(r => setImmediate(r));
  page.onHide(); resolve(fixtures); await load;
  assert.equal(page.data.ready, false); assert.equal(page.data.myTasks.length, 0);
});

test('unconnected panels only navigate or explain and never call finance APIs', () => {
  let panel;
  const actions = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/components/staff-panel/index.js'), 'utf8'), {
    Component: value => { panel = value; }, wx: { showModal: value => actions.push(value.title) }
  });
  const component = { ...panel.methods, setData() {}, triggerEvent: (name, target) => actions.push([name, target]) };
  component.explain(); component.navigate(event({ target: 'withdrawLog' }));
  assert.deepEqual(actions, ['功能暂未接通', ['navigate', 'withdrawLog']]);
});

// —— 管事（2026-09-17 接通）：兑换 / 我的邀请码 / 生成下级码 / 下级与上级 ——

test('输入管事邀请码后升级为管事，并把服务端返回的身份写进页面', async () => {
  const { page, state } = fixture();
  await page.load();
  assert.equal(page.data.steward.isSteward, false);
  await page.redeemSteward();
  assert.deepEqual(state.actions.filter(item => item[0] === 'redeem'), [['redeem', '7K3M9QRT']]);
  assert.equal(page.data.steward.isSteward, true);
  assert.equal(page.data.steward.myCode, 'ABCD2345');
  assert.deepEqual(state.modals, ['输入管事邀请码', '已成为管事']);
});

test('取消输入邀请码时一个兑换请求都不发', async () => {
  const { page, state } = fixture();
  await page.load();
  state.showModalAnswer = { confirm: false };
  await page.redeemSteward();
  assert.deepEqual(state.actions.filter(item => item[0] === 'redeem'), []);
});

test('管事生成下级邀请码后把新码复制到剪贴板', async () => {
  const { page, state } = fixture();
  state.steward = { isSteward: true, myCode: 'ABCD2345', superior: null, subordinates: [] };
  await page.load();
  await page.generateStewardCode();
  assert.deepEqual(state.actions.filter(item => item[0] === 'createCode'), [['createCode']]);
  assert.equal(state.clipboard, 'WXYZ6789');
});

test('上级管事与下级打手按服务端数据展示，没有就留空不编造', async () => {
  const { page, state } = fixture();
  state.steward = {
    isSteward: true, myCode: 'ABCD2345',
    superior: { displayName: '上级管事', numericId: '111222333' },
    subordinates: [{ displayName: '小王', numericId: '222333444', code: 'WXYZ6789' }]
  };
  await page.load();
  assert.deepEqual(page.data.steward.subordinates.map(item => item.displayName), ['小王']);
  assert.equal(page.data.steward.superior.numericId, '111222333');

  const empty = fixture();
  await empty.page.load();
  assert.deepEqual(empty.page.data.steward.subordinates, []);
  assert.equal(empty.page.data.steward.superior, null);
  assert.equal(empty.page.data.steward.myCode, '');
});

test('提现手续费文案取商户后台配置的比例', async () => {
  const { page } = fixture();
  await page.load();
  assert.equal(page.data.withdrawFeeText, '10%');
});
