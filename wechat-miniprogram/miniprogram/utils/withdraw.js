// 打手端提现的纯函数：身份判定 / 唯一金额公式 / 提交校验顺序。
// 全部不依赖页面或组件实例，可以直接在 Node 里 require 出来单测（见 tests/withdraw.test.cjs）。
//
// 口径来源（文档《提现功能开发提示词》）：
//   · 最低提现额 / 开放渠道 / 说明文案 三项都是**商户在后台自己调的运营值**，
//     这里给的一律只是兜底，真实值由接口下发（每次进提现页都要重拉，不能长期缓存）。
//   · 打手被收的是「总手续费」（商户后台按人配的），管事怎么分是商户内部的事，打手看不到。
//
// ⚠️ 渠道常量必须与项目根 `shared.js` 的 `WITHDRAW_CHANNELS` 逐字一致（服务端只决定开不开），
//    check-production 有断言钉着两份 key/label，改一边要同时改另一边。

const WITHDRAW_CHANNELS = [
  { key: 'alipay', label: '支付宝' },
  { key: 'wechat', label: '微信' },
  { key: 'bank', label: '银行卡' }
];

// 文案表（逐字，别改写/新增）
const TEXT = {
  emptyAmount: '提现金额不能为空',
  minAmount: (min) => `最低提现金额为${min}元`,
  noSettlement: '请先设置提现信息',
  channelClosed: '该通道未开放提现',
  saved: '保存成功',
  // 提现页（文档第六节）用到的固定文案。手续费那一行文档写的是「管事抽成 (x%)」，
  // ⚠️ 本项目故意改成「提现手续费 (x%)」—— 因为打手付的是**总手续费**，管事只从里面抽一部分，
  //    写「管事抽成」会让他以为管事拿走了全部（口径见 AGENTS.md §15 / §17）。
  amountTitle: '提现金额',
  available: '可用佣金',
  availableUser: '可用余额',
  yuan: '元',
  withdrawAll: '全部提现',
  amountPlaceholder: '请输入提现金额',
  minTip: '最低提现金额',
  feeRow: '提现手续费',
  actualRow: '实际到账',
  settlementEntry: '设置提现信息',
  recordsEntry: '提现记录',
  channelTitle: '提现方式',
  submit: '提交',
  // 提现记录页（文档第九节）
  recordTabs: [{ key: 'all', label: '全部' }, { key: 'income', label: '收入' }, { key: 'withdraw', label: '提现' }],
  recordEmpty: '暂无提现记录',
  recordLoading: '加载中...',
  recordEnd: '没有更多了',
  recordAmount: '到账金额：'
};

// 提现资料表单（文档第七节）：每个渠道一份，字段顺序、标签、占位符逐字照抄文档表格。
// bank 没有收款码，但多一个「开户行名称」；另外两个渠道有收款码。
const SETTLEMENT_FORMS = {
  alipay: {
    title: '支付宝提现资料', hasQr: true, qrLabel: '支付宝收款码',
    fields: [
      { key: 'account', label: '支付宝账号', placeholder: '请输入您的支付宝账号', type: 'text' },
      { key: 'name', label: '收款人姓名', placeholder: '请输入支付宝收款人姓名', type: 'text' }
    ]
  },
  wechat: {
    title: '微信提现资料', hasQr: true, qrLabel: '微信收款码',
    fields: [
      { key: 'account', label: '微信账号', placeholder: '请输入您的微信账号', type: 'text' },
      { key: 'name', label: '收款人姓名', placeholder: '请输入微信收款人姓名', type: 'text' }
    ]
  },
  bank: {
    title: '银行卡提现资料', hasQr: false, qrLabel: '',
    fields: [
      { key: 'name', label: '持卡人姓名', placeholder: '请输入持卡人姓名', type: 'text' },
      { key: 'account', label: '银行卡账号', placeholder: '请输入您的银行卡账号', type: 'number' },
      { key: 'bankName', label: '开户行名称', placeholder: '请输入开户行名称', type: 'text' }
    ]
  }
};
// 收款码上传按钮的文字（文档文案表：`点击上传`）。
const QR_UPLOAD_TEXT = '点击上传';
// 保存按钮文字（文档文案表：`保存信息`）。
const SAVE_TEXT = '保存信息';

const MIN_AMOUNT_FALLBACK = 10;              // 兜底最低提现额，真实值由接口下发
const NOTICE_DEFAULT = [
  '提现申请提交后，请耐心等待平台审核；',
  '审核通过后，款项将转入您设置的收款账户；',
  '如提现失败，提现金额将退回可用佣金。'
].join('\n');

// 身份判定：'用户'（客户）与打手是两套账 —— 客户不扣手续费、走的接口也不同。
// 这里只判身份，不在打手分支上套任何客户逻辑。
// ⚠️ 两个写法都要认：接口下发的是英文 `user` / `staff`（页面直接把它透传到这里，
//    模板也按 `identity === 'user'` 渲染），文档口径写的是中文「用户」。
//    只认中文会让 `isCustomer('user')` 恒为 false —— 那样「客户不扣手续费」这条规则
//    在前端就完全失效（现在只靠服务端下发 value:0 兜着），所以两种都认。
function isCustomer(type) {
  return type === '用户' || type === 'user';
}

