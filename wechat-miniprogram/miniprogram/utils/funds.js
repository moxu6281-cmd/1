// 打手端「我的账单」的纯函数：8 格指标格式化 / 保证金档位 / 罚单三态 / 佣金流水收支方向。
// 全部不依赖页面或组件实例，可以直接在 Node 里 require 出来单测（见 wechat-miniprogram/tests/funds.test.cjs）。
//
// 口径来源：文档《资金指标开发提示词》。几条硬规则先抄在这里，改这个文件之前先读：
//   · 8 个指标**全部走同一个 money()** —— 原版只给 frozen_money / available_money 两个字段
//     做了 toFixed(2)，其余 6 个原样输出，结果服务端返 10000 就显示成 "10000"，
//     同屏 8 个数字小数位不齐。这是提示词第 3 节点名要修掉的 bug，别再犯。
//   · 8 个指标是**服务端聚合好的最终值，前端零计算** —— 不 SUM、不按月份过滤、
//     不拿 total_settled - month_settled 倒推"之前"。三个结算是互相独立的返回值。
//   · 罚单三态：0 待缴 / 1 已缴 / **>= 2 一律「已撤销」**（不要只判 0 和 1 就结束）；
//     只有 status === 0 才出「缴纳」按钮。
//   · 佣金流水的收支方向靠 **amount_text 是否以 '-' 开头**判断，不要靠 type 猜；
//     amount_text 是服务端字符串，原样输出、不要再 Number 一遍重新格式化。
//   · 时间全是服务端给的字符串（fine_time_text / pay_time_text / createtime_text），
//     前端直接渲染，**不做任何 new Date() / 时区 / 月份计算**。
//
// ⚠️ BOND_TIERS / BOND_RECOMMENDED 必须与项目根 `server.js` 的 FUND_BOND_TIERS /
//    FUND_BOND_RECOMMENDED 一致（check-production 有断言钉着）；接口下发的 bond_tiers
//    优先，这两份只是接口挂了时的兜底。

// 全项目共用的金额格式化。提示词第 3 / 13 节：只此一份，8 个字段全走它。
// 空值 / null / undefined → 0 → "0.00"；服务端可能回字符串也可能回数字，先 Number 再格式化。
const money = (v) => Number(v || 0).toFixed(2);

// 8 格顺序严格照提示词第 2 节的表格，别调换。
// target = 点这一格去哪个功能（工作台内的 feature key）。
const INDICATORS = [
  { key: 'bond', label: '保证金', target: 'bound' },
  { key: 'available_money', label: '可用佣金', target: 'withdraw' },
  { key: 'frozen_money', label: '冻结佣金', target: 'balanceLog' },
  { key: 'total_settled', label: '累计结算', target: 'balanceLog' },
  { key: 'month_settled', label: '本月结算', target: 'balanceLog' },
  { key: 'last_month_settled', label: '上月结算', target: 'balanceLog' },
  { key: 'fine_paid_total', label: '总已交罚款', target: 'fine' },
  { key: 'fine_unpaid_total', label: '待交罚款', target: 'fine', warn: true }
];

// 8 格渲染数据。raw 是 /api/public/funds 返回的那份 data（字段名下划线，照提示词）。
// raw 为 null（接口没回来）时 8 格一律显示「—」而**不是 0.00** —— 这个项目一直在守
// 「查不到」≠「真的是 0」这条线：后端挂了不该看着像"你的钱是 0"。
function indicatorList(raw) {
  if (!raw || typeof raw !== 'object') {
    return INDICATORS.map((item) => ({ ...item, warn: item.warn === true, value: '—' }));
  }
  return INDICATORS.map((item) => ({
    key: item.key,
    label: item.label,
    target: item.target,
    warn: item.warn === true,
    value: money(raw[item.key])
  }));
}

// ── 保证金充值 ────────────────────────────────────────────────────────────────
// 四档固定 10 / 20 / 50 / 100，20 标「推荐」（提示词第 5 节）；也允许打手填任意金额。
const BOND_TIERS = [10, 20, 50, 100];
const BOND_RECOMMENDED = 20;
const BOND_MAX = 100000;

// 档位列表。tiers / recommended 优先用接口下发的（服务端是唯一真源），没有才用兜底常量。
function bondTierList(tiers, recommended) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : BOND_TIERS;
  const picked = Number(recommended) > 0 ? Number(recommended) : BOND_RECOMMENDED;
  return list.map((amount) => {
    const value = Number(amount) || 0;
    return { amount: value, label: `${value}元`, recommended: value === picked };
  });
}

// 充值金额校验。返回空串代表可以提交，否则返回要 toast 的文案。
// 档位按钮和自定义输入框都走这一个校验，不写第二套。
function validateBondAmount(input) {
  const text = String(input == null ? '' : input).trim();
  if (!text) return '请输入充值金额';
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0) return '请输入正确的充值金额';
  if (value > BOND_MAX) return `单次充值金额不能超过 ${BOND_MAX} 元`;
  // 只收两位小数，避免 0.005 这种进到服务端被四舍五入成 0.01 后对不上用户看到的数。
  if (Math.round(value * 100) !== value * 100) return '金额最多保留两位小数';
  return '';
}

