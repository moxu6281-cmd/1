const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// 图像模块在载入时取得微信文件系统；这些测试只使用它的纯 URL 解析函数。
global.wx = { getFileSystemManager: () => ({}) };
const model = require('../miniprogram/pages/staff/view-model');
delete global.wx;
// 页面和组件都会 require 它；vm 里的 require 必须把真模块给过去，不能统一返回 api 桩。
const fundsUtil = require('../miniprogram/utils/funds');

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
  const state = { orders: structuredClone(fixtures), updates: 0, actions: [], sent: [], messages: [], toasts: [], paths: [], reads: [], modals: [], titles: [] };
  const storage = { club_active_identity: 'staff' };
  const api = {
    getStaffOrders: async () => { if (state.failLoad) throw state.failLoad; return state.orders; },
    getChatUnread: async () => ({ mine: 2 }),
    acceptStaffOrder: async (account, no) => { if (state.failAccept) throw Error('接单失败'); state.actions.push(['accept', account, no]); const order = state.orders.find(x => x.no === no); Object.assign(order, { staffId: 'staff1', status: '待开始' }); },
    staffOrderAction: async (account, no, action, image) => { if (state.failAction) throw Error('操作失败'); state.actions.push([action, account, no, image]); state.orders.find(x => x.no === no).status = action === 'start' ? '服务中' : '待结单'; },
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
    createStewardCode: async () => { state.actions.push(['createCode']); state.created = 'WXYZ6789'; return state.created; },
    // 8 格资金指标：工作台「我的资金」和余额明细头部都读它。
    // 失败时返回 code 0（服务端业务失败码），页面必须保留上一份、不编 0。
    thugMsg: async () => {
      state.fundCalls = (state.fundCalls || 0) + 1;
      if (state.failFunds) return { code: 0, msg: state.failFunds };
      return { code: 1, data: structuredClone(state.fundData || {
        bond: 50, available_money: 12.5, frozen_money: 8.8, total_settled: 100,
        month_settled: 60, last_month_settled: 40, fine_paid_total: 5, fine_unpaid_total: 20,
        bond_money: 50, bond_tiers: [10, 20, 50, 100], bond_recommended: 20, jd_status: '', manager_withdraw_rate: 10
      }) };
    },
    // 罚单：默认一页给满 15 条（= 还有更多），用例可以改 state.fines 造空态 / 到底。
    fineList: async (_, params = {}) => {
      state.fineCalls = state.fineCalls || [];
      state.fineCalls.push(structuredClone(params));
      if (state.failFines) return { code: 0, msg: state.failFines };
      return { code: 1, data: structuredClone(state.fines || {
        list: [{ id: 7, fine_no: 'FN1', status: 0, status_text: '待缴', reason: '迟到', amount: 20, fine_time_text: '2026-09-18 10:00:00', pay_time_text: '', punish_text: '', order_no: '' }],
        unpaid_total: 20
      }) };
    },
    finePay: async (_, payload) => {
      state.actions.push(['finePay', payload]);
      if (state.failFinePay) return { code: 0, msg: state.failFinePay };
      return { code: 1, data: { fineNo: payload.fine_no, amount: 20, available: 0, mode: 'direct', message: '缴纳成功' } };
    },
    thugCommissionLog: async (_, params = {}) => {
      state.logCalls = state.logCalls || [];
      state.logCalls.push(structuredClone(params));
      if (state.failLog) return { code: 0, msg: state.failLog };
      return { code: 1, data: structuredClone(state.log || [{
        id: 3, type: 'order_commission', type_text: '完成解冻', amount_text: '8.80', available_after: 12.5,
        goods_name: '服务A', fine_reason: '', createtime: 1, createtime_text: '2026-09-18 09:00:00'
      }]) };
    },
    thugBond: async (_, payload) => {
      state.actions.push(['thugBond', payload]);
      if (state.failBond) return { code: 0, msg: state.failBond };
      return { code: 1, data: { bondNo: 'BD1', money: payload.money, bond: 50 + payload.money, mode: 'direct', message: '保证金充值成功' } };
    }
  };
  const app = { globalData: { merchantAccount: 'fixture', apiBaseUrl: 'https://example.test' }, ensureCustomerIdentity: async () => customer, loadConfig: async () => state.config || config };
  const wx = { getStorageSync: key => storage[key], setStorageSync: (key, value) => { storage[key] = value; },
    showToast: data => state.toasts.push(data), switchTab: data => state.paths.push(data.url),
    // showModal 按 showModalAnswer 立刻回调（默认确认 + 填好的邀请码），
    // 否则 await showModal 的管事流程会永远挂住。
    showModal: data => { state.modals.push(data.title); const answer = state.showModalAnswer || { confirm: true, content: state.modalContent || '7K3M9QRT' }; if (typeof data.success === 'function') data.success(answer); },
    showLoading() {}, hideLoading() {}, navigateTo: data => state.paths.push(data.url),
    pageScrollTo() {}, stopPullDownRefresh() {}, setClipboardData: data => { state.clipboard = data.data; },
    setNavigationBarTitle: data => state.titles.push(data.title) };
  const context = vm.createContext({ Page: value => { page = value; },
    require: name => name === './view-model' ? model : name.includes('utils/funds') ? fundsUtil : api,
    getApp: () => app, wx, setInterval: callback => { timer = callback; return 1; }, clearInterval() {}, setTimeout() {}, clearTimeout() {}, console });
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
  const { page, state } = fixture(); await page.load();
  page.chooseGame(event({ game: '三角洲' })); assert.equal(page.data.visibleOrders[0].no, 'pool');
  page.chooseGame(event({ game: '王者' })); assert.equal(page.data.visibleOrders.length, 0);
  page.chooseStatus(event({ status: '待开始' })); assert.equal(page.data.visibleOrders[0].no, 'mine');
  page.search({ detail: { value: 'id123' } }); assert.equal(page.data.visibleOrders.length, 1);
  page.search({ detail: { value: 'not found' } }); assert.equal(page.data.visibleOrders.length, 0);
  page.chooseTab(event({ tab: 'chat' })); assert.equal(page.data.visibleOrders.length, 3);
  // 「佣金提现」是独立页面（提现/提现资料/提现记录三块 + 每次进页重拉配置），
  // 所以这个 tab 不改 activeTab，直接跳走 —— 工作台里不再内嵌提现界面。
  page.chooseTab(event({ tab: 'withdraw' }));
  assert.equal(state.paths.at(-1), '/pages/withdraw/index');
  assert.equal(page.data.activeTab, 'chat');
  page.chooseTab(event({ tab: 'home' })); assert.equal(page.data.activeTab, 'home');
  page.chooseStatus(event({ status: '协助单' })); assert.equal(page.data.feature, 'assistance');
});