// 打手被收的「总手续费」文案，如 '10%' / '2 元/笔'。用户身份恒为 0。
function feeLabel(fee, type) {
  if (isCustomer(type)) return '0%';
  const value = Number((fee && fee.value) || 0);
  return fee && fee.mode === 'amount' ? `${value} 元/笔` : `${value}%`;
}

// 唯一金额公式（文档第五节，不要自创）：
//   抽成基数就是提现金额，不做任何前置扣除；费率 0 或金额为空时手续费记 0.00。
// fee = 打手的手续费配置 { mode:'rate'|'amount', value }
function calcWithdraw(amountInput, fee, type) {
  const amt = Number(amountInput) || 0;
  if (amt <= 0) return { fee: '0.00', actual: '0.00' };
  const part = isCustomer(type) ? null : fee;
  const value = Number((part && part.value) || 0);
  let cents;
  if (!part || value <= 0) cents = 0;
  else if (part.mode === 'amount') cents = Math.min(value, amt);        // 固定金额
  else cents = (amt * value) / 100;                                    // 百分比
  // 手续费不可能超过提现金额本身（比例填 150% 也只扣光）
  cents = Math.min(Math.max(0, cents), amt);
  const feeText = cents.toFixed(2);
  return { fee: feeText, actual: (amt - Number(feeText)).toFixed(2) };
}

// 归一化商户后台下发的提现运营配置。接口失败 / 字段缺失 / 非法值都退回兜底，
// 保证「只开支付宝」这条降级路径和后台配的一样可预期。
function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const rawMin = Number(source.minAmount);
  const minAmount = Number.isFinite(rawMin) && rawMin > 0 ? Number(rawMin.toFixed(2)) : MIN_AMOUNT_FALLBACK;
  const wanted = Array.isArray(source.channels) ? source.channels.map((key) => String(key)) : [];
  const openKeys = WITHDRAW_CHANNELS.map((channel) => channel.key).filter((key) => wanted.includes(key));
  const notice = typeof source.notice === 'string' ? source.notice.trim() : '';
  return {
    minAmount,
    openKeys: openKeys.length ? openKeys : ['alipay'],
    notice: notice || NOTICE_DEFAULT
  };
}

// 三个渠道 + 各自的禁用状态；并给出「第一个未禁用」的下标（进页默认选中它）。
function channelsWithState(openKeys) {
  const open = Array.isArray(openKeys) ? openKeys : [];
  const list = WITHDRAW_CHANNELS.map((channel) => ({ ...channel, disabled: !open.includes(channel.key) }));
  const firstEnabled = list.findIndex((channel) => !channel.disabled);
  return { list, firstEnabled: firstEnabled < 0 ? 0 : firstEnabled };
}

// 提现记录 key：收款信息存在本地（本版本地 Storage），提交时直接按渠道读，不另发请求。
function settlementKey(channel) {
  return `settlement_${channel}`;
}

// 提交校验（文档第八节，顺序严格照抄，先命中先返回）。
// 返回空串代表通过；返回文案代表该直接 toast 掉。
function validateSubmit(input) {
  const amount = input && input.amount;
  const minAmount = Number((input && input.minAmount) || 0);
  const settlement = (input && input.settlement) || {};
  if (!amount || Number(amount) <= 0) return TEXT.emptyAmount;
  if (Number(amount) < minAmount) return TEXT.minAmount(minAmount);
  if (!settlement.account || !settlement.name) return TEXT.noSettlement;
  return '';
}

// 收款资料保存时的必填校验（文档第七节：账号 + 姓名是提交的硬门槛；bank 另要开户行名称）。
// 返回空串代表可以保存。
function validateSettlement(channel, form) {
  const spec = SETTLEMENT_FORMS[channel];
  if (!spec) return '提现渠道无效';
  const source = form || {};
  const missing = spec.fields.filter((field) => !String(source[field.key] || '').trim());
  if (missing.length) return `请填写${missing[0].label}`;
  return '';
}

// 提现单落库的时间戳（毫秒）转成记录页要显示的文本。
function formatRecordTime(value) {
  const time = Number(value || 0);
  if (!time) return '';
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

module.exports = {
  WITHDRAW_CHANNELS,
  TEXT,
  SETTLEMENT_FORMS,
  QR_UPLOAD_TEXT,
  SAVE_TEXT,
  MIN_AMOUNT_FALLBACK,
  NOTICE_DEFAULT,
  isCustomer,
  feeLabel,
  calcWithdraw,
  normalizeSettings,
  channelsWithState,
  settlementKey,
  validateSubmit,
  validateSettlement,
  formatRecordTime
};