// ── 罚单 ──────────────────────────────────────────────────────────────────────
// 四个筛选 tab，status 取值严格照提示词 6.1：-1 全部 / 0 待缴 / 1 已缴 / 2 已撤销。
const FINE_TABS = [
  { status: -1, label: '全部' },
  { status: 0, label: '待缴纳' },
  { status: 1, label: '已缴纳' },
  { status: 2, label: '已撤销' }
];
const FINE_EMPTY = '暂无罚单记录';
const FINE_LIMIT = 15;      // 提示词 6.1：limit 固定 15；返回条数 < 15 就是没有更多了
const FINE_END = '没有更多了';

function fineStatusText(status) {
  const value = Number(status);
  if (value === 0) return '待缴';
  if (value === 1) return '已缴';
  // 2 及以上一律「已撤销」，前端不细分撤销原因（提示词 6.2）。
  return '已撤销';
}

function fineStatusClass(status) {
  const value = Number(status);
  if (value === 0) return 'status-pending';
  if (value === 1) return 'status-done';
  return 'status-revoked';
}

// 只有待缴（0）才允许缴纳 —— 已缴 / 已撤销都不出「缴纳」按钮（提示词 6.4 与第 11 节禁令）。
function isFinePayable(status) {
  return Number(status) === 0;
}

// 罚单行渲染数据。时间是服务端格式化好的字符串，直接输出。
function fineRow(item) {
  const source = item && typeof item === 'object' ? item : {};
  const status = Number(source.status);
  return {
    id: Number(source.id || 0),
    fine_no: String(source.fine_no || ''),
    status,
    status_text: String(source.status_text || '') || fineStatusText(status),
    status_class: fineStatusClass(status),
    payable: isFinePayable(status),
    // reason 服务端已给兜底「罚款」，这里再兜一层是防旧数据。
    reason: String(source.reason || '') || '罚款',
    amount_text: money(source.amount),
    fine_time_text: String(source.fine_time_text || ''),
    pay_time_text: String(source.pay_time_text || ''),
    punish_text: String(source.punish_text || ''),
    order_no: String(source.order_no || '')
  };
}

function fineRows(list) {
  return (Array.isArray(list) ? list : []).map(fineRow);
}

// 「没有更多了」判定：返回条数不足一页就是到底了（提示词 6.1）。
function fineListEnded(returnedCount, limit) {
  return Number(returnedCount) < (Number(limit) > 0 ? Number(limit) : FINE_LIMIT);
}

// ── 佣金流水 ──────────────────────────────────────────────────────────────────
// tab：0 全部 / 1 收入 / 2 支出（提示词第 7 节的 Tab 过滤口径）。
const COMMISSION_TABS = [
  { key: 0, label: '全部' },
  { key: 1, label: '收入' },
  { key: 2, label: '支出' }
];
const COMMISSION_EMPTY = '暂无佣金流水';
const COMMISSION_END = '没有更多了';

// 收支方向只看 amount_text 的第一个字符（提示词第 7 / 11 节：不要靠 type 猜）。
function commissionDirection(amountText) {
  return String(amountText == null ? '' : amountText).startsWith('-') ? 'out' : 'in';
}

// 流水行渲染数据。amount_text 原样透传（服务端字符串，带符号，不要重新格式化）。
function commissionRow(item) {
  const source = item && typeof item === 'object' ? item : {};
  const typeText = String(source.type_text || '');
  return {
    // 钱包流水主键：只用来当 wx:for 的 key（列表可能有多条同额同类型的记录）。
    rowKey: String(source.id == null ? '' : source.id),
    type: String(source.type || ''),
    type_text: typeText,
    amount_text: String(source.amount_text == null ? '' : source.amount_text),
    direction: commissionDirection(source.amount_text),
    // 每条都要显示「变动后可用余额」，用来对账余额连续性。
    available_after_text: money(source.available_after),
    // 两种特殊类型各多显示一行（提示词第 7 节）。
    goods_name: typeText === '完成解冻' ? String(source.goods_name || '') : '',
    fine_reason: typeText === '罚款' ? String(source.fine_reason || '') : '',
    // 时间用服务端给的字符串，前端不做日期计算。
    time_text: String(source.createtime_text || '')
  };
}

function commissionRows(list) {
  return (Array.isArray(list) ? list : []).map(commissionRow);
}

// 按 tab 过滤。方向从 amount_text 现算，不信任服务端可能缺失的 direction 字段。
function filterCommissionLog(list, tabKey) {
  const rows = Array.isArray(list) ? list : [];
  const key = Number(tabKey) || 0;
  if (key !== 1 && key !== 2) return rows;
  const wanted = key === 1 ? 'in' : 'out';
  return rows.filter((item) => commissionDirection(item && item.amount_text) === wanted);
}

module.exports = {
  money,
  INDICATORS,
  indicatorList,
  BOND_TIERS,
  BOND_RECOMMENDED,
  BOND_MAX,
  bondTierList,
  validateBondAmount,
  FINE_TABS,
  FINE_EMPTY,
  FINE_LIMIT,
  FINE_END,
  fineStatusText,
  fineStatusClass,
  isFinePayable,
  fineRow,
  fineRows,
  fineListEnded,
  COMMISSION_TABS,
  COMMISSION_EMPTY,
  COMMISSION_END,
  commissionDirection,
  commissionRow,
  commissionRows,
  filterCommissionLog
};