// 点「搜索」= 把关键词交给服务端做模糊匹配（服务端匹配的字段比本地那 4 个多），
// 一旦 searchTerm 非空，本地就必须停止二次过滤 —— 否则「服务端搜到了、本地又砍掉」会丢单。
// 2026-09-20 真实踩过的坑：服务端进程还是旧代码（不认 q）→ 它返回全量 → 前端又不过滤 →
// 用户看到的就是「点搜索毫无反应」。所以这条要同时钉住「请求真的带了 q」和「结果不再本地过滤」。
test('点「搜索」把关键词交给服务端，服务端返回的结果不再被本地二次过滤', async () => {
  const { page, state, api } = fixture();
  const calls = [];
  api.getStaffOrders = async (_account, options = {}) => { calls.push(structuredClone(options)); return state.orders; };
  await page.load();
  page.chooseStatus(event({ status: '全部' }));
  const baseline = calls.length;

  // 打字阶段是本地即时过滤，不该打服务端
  page.search({ detail: { value: 'id123' } });
  assert.equal(page.data.visibleOrders.length, 1, '打字时本地即时过滤');
  assert.equal(calls.length, baseline, '打字不该发请求');

  await page.submitSearch();
  assert.equal(calls.length, baseline + 1, '点「搜索」必须打一次服务端');
  assert.equal(calls.at(-1).q, 'id123', '关键词要放在 q 里交给服务端');
  assert.equal(page.data.searchTerm, 'id123');

  // 服务端说它匹配（哪怕本地那 4 个字段匹配不上）→ 页面必须照单全收
  api.getStaffOrders = async () => [state.orders.find((order) => order.no === 'serving')];
  page.search({ detail: { value: '服务端匹配但本地匹配不上的词' } });
  await page.submitSearch();
  assert.equal(page.data.visibleOrders.length, 1, '服务端过滤过之后本地不能再砍一刀');
  assert.equal(page.data.visibleOrders[0].no, 'serving');

  // 清空输入框再点一次 = 退出搜索，回到全量
  api.getStaffOrders = async (_account, options = {}) => { calls.push(structuredClone(options)); return state.orders; };
  page.search({ detail: { value: '' } });
  await page.submitSearch();
  assert.equal(page.data.searchTerm, '', '空关键词要退出搜索态');
  assert.equal(calls.at(-1).q, '', '空关键词不该带 q');
});

