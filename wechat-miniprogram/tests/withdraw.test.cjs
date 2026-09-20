// 提现页专项测试：纯函数口径 + 页面真实逻辑（wx 桩真跑 pages/withdraw/index.js）。
//
// 为什么单独一个文件：提现是"钱的路径"，出错不报错、只算错账。三类东西必须有代码兜住：
//   ① 金额唯一公式（calcWithdraw）—— 页面不许自己再算一遍；
//   ② 提交校验顺序（validateSubmit）—— 文档第八节定死"先命中先返回"；
//   ③ 每次进页重拉配置 + 收款信息存本地 —— 商户改完立刻生效、资料不服务端化。
// 纯函数直接 require（utils/withdraw.js 不依赖 wx）；页面逻辑用 vm + wx 桩跑真代码。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const util = require('../miniprogram/utils/withdraw');
const {
  calcWithdraw, feeLabel, normalizeSettings, channelsWithState,
  settlementKey, validateSubmit, validateSettlement, formatRecordTime,
  MIN_AMOUNT_FALLBACK, NOTICE_DEFAULT, TEXT, SETTLEMENT_FORMS
} = util;

const PAGE = path.join(__dirname, '../miniprogram/pages/withdraw/index.js');

// ---------------------------------------------------------------- 纯函数口径

test('金额唯一公式：费率 / 固定金额 / 封顶 / 空值', () => {
  const rate10 = { mode: 'rate', value: 10 };
  assert.deepEqual(calcWithdraw(100, rate10, 'staff'), { fee: '10.00', actual: '90.00' });
  // 固定金额模式：value 的单位是「元」，不是百分比。
  assert.deepEqual(calcWithdraw(100, { mode: 'amount', value: 5 }, 'staff'), { fee: '5.00', actual: '95.00' });
  // 手续费不可能超过提现金额本身（比例填 150% 只扣光，不会倒欠平台钱）。
  assert.deepEqual(calcWithdraw(100, { mode: 'rate', value: 150 }, 'staff'), { fee: '100.00', actual: '0.00' });
  // 金额为空 / 0 / 负数 / 非数字：一律 0.00，不许出现 NaN。
  for (const empty of ['', '0', 0, null, undefined, 'abc']) {
    assert.deepEqual(calcWithdraw(empty, rate10, 'staff'), { fee: '0.00', actual: '0.00' }, `输入 ${empty}`);
  }
  // 费率 0 = 不收手续费，到账 = 提现额。
  assert.deepEqual(calcWithdraw(88.8, { mode: 'rate', value: 0 }, 'staff'), { fee: '0.00', actual: '88.80' });
});

test('客户（用户身份）不扣手续费，两种写法都要认', () => {
  const rate10 = { mode: 'rate', value: 10 };
  // 接口下发的是英文 user，文档口径写中文「用户」—— 只认一种，这条规则在前端就形同虚设。
  for (const type of ['user', '用户']) {
    assert.deepEqual(calcWithdraw(100, rate10, type), { fee: '0.00', actual: '100.00' }, `身份 ${type}`);
    assert.equal(feeLabel(rate10, type), '0%', `身份 ${type} 的费率文案`);
  }
  // 打手那边照收，别被上面的放宽顺手放过去。
  assert.deepEqual(calcWithdraw(100, rate10, 'staff'), { fee: '10.00', actual: '90.00' });
  assert.equal(feeLabel(rate10, 'staff'), '10%');
  assert.equal(feeLabel({ mode: 'amount', value: 3 }, 'staff'), '3 元/笔');
});

