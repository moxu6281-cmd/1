// utils/funds.js 的纯函数单测。
// 重点钉住《资金指标开发提示词》里那几条「原版栽过跟头」的规则：
//   · 8 个指标全部走同一个 money()（原版只给 2 个字段 toFixed，同屏小数位不齐）
//   · 罚单三态：0 待缴 / 1 已缴 / >=2 一律已撤销（不是只判 0 和 1）
//   · 只有 status === 0 出「缴纳」按钮
//   · 流水方向靠 amount_text 的负号，不靠 type；amount_text 原样输出
//   · 前端不做任何日期计算（时间字段直接透传服务端字符串）
const test = require('node:test');
const assert = require('node:assert/strict');
const funds = require('../miniprogram/utils/funds');

test('money() 是全项目唯一金额格式化：整数也要两位小数', () => {
  assert.equal(funds.money(100), '100.00');
  // 服务端可能返字符串（10000）也可能返数字，两种都要出处一致。
  assert.equal(funds.money('10000'), '10000.00');
  assert.equal(funds.money(12.5), '12.50');
  assert.equal(funds.money(0), '0.00');
  assert.equal(funds.money(null), '0.00');
  assert.equal(funds.money(undefined), '0.00');
  assert.equal(funds.money(''), '0.00');
});

test('8 格顺序与文案严格照提示词第 2 节的表格', () => {
  assert.equal(funds.INDICATORS.length, 8);
  assert.deepEqual(funds.INDICATORS.map((item) => item.key), [
    'bond', 'available_money', 'frozen_money', 'total_settled',
    'month_settled', 'last_month_settled', 'fine_paid_total', 'fine_unpaid_total'
  ]);
  assert.deepEqual(funds.INDICATORS.map((item) => item.label), [
    '保证金', '可用佣金', '冻结佣金', '累计结算', '本月结算', '上月结算', '总已交罚款', '待交罚款'
  ]);
  // 只有最后一格（待交罚款）带红色警示。
  assert.deepEqual(funds.INDICATORS.map((item) => item.warn === true), [false, false, false, false, false, false, false, true]);
});

test('indicatorList：8 个字段全部格式化，一个都不能漏 toFixed', () => {
  const grid = funds.indicatorList({
    bond: 50, available_money: 12.5, frozen_money: 8.8, total_settled: 100,
    month_settled: 60, last_month_settled: 40, fine_paid_total: 5, fine_unpaid_total: 20
  });
  // 服务端返整数 100 必须显示成 100.00 —— 原版就是这里只给两个字段格式化，导致 100 裸奔。
  assert.deepEqual(grid.map((item) => item.value), [
    '50.00', '12.50', '8.80', '100.00', '60.00', '40.00', '5.00', '20.00'
  ]);
  // 字段缺失按 0.00 处理（服务端承诺 8 个都返回，缺了就是 0）。
  assert.equal(funds.indicatorList({})[0].value, '0.00');
});

test('indicatorList：拿不到数据时是「—」不是 0.00', () => {
  for (const raw of [null, undefined, '', 0]) {
    assert.deepEqual(funds.indicatorList(raw).map((item) => item.value), new Array(8).fill('—'));
  }
});

test('保证金档位固定四档、20 是推荐档，也允许接口下发别的档位', () => {
  const tiers = funds.bondTierList();
  assert.deepEqual(tiers.map((item) => item.amount), [10, 20, 50, 100]);
  assert.deepEqual(tiers.map((item) => item.label), ['10元', '20元', '50元', '100元']);
  assert.deepEqual(tiers.map((item) => item.recommended), [false, true, false, false]);
  // 服务端是唯一真源：它给了别的档位就照它渲染。
  const custom = funds.bondTierList([5, 30], 30);
  assert.deepEqual(custom.map((item) => item.amount), [5, 30]);
  assert.equal(custom[1].recommended, true);
});

test('保证金金额校验：空 / 0 / 负数 / 超上限 / 三位小数都要被拦下', () => {
  assert.equal(funds.validateBondAmount(''), '请输入充值金额');
  assert.equal(funds.validateBondAmount('   '), '请输入充值金额');
  assert.equal(funds.validateBondAmount(0), '请输入正确的充值金额');
  assert.equal(funds.validateBondAmount(-5), '请输入正确的充值金额');
  assert.equal(funds.validateBondAmount('abc'), '请输入正确的充值金额');
  assert.equal(funds.validateBondAmount(100001), '单次充值金额不能超过 100000 元');
  assert.equal(funds.validateBondAmount(0.005), '金额最多保留两位小数');
  assert.equal(funds.validateBondAmount(10), '');
  assert.equal(funds.validateBondAmount('20'), '');
  assert.equal(funds.validateBondAmount(20.5), '');
});

test('罚单三态：2 及以上一律「已撤销」，不是只判 0 和 1', () => {
  assert.equal(funds.fineStatusText(0), '待缴');
  assert.equal(funds.fineStatusText(1), '已缴');
  assert.equal(funds.fineStatusText(2), '已撤销');
  // 以后如果加了 3 = 申诉中之类的扩展态，前端不许跟着崩或显示成空白。
  assert.equal(funds.fineStatusText(3), '已撤销');
  assert.equal(funds.fineStatusText(99), '已撤销');
  assert.equal(funds.fineStatusText(undefined), '已撤销');
  assert.equal(funds.fineStatusClass(0), 'status-pending');
  assert.equal(funds.fineStatusClass(1), 'status-done');
  assert.equal(funds.fineStatusClass(2), 'status-revoked');
  assert.equal(funds.fineStatusClass(7), 'status-revoked');
});