// load() 开头有「已有一轮同步在跑就先 await 它」的合并逻辑，合并完发现本 revision 已加载过就 return。
// 点「搜索」正好撞上 5 秒轮询时，搜索词被设进去、数据却没重拉，而本地又已经让位给服务端
// —— 表现同样是「点搜索没反应」。所以 submitSearch 必须带 force 穿透这个合并。
test('5 秒轮询进行中点「搜索」不会被合并逻辑吞掉', async () => {
  const { page, state, api } = fixture();
  const calls = [];
  let releasePolling = null;
  api.getStaffOrders = async (_account, options = {}) => {
    calls.push(structuredClone(options));
    if (calls.length === 1) return new Promise((resolve) => { releasePolling = () => resolve(state.orders); });
    return state.orders;
  };
  const polling = page.load({ silent: true });   // 模拟轮询挂在半路
  page.chooseStatus(event({ status: '全部' }));
  page.search({ detail: { value: 'id123' } });
  const searching = page.submitSearch();
  // 先让轮询走到「发出请求并挂住」，再放它回来 —— 这样 submitSearch 正好撞在合并窗口上。
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(releasePolling, '轮询应该已经发出请求并挂住');
  releasePolling();
  await polling;
  await searching;
  // 关键：合并逻辑只能吞掉重复请求，不能连搜索一起吞。少了 force 这里就只有 1 次。
  assert.ok(calls.length >= 2, '搜索必须真的再拉一次数据（不能被正在进行的轮询合并掉，实测 ' + calls.length + ' 次）');
  assert.equal(calls.at(-1).q, 'id123', '最后那次请求要带搜索词');
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
  assert.equal(page.data.flowNotice.status, '待开始');
  assert.equal(page.data.visibleOrders.map(order => order.no).join(','), 'pool,mine');
  assert.equal(page.data.pendingOrders.length, 0);
  await page.startOrder(event({ no: 'pool' }));
  assert.equal(page.data.myTasks.find(x => x.no === 'pool').status, '服务中');
  assert.equal(page.data.activeStatus, '服务中');
  assert.equal(page.data.flowNotice.status, '服务中');
  assert.ok(page.data.visibleOrders.some(order => order.no === 'pool'));
  await page.performOrderAction('pool', 'submit-proof', 'data:image/png;base64,fixture');
  assert.equal(page.data.myTasks.find(x => x.no === 'pool').status, '待结单');
  assert.equal(page.data.activeStatus, '待结单');
  assert.equal(page.data.flowNotice.status, '待结单');
  assert.ok(page.data.visibleOrders.some(order => order.no === 'pool'));
  assert.equal(state.actions[2][3], 'data:image/png;base64,fixture');
});

test('detail actions follow the same status transition; failed actions do not navigate', async () => {
  const { page, state } = fixture(); await page.load();
  page.openDetail(event({ no: 'mine' }));
  state.failAction = true;
  await page.startOrder(event({ no: 'mine' }));
  assert.equal(page.data.detailOrder.no, 'mine');
  assert.equal(page.data.flowNotice, null);
  assert.equal(page.data.activeStatus, '全部');
  state.failAction = false;
  await page.startOrder(event({ no: 'mine' }));
  assert.equal(page.data.detailOrder, null);
  assert.equal(page.data.activeStatus, '服务中');
  assert.equal(state.titles.at(-1), '我的订单');
  page.onHide();
  assert.equal(page.data.flowNotice, null);
});

test('action refresh does not reuse a polling response captured before the status changed', async () => {
  const { page, state, api } = fixture(); await page.load();
  let release, entered;
  const pollingStarted = new Promise(resolve => { entered = resolve; });
  let reads = 0;
  api.getStaffOrders = async () => {
    reads++;
    const snapshot = structuredClone(state.orders);
    if (reads === 1) { entered(); await new Promise(resolve => { release = resolve; }); }
    return snapshot;
  };
  const polling = page.load({ silent: true });
  await pollingStarted;
  const action = page.startOrder(event({ no: 'mine' }));
  release();
  await Promise.all([polling, action]);
  assert.equal(reads, 2);
  assert.equal(page.data.activeStatus, '服务中');
  assert.equal(page.data.flowNotice.status, '服务中');
});