test('归一化：脏值退回兜底，只开支付宝是降级路径', () => {
  assert.equal(normalizeSettings(null).minAmount, MIN_AMOUNT_FALLBACK);
  assert.equal(normalizeSettings({ minAmount: 0 }).minAmount, MIN_AMOUNT_FALLBACK);
  assert.equal(normalizeSettings({ minAmount: 'abc' }).minAmount, MIN_AMOUNT_FALLBACK);
  assert.equal(normalizeSettings({ minAmount: 25.556 }).minAmount, 25.56);
  assert.deepEqual(normalizeSettings({ channels: [] }).openKeys, ['alipay']);
  assert.deepEqual(normalizeSettings({ channels: ['unknown'] }).openKeys, ['alipay']);
  // 顺序与白名单都以项目常量 WITHDRAW_CHANNELS 为准，不跟着服务端数组顺序走。
  assert.deepEqual(normalizeSettings({ channels: ['bank', 'alipay'] }).openKeys, ['alipay', 'bank']);
  assert.equal(normalizeSettings({ notice: '   ' }).notice, NOTICE_DEFAULT);
  assert.equal(normalizeSettings({ notice: '自定义说明' }).notice, '自定义说明');
});

test('渠道列表：禁用状态与默认选中第一个开放的', () => {
  const all = channelsWithState(['alipay', 'wechat', 'bank']);
  assert.deepEqual(all.list.map((item) => item.disabled), [false, false, false]);
  assert.equal(all.firstEnabled, 0);
  const onlyWechat = channelsWithState(['wechat']);
  assert.deepEqual(onlyWechat.list.map((item) => item.disabled), [true, false, true]);
  assert.equal(onlyWechat.firstEnabled, 1);
  // 一个都没开（接口异常）也不能给一个空列表，否则进页没有任何渠道可点。
  assert.equal(channelsWithState([]).firstEnabled, 0);
});

test('提交校验顺序严格照文档第八节：金额 → 最低额 → 收款信息', () => {
  const base = { amount: '100', minAmount: 10, settlement: { account: 'a', name: 'n' } };
  assert.equal(validateSubmit(base), '');
  assert.equal(validateSubmit({ ...base, amount: '' }), TEXT.emptyAmount);
  assert.equal(validateSubmit({ ...base, amount: '0' }), TEXT.emptyAmount);
  assert.equal(validateSubmit({ ...base, amount: '5' }), TEXT.minAmount(10));
  assert.equal(validateSubmit({ ...base, settlement: {} }), TEXT.noSettlement);
  assert.equal(validateSubmit({ ...base, settlement: { account: 'a' } }), TEXT.noSettlement);
  // 金额为空 + 没资料时，必须先报金额（顺序错了会先骂用户没填资料）。
  assert.equal(validateSubmit({ amount: '', minAmount: 10, settlement: {} }), TEXT.emptyAmount);
});

test('收款资料按渠道校验：支付宝/微信要账号+姓名，银行卡还要开户行', () => {
  assert.equal(validateSettlement('alipay', { account: 'a', name: 'n' }), '');
  assert.equal(validateSettlement('alipay', { account: 'a' }), '请填写收款人姓名');
  assert.equal(validateSettlement('wechat', { name: 'n' }), '请填写微信账号');
  assert.equal(validateSettlement('bank', { name: 'n', account: '6222' }), '请填写开户行名称');
  assert.equal(validateSettlement('bank', { name: 'n', account: '6222', bankName: '工行' }), '');
  assert.equal(validateSettlement('nope', {}), '提现渠道无效');
  // 表单规格就是文档第七节那张表，字段数别少。
  assert.equal(SETTLEMENT_FORMS.alipay.fields.length, 2);
  assert.equal(SETTLEMENT_FORMS.bank.fields.length, 3);
});

test('收款信息存在本地、按渠道各一份；时间戳转成可读文本', () => {
  assert.equal(settlementKey('alipay'), 'settlement_alipay');
  assert.notEqual(settlementKey('alipay'), settlementKey('bank'));
  assert.equal(formatRecordTime(0), '');
  assert.equal(formatRecordTime(''), '');
  const text = formatRecordTime(new Date(2026, 8, 18, 9, 5).getTime());
  assert.equal(text, '2026-09-18 09:05');
});

// ---------------------------------------------------------------- 页面真实逻辑