test('只有待缴（status === 0）才允许缴纳', () => {
  assert.equal(funds.isFinePayable(0), true);
  assert.equal(funds.isFinePayable('0'), true);
  assert.equal(funds.isFinePayable(1), false);
  assert.equal(funds.isFinePayable(2), false);
  assert.equal(funds.isFinePayable(undefined), false);
});

test('罚单行：reason 兜底「罚款」，时间字段直接透传服务端字符串', () => {
  const row = funds.fineRow({
    id: 7, fine_no: 'FN1', status: 0, amount: 20,
    fine_time_text: '2026-09-18 10:00:00', pay_time_text: '',
    punish_text: '超时未接单', order_no: 'OD1'
  });
  assert.equal(row.reason, '罚款');
  assert.equal(row.amount_text, '20.00');
  assert.equal(row.status_text, '待缴');
  assert.equal(row.status_class, 'status-pending');
  assert.equal(row.payable, true);
  // 服务端已经格式化好了，前端一个 new Date() 都不许有。
  assert.equal(row.fine_time_text, '2026-09-18 10:00:00');
  assert.equal(row.pay_time_text, '');
  const paid = funds.fineRow({ status: 1, reason: '迟到', amount: 5.5 });
  assert.equal(paid.reason, '迟到');
  assert.equal(paid.payable, false);
  assert.equal(paid.amount_text, '5.50');
});

test('罚单分页：返回不足一页就是到底了', () => {
  assert.equal(funds.fineListEnded(15, 15), false);
  assert.equal(funds.fineListEnded(14, 15), true);
  assert.equal(funds.fineListEnded(0, 15), true);
  assert.equal(funds.fineListEnded(1), true, '不传 limit 按默认 15 算');
});

test('流水方向只看 amount_text 的负号，不靠 type', () => {
  assert.equal(funds.commissionDirection('8.80'), 'in');
  assert.equal(funds.commissionDirection('-20.00'), 'out');
  assert.equal(funds.commissionDirection('-0.01'), 'out');
  assert.equal(funds.commissionDirection(0), 'in');
  assert.equal(funds.commissionDirection(null), 'in');
});

test('流水行：amount_text 原样输出，两个特殊类型各多带一行', () => {
  const unfreeze = funds.commissionRow({
    id: 3, type: 'order_commission', type_text: '完成解冻', amount_text: '8.80',
    available_after: 12.5, goods_name: '服务A', createtime_text: '2026-09-18 09:00:00'
  });
  assert.equal(unfreeze.type_text, '完成解冻');
  assert.equal(unfreeze.goods_name, '服务A', '「完成解冻」要显示商品名');
  assert.equal(unfreeze.fine_reason, '');
  assert.equal(unfreeze.available_after_text, '12.50');
  assert.equal(unfreeze.time_text, '2026-09-18 09:00:00');
  assert.equal(unfreeze.rowKey, '3');

  const fine = funds.commissionRow({ id: 2, type_text: '罚款', amount_text: '-20.00', fine_reason: '迟到', goods_name: '不该显示' });
  assert.equal(fine.fine_reason, '迟到', '「罚款」要显示罚款理由');
  assert.equal(fine.goods_name, '', '罚款条目不该带商品名');
  assert.equal(fine.direction, 'out');

  // 其他类型两个都不带。
  const withdraw = funds.commissionRow({ id: 1, type_text: '提现', amount_text: '-5.00', goods_name: 'x', fine_reason: 'y' });
  assert.equal(withdraw.goods_name, '');
  assert.equal(withdraw.fine_reason, '');
});

test('流水 Tab 过滤：0 全部 / 1 收入 / 2 支出', () => {
  const list = [
    { amount_text: '8.80' }, { amount_text: '-20.00' }, { amount_text: '-5.00' }, { amount_text: '3.00' }
  ];
  assert.equal(funds.filterCommissionLog(list, 0).length, 4);
  assert.equal(funds.filterCommissionLog(list, 1).length, 2);
  assert.equal(funds.filterCommissionLog(list, 2).length, 2);
  // 非法 tab 一律当「全部」，不要把列表清空。
  assert.equal(funds.filterCommissionLog(list, 9).length, 4);
  assert.equal(funds.filterCommissionLog(null, 1).length, 0);
});

test('佣金流水 tab 常量：全部 / 收入 / 支出', () => {
  assert.deepEqual(funds.COMMISSION_TABS.map((tab) => tab.label), ['全部', '收入', '支出']);
  assert.deepEqual(funds.COMMISSION_TABS.map((tab) => tab.key), [0, 1, 2]);
  assert.deepEqual(funds.FINE_TABS.map((tab) => tab.label), ['全部', '待缴纳', '已缴纳', '已撤销']);
  assert.deepEqual(funds.FINE_TABS.map((tab) => tab.status), [-1, 0, 1, 2]);
});