test('bond gate follows merchant threshold and refreshed staff balance', async () => {
  const { page, state } = fixture();
  state.config = { ...config, staffBondRequirement: 50.01 };
  await page.load();
  assert.equal(page.data.bondEligible, false);
  assert.equal(page.data.bondRequirementText, '50.01');
  assert.equal(page.data.bondBalanceText, '50.00');
  await page.acceptOrder(event({ no: 'pool' }));
  assert.equal(state.actions.length, 0);
  page.openBond();
  assert.equal(page.data.feature, 'bound');
  state.fundData = { bond: 50.01 };
  await page.load();
  assert.equal(page.data.bondEligible, true);
  await page.acceptOrder(event({ no: 'pool' }));
  assert.equal(state.actions[0][0], 'accept');
  state.config.staffBondRequirement = 0;
  state.fundData = { bond: 0 };
  await page.load();
  assert.equal(page.data.bondEligible, true, 'zero threshold allows an empty bond account');
});

test('hall view follows preview, full detail and real acceptance without inventing benefits', async () => {
  const { page, state } = fixture();
  state.orders[0].gameId = 'private-id';
  state.orders[0].paidAt = 1789773475000;
  await page.load();
  page.openPreview(event({ no: 'pool' }));
  assert.equal(state.titles.at(-1), '订单预览');
  assert.equal(page.data.previewOrder.no, 'pool');
  assert.equal(page.data.previewOrder.incomeText, '0.00');
  assert.equal(page.data.previewOrder.memberLevel, undefined);
  assert.ok(page.data.previewOrder.paidTimeText);
  page.previewDetail();
  assert.equal(state.titles.at(-1), '订单详情');
  assert.equal(page.data.detailOrder.no, 'pool');
  page.closeDetail();
  assert.equal(state.titles.at(-1), '订单预览');
  assert.equal(page.data.detailOrder, null);
  assert.equal(page.data.previewOrder.no, 'pool');
  page.previewDetail();
  await page.acceptOrder(event({ no: 'pool' }));
  assert.equal(state.actions.at(-1)[0], 'accept');
  assert.equal(page.data.detailOrder, null);
  assert.equal(page.data.previewOrder, null);
  assert.equal(page.data.myTasks.find(order => order.no === 'pool').gameId, 'private-id');
});

test('preview closes when its order leaves the hall on refresh', async () => {
  const { page, state } = fixture(); await page.load();
  page.openPreview(event({ no: 'pool' }));
  state.orders[0].status = '已取消';
  await page.load({ silent: true });
  assert.equal(page.data.previewOrder, null);
  assert.equal(page.data.detailOrder, null);
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
    Component: value => { panel = value; }, wx: { showModal: value => actions.push(value.title) },
    require: name => (name.includes('utils/funds') ? fundsUtil : {})
  });
  const component = { ...panel.methods, setData() {}, triggerEvent: (name, target) => actions.push([name, target]) };
  component.explain(); component.navigate(event({ target: 'withdraw' }));
  // 老的 withdrawLog / settlement 两个 mode 已经并进提现页，这里再点不该抛出任何事件（否则页面会渲染一个空壳）。
  component.navigate(event({ target: 'withdrawLog' }));
  assert.deepEqual(actions, ['功能暂未接通', ['navigate', 'withdraw']]);
});

test('我的资金 8 格全部读服务端指标并统一 money() 格式化', () => {
  let panel;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../miniprogram/components/staff-panel/index.js'), 'utf8'), {
    Component: value => { panel = value; }, wx: { showModal() {} },
    require: name => (name.includes('utils/funds') ? fundsUtil : {})
  });
  let grid = null;
  // 观察者是以组件实例为 this 调的，实例上得有 methods（applyFunds 在里面）。
  const instance = { ...panel.methods, data: { fines: [], commission: [], commissionTab: 0 },
    setData: (patch) => { if (patch.fundGrid) grid = patch.fundGrid; } };
  panel.properties.fundData.observer.call(instance, {
    bond: 50, available_money: 12.5, frozen_money: 8.8, total_settled: 100,
    month_settled: 60, last_month_settled: 40, fine_paid_total: 5, fine_unpaid_total: 20
  });
  // 跨 realm 的数组不能用 deepStrictEqual 比（原型不同），拼成字符串比内容。
  assert.equal(grid.map((item) => item.label).join('|'), '保证金|可用佣金|冻结佣金|累计结算|本月结算|上月结算|总已交罚款|待交罚款');
  // ⚠️ 8 个字段**全部**两位小数，一个都不能少 —— 原版只给 frozen_money / available_money
  // 做了 toFixed，整数 100 就被渲染成 "100"。这条断言就是钉住那个 bug 的。
  assert.equal(grid.map((item) => item.value).join('|'), '50.00|12.50|8.80|100.00|60.00|40.00|5.00|20.00');
  assert.equal(grid[1].target, 'withdraw');
  assert.equal(grid[7].warn, true, '「待交罚款」要带红色警示标记（warn-num）');
});