function fixture(overrides = {}) {
  let page;
  let payload = {
    ok: true, identity: 'staff', available: 12.5, minAmount: 10,
    channels: ['alipay', 'wechat'], notice: '提现须知', fee: { mode: 'rate', value: 10 },
    ...overrides
  };
  const state = { toasts: [], paths: [], posted: [], storage: {}, sheets: [], pageCalls: 0, recordCalls: 0 };
  const api = {
    getWithdrawPage: async () => {
      state.pageCalls += 1;
      if (state.failPage) throw state.failPage;
      return JSON.parse(JSON.stringify(payload));
    },
    submitWithdraw: async (account, body) => {
      state.posted.push([account, body]);
      if (state.failSubmit) throw state.failSubmit;
      return { ok: true, message: '提现申请已提交，请等待平台审核' };
    },
    getWithdrawRecords: async () => {
      state.recordCalls += 1;
      if (state.failRecords) throw state.failRecords;
      return JSON.parse(JSON.stringify(state.records || []));
    }
  };
  const app = { globalData: { merchantAccount: 'fixture' }, ensureCustomerIdentity: async () => ({ customerId: 'staff1' }) };
  const timers = [];
  const wx = {
    getStorageSync: (key) => state.storage[key],
    setStorageSync: (key, value) => { state.storage[key] = value; },
    showToast: (data) => state.toasts.push(data.title),
    navigateTo: (data) => state.paths.push(data.url),
    navigateBack: () => state.paths.push('back'),
    pageScrollTo() {}, stopPullDownRefresh() {},
    chooseMedia: (options) => { state.sheets.push(options); }
  };
  const context = vm.createContext({
    Page: (value) => { page = value; },
    require: (name) => (name === '../../services/api' ? api : util),
    getApp: () => app, wx, console,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {}
  });
  vm.runInContext(fs.readFileSync(PAGE, 'utf8'), context);
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return {
    page, state, api, timers,
    // 让 loadPage / loadRecords 里的 await 全部落地。
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    setPayload: (next) => { payload = { ...payload, ...next }; },
    runTimers: () => { const pending = timers.splice(0); pending.forEach((fn) => fn()); }
  };
}

const event = (dataset, value) => ({ currentTarget: { dataset }, detail: { value } });

test('每次进页都重拉配置：最低提现额 / 渠道 / 手续费 / 可用佣金都跟着服务端变', async () => {
  const { page, state, setPayload, flush } = fixture();
  await page.loadPage();
  assert.equal(state.pageCalls, 1);
  assert.equal(page.data.availableText, '12.50');
  assert.equal(page.data.minAmount, 10);
  assert.equal(page.data.feeLabel, '10%');
  assert.equal(page.data.channel, 'alipay');

  // 商户在后台改了运营值 —— 再进一次页必须看到新值（长缓存会让改动不生效）。
  setPayload({ available: 99.9, minAmount: 50, notice: '新须知', channels: ['wechat'] });
  page.onShow();
  await flush();
  assert.equal(state.pageCalls, 2, 'onShow 必须再拉一次，不能只进页拉一次');
  assert.equal(page.data.availableText, '99.90');
  assert.equal(page.data.minAmount, 50);
  assert.equal(page.data.notice, '新须知');
  assert.equal(page.data.channel, 'wechat', '原渠道被关掉就落到第一个开放渠道');
});

test('金额 / 全部提现都走同一个公式，页面不自己算第二遍', async () => {
  const { page } = fixture();
  await page.loadPage();
  page.onAmountInput(event(undefined, '100'));
  assert.equal(page.data.amount, '100');
  assert.equal(page.data.feeText, '10.00');
  assert.equal(page.data.actualText, '90.00');
  page.fillAll();
  assert.equal(page.data.amount, '12.50');
  assert.equal(page.data.feeText, '1.25');
  assert.equal(page.data.actualText, '11.25');
  page.onAmountInput(event(undefined, ''));
  assert.equal(page.data.feeText, '0.00');
  assert.equal(page.data.actualText, '0.00');
});