test('取不到资金指标时 8 格显示「—」而不是 0.00，也不清掉已有数据', async () => {
  const { page, state } = fixture();
  state.failFunds = 'offline';
  await page.load();
  // 首次就失败 → 没有任何数据可显示，就是 null（组件据此渲染「—」），不该编一排 0.00。
  assert.equal(page.data.fundData, null);
  assert.equal(fundsUtil.indicatorList(page.data.fundData)[1].value, '—');
  assert.equal(page.data.withdrawFeeText, '10%');
  state.failFunds = null;
  await page.load();
  assert.equal(fundsUtil.indicatorList(page.data.fundData)[1].value, '12.50');
  // 已经拿到过数据之后再失败，必须保留上一份，不能退回空。
  state.failFunds = 'offline';
  await page.load();
  assert.equal(fundsUtil.indicatorList(page.data.fundData)[1].value, '12.50');
});

test('「余额明细」头部读同一份资金指标，不是写死的 ¥ —', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/components/staff-panel/index.wxml'), 'utf8');
  const staffWxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/staff/index.wxml'), 'utf8');
  assert.ok(wxml.includes('>可用佣金</text><text class="money-value">¥ {{headerSums.available}}</text>'),
    '余额明细头部的「可用佣金」必须绑 headerSums.available');
  assert.ok(wxml.includes('>冻结佣金</text><text class="money-value money-income">¥ {{headerSums.frozen}}</text>'),
    '头部要同时给「冻结佣金」——三本账里唯一没在别处露面的那本');
  assert.ok(!wxml.includes('>可用佣金</text><text class="money-value">¥ —</text>'),
    '不许退回写死的 ¥ —（那就是「没有代码」）');
  // 8 格指标和余额明细头部是同一份数据（fund-data / headerSums 都来自 pages/staff 拉的 thugMsg），
  // 页面必须把 fund-data 透传给组件，别只给九宫格。
  assert.ok(staffWxml.includes('fund-data="{{fundData}}"'), '页面要把 8 格指标透传给组件');
});

// —— 资金模块（2026-09-18 接通）：8 格指标 / 保证金充值 / 罚单三态与缴纳 / 佣金流水 ——

test('保证金充值：档位默认选中推荐档，自定义金额优先，校验不过不发请求', async () => {
  const { page, state } = fixture();
  await page.load();
  assert.equal(page.data.fundData.bond, 50);
  // 自定义金额优先于档位；0 / 空 / 非数字都必须被前端拦下，一个请求都不发。
  await page.submitBond({ detail: { money: 0 } });
  await page.submitBond({ detail: { money: NaN } });
  assert.deepEqual(state.actions.filter(item => item[0] === 'thugBond'), []);
  await page.submitBond({ detail: { money: 20 } });
  const bondCalls = state.actions.filter(item => item[0] === 'thugBond');
  // 跨 realm 的对象/数组不能用 deepEqual 比（原型不同），逐字段比。
  assert.equal(bondCalls.length, 1);
  assert.equal(bondCalls[0][1].money, 20);
  assert.equal(bondCalls[0][1].pay_type, 'balance');
  assert.equal(bondCalls[0][1].methods, 'miniapp');
  assert.equal(page.data.bondSubmitting, false, '充值结束后标志位要解开，否则永远点不动');
});

test('罚单：按 status 重新拉第一页，返回不足一页判「没有更多了」', async () => {
  const { page, state } = fixture();
  await page.load();
  await page.showFeature('fine');
  assert.deepEqual(state.fineCalls.at(-1), { status: -1, page: 1, limit: 15 });
  // 服务端筛「已撤销」用 >= 2，前端透传 2。
  await page.selectFineTab({ detail: { status: 2 } });
  assert.deepEqual(state.fineCalls.at(-1), { status: 2, page: 1, limit: 15 });
  assert.equal(page.data.fineStatus, 2);
  assert.equal(page.data.finesEnded, true, '只有 1 条 < 15 页，应判到底');
  // 空态：列表清空但待缴合计照样更新。
  state.fines = { list: [], unpaid_total: 0 };
  await page.selectFineTab({ detail: { status: 0 } });
  assert.equal(page.data.fines.length, 0);
  assert.equal(page.data.finesUnpaid, '0.00');
});

test('罚单缴纳：只有待缴能交，成功一次即刷新并解开防重复标志位', async () => {
  const { page, state } = fixture();
  await page.load();
  await page.showFeature('fine');
  await page.payFine({ detail: { index: 0 } });
  const paid = state.actions.filter(item => item[0] === 'finePay');
  assert.equal(paid.length, 1);
  assert.equal(paid[0][1].fine_no, 'FN1');
  assert.equal(paid[0][1].id, 7);
  assert.equal(page.data.payingIndex, -1, '缴纳结束后必须解开，否则整页罚单都点不动');
  // 已缴 / 已撤销的罚单连请求都不该发出去。
  state.fines = { list: [{ id: 8, fine_no: 'FN2', status: 1, amount: 5 }], unpaid_total: 0 };
  await page.selectFineTab({ detail: { status: 1 } });
  await page.payFine({ detail: { index: 0 } });
  assert.equal(state.actions.filter(item => item[0] === 'finePay').length, 1);
});

test('佣金流水：收支方向靠 amount_text 的负号，不靠 type 猜', async () => {
  const { page, state } = fixture();
  await page.load();
  state.log = [
    { id: 3, type: 'order_commission', type_text: '完成解冻', amount_text: '8.80', available_after: 12.5, goods_name: '服务A', fine_reason: '' },
    { id: 2, type: 'fine_payment', type_text: '罚款', amount_text: '-20.00', available_after: -7.5, goods_name: '', fine_reason: '迟到' },
    { id: 1, type: 'withdraw_apply', type_text: '提现', amount_text: '-5.00', available_after: 7.5 }
  ];
  await page.showFeature('balanceLog');
  assert.ok(page.data.commission.length === 3);
  const rows = fundsUtil.commissionRows(page.data.commission);
  assert.deepEqual(rows.map(row => row.direction), ['in', 'out', 'out']);
  // amount_text 原样输出（服务端字符串，带符号），不重新 Number 再格式化。
  assert.deepEqual(rows.map(row => row.amount_text), ['8.80', '-20.00', '-5.00']);
  // 两种特殊类型各多带一行：「完成解冻」带商品名，「罚款」带理由；其余不带。
  assert.deepEqual(rows.map(row => row.goods_name), ['服务A', '', '']);
  assert.deepEqual(rows.map(row => row.fine_reason), ['', '迟到', '']);
  // Tab 过滤：1 收入 / 2 支出。
  assert.equal(fundsUtil.filterCommissionLog(page.data.commission, 1).length, 1);
  assert.equal(fundsUtil.filterCommissionLog(page.data.commission, 2).length, 2);
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

// 用户 2026-09-19 要求（配打手工作台订单卡片截图）：「游戏昵称游戏id都要出现并且可复制」。
// 打手是拿着昵称和 ID 去游戏里加客户好友的，手抄一遍必错，所以三行都给复制钮。
test('订单卡片复制：订单编号 / 游戏昵称 / 游戏 ID 都进剪贴板', async () => {
  const { page, state } = fixture();
  page.copyField(event({ value: 'DD20260919001', label: '订单编号' }));
  assert.equal(state.clipboard, 'DD20260919001');
  page.copyField(event({ value: '峡谷路人王', label: '游戏昵称' }));
  assert.equal(state.clipboard, '峡谷路人王');
  page.copyField(event({ value: 'id123', label: '游戏ID' }));
  assert.equal(state.clipboard, 'id123');
});

test('客户没填的字段：提示但不写剪贴板（不能把占位文案「未填写」当真数据复制走）', async () => {
  const { page, state } = fixture();
  page.copyField(event({ value: '', label: '游戏昵称' }));
  assert.equal(state.clipboard, undefined);
  // 注意：这个 wx 桩的 showToast 存的是**整个 options 对象**，不是 title 字符串。
  assert.ok(state.toasts.some((item) => String(item && item.title).includes('客户没填游戏昵称')), JSON.stringify(state.toasts));
});