test('关闭的渠道点不动，只提示不切换', async () => {
  const { page, state } = fixture({ channels: ['alipay'] });
  await page.loadPage();
  assert.deepEqual(page.data.channels.map((item) => item.disabled), [false, true, true]);
  page.chooseChannel(event({ index: 1 }));
  assert.equal(page.data.channel, 'alipay');
  assert.deepEqual(state.toasts, [TEXT.channelClosed]);
  page.chooseChannel(event({ index: 2 }));
  assert.deepEqual(state.toasts, [TEXT.channelClosed, TEXT.channelClosed]);
  assert.equal(page.data.channel, 'alipay');
});

test('提交校验先命中先返回：空金额 / 低于最低 / 没资料都不发请求', async () => {
  const { page, state } = fixture();
  await page.loadPage();
  await page.submit();
  assert.deepEqual(state.toasts, [TEXT.emptyAmount]);
  assert.equal(state.posted.length, 0);

  page.onAmountInput(event(undefined, '5'));
  await page.submit();
  assert.deepEqual(state.toasts, [TEXT.emptyAmount, TEXT.minAmount(10)]);
  assert.equal(state.posted.length, 0);

  page.onAmountInput(event(undefined, '100'));
  await page.submit();
  assert.deepEqual(state.toasts.at(-1), TEXT.noSettlement);
  assert.equal(state.posted.length, 0);
  assert.equal(page.data.submitting, false, '被拦下时不许卡在提交中');
});

test('资料齐全才提交：收款信息从本地读，成功后返回上一页', async () => {
  const { page, state, runTimers } = fixture();
  await page.loadPage();
  state.storage[settlementKey('alipay')] = { account: 'me@example.com', name: '张三', images: 'data:image/png;base64,x' };
  page.onAmountInput(event(undefined, '100'));
  await page.submit();
  // 页面在 vm 里跑，它造的 payload 对象属于另一个 realm —— 原型不同，deepStrictEqual 直接比会炸，先转成普通对象。
  assert.deepEqual(JSON.parse(JSON.stringify(state.posted)), [['fixture', {
    name: '张三', account: 'me@example.com', money: 100,
    images: 'data:image/png;base64,x', channel: 'alipay', bankName: ''
  }]]);
  assert.equal(state.toasts.at(-1), '提现申请已提交，请等待平台审核');
  assert.equal(page.data.submitting, false);
  assert.deepEqual(state.paths, [], '还没到返回时间，先别跳走');
  runTimers();
  assert.deepEqual(state.paths, ['back']);
});

test('提交失败提示真原因，且能重试（不会一直卡在提交中）', async () => {
  const { page, state } = fixture();
  await page.loadPage();
  state.storage[settlementKey('alipay')] = { account: 'a', name: 'n' };
  page.onAmountInput(event(undefined, '100'));
  state.failSubmit = Error('可用佣金不足，当前 ¥1.00');
  await page.submit();
  assert.equal(state.toasts.at(-1), '可用佣金不足，当前 ¥1.00');
  assert.equal(page.data.submitting, false);
  state.failSubmit = null;
  await page.submit();
  assert.equal(state.posted.length, 2, '失败后必须还能再提交');
});

test('提现资料：必填拦住、存本地、重新进资料页会回填', async () => {
  const { page, state } = fixture();
  await page.loadPage();
  page.openSettlement();
  assert.equal(page.data.view, 'settlement');
  assert.equal(page.data.settlementTitle, SETTLEMENT_FORMS.alipay.title);
  page.onFieldInput(event({ field: 'account' }, 'me@example.com'));
  page.saveSettlement();
  assert.deepEqual(state.toasts, ['请填写收款人姓名']);
  assert.equal(state.storage[settlementKey('alipay')], undefined, '校验没过不许落本地');
  page.onFieldInput(event({ field: 'name' }, '张三'));
  page.saveSettlement();
  assert.equal(state.toasts.at(-1), TEXT.saved);
  assert.deepEqual(JSON.parse(JSON.stringify(state.storage[settlementKey('alipay')])),
    { account: 'me@example.com', name: '张三', images: '', imagesFull: '' });
  // 回到主视图、进记录页再回来，填过的值还在（资料按渠道存本地）。
  page.backToMain();
  assert.equal(page.data.view, 'main');
  page.openSettlement();
  assert.equal(page.data.formValues.name, '张三');
});

test('银行卡资料多一个开户行，且提交时带上 bankName', async () => {
  const { page, state } = fixture({ channels: ['bank'] });
  await page.loadPage();
  assert.equal(page.data.channel, 'bank');
  page.openSettlement();
  assert.equal(page.data.settlementQr, '', '银行卡没有收款码');
  page.setData({ settlementIndex: 2 });
  page.chooseSettlementTab(event({ index: 2 }));
  assert.equal(page.data.settlementFields.length, 3);
  page.onFieldInput(event({ field: 'name' }, '张三'));
  page.onFieldInput(event({ field: 'account' }, '6222021234567890'));
  page.onFieldInput(event({ field: 'bankName' }, '工商银行'));
  page.saveSettlement();
  assert.equal(state.toasts.at(-1), TEXT.saved);
  page.backToMain();
  page.onAmountInput(event(undefined, '100'));
  await page.submit();
  assert.equal(state.posted[0][1].bankName, '工商银行');
  assert.equal(state.posted[0][1].channel, 'bank');
});

test('提现记录：收入与提现按 tab 分，金额和时间都用服务端值', async () => {
  const { page, state, flush } = fixture();
  state.records = [
    { kind: 'income', orderNo: 'A1', channelText: '订单结单佣金', createtime: new Date(2026, 8, 18, 9, 5).getTime(), actualMoney: 30, status: 'approved', statusText: '已入账' },
    { kind: 'withdraw', orderNo: 'W1', channelText: '支付宝', createtime: new Date(2026, 8, 17, 20, 0).getTime(), money: 50, actualMoney: 45, status: 'pending', statusText: '审核中' }
  ];
  await page.loadPage();
  page.openRecords();
  assert.equal(page.data.view, 'records');
  assert.equal(page.data.recordsLoading, true);
  await flush();
  assert.equal(page.data.recordsLoading, false);
  assert.equal(page.data.visibleRecords.length, 2, '「全部」两个都显示');
  assert.equal(page.data.visibleRecords[0].amountText, '30.00');
  assert.equal(page.data.visibleRecords[0].timeText, '2026-09-18 09:05');
  assert.equal(page.data.visibleRecords[1].amountText, '45.00', '提现单看的是到账金额，不是申请金额');
  page.chooseRecordTab(event({ tab: 'income' }));
  assert.deepEqual(page.data.visibleRecords.map((item) => item.orderNo), ['A1']);
  page.chooseRecordTab(event({ tab: 'withdraw' }));
  assert.deepEqual(page.data.visibleRecords.map((item) => item.orderNo), ['W1']);
});

test('记录取不到只提示，不清空成假数据；配置取不到给错误态并能重试', async () => {
  const { page, state, flush } = fixture();
  state.records = [{ kind: 'income', orderNo: 'A1', createtime: 1, actualMoney: 1 }];
  await page.loadPage();
  page.openRecords();
  await flush();
  state.records = [];
  state.failRecords = Error('网络断开');
  page.openRecords();
  await flush();
  assert.equal(page.data.records.length, 0, '取不到就空着，别留着上一轮的数据冒充');
  assert.equal(state.toasts.at(-1), '网络断开');

  state.failPage = Error('提现信息加载失败');
  await page.loadPage();
  assert.equal(page.data.ready, false);
  assert.equal(page.data.error, '提现信息加载失败');
  state.failPage = null;
  await page.loadPage();
  assert.equal(page.data.ready, true);
  assert.equal(page.data.error, '');
});
