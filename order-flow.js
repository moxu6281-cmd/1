const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

function displayStatus(order) {
  if (order.status === '待服务' || order.status === '待抽奖') return '待接单';
  if (order.status === '进行中') return '服务中';
  return order.status;
}

function advanceOrder(order, action, actor, timestamp, proof) {
  if (order.paymentStatus !== 'paid') throw new Error('订单尚未支付');
  const status = displayStatus(order);
  const next = { ...order };
  if (action === 'accept') {
    if (order.staffId === actor.id && ['待开始', '服务中', '待结单', '已完成'].includes(status)) return next;
    if (status !== '待接单' || order.staffId) throw new Error('订单已被接取或状态不允许接单');
    if (order.lottery && order.lottery.status !== 'completed') throw new Error('客户尚未完成抽奖，订单暂不可接');
    Object.assign(next, { status: '待开始', staffId: actor.id, staff: actor.name, acceptedAt: timestamp });
  } else if (action === 'assign') {
    if (actor.role !== 'merchant' || !actor.staffId || !actor.staffName) throw new Error('只有商户可以指定已授权打手');
    if (!['待接单', '待开始'].includes(status)) throw new Error('当前订单状态不能指定打手');
    if (order.lottery && order.lottery.status !== 'completed') throw new Error('客户尚未完成抽奖，暂不能指定打手');
    if (status === '待开始' && order.staffId === actor.staffId) return next;
    Object.assign(next, { status: '待开始', staffId: actor.staffId, staff: actor.staffName, acceptedAt: timestamp });
    delete next.staffPhone;
  } else if (action === 'requeue') {
    if (actor.role !== 'merchant') throw new Error('只有商户可以将订单返回大厅');
    if (!order.staffId || !['待开始', '服务中'].includes(status)) throw new Error('只有已接单且未结单的订单可以返回大厅');
    next.status = '待接单';
    for (const key of ['staffId', 'staff', 'staffPhone', 'acceptedAt', 'startedAt', 'completionProof', 'proofSubmittedAt']) delete next[key];
  } else if (action === 'start') {
    if (order.staffId !== actor.id) throw new Error('只有接单打手可以开始服务');
    if (['服务中', '待结单', '已完成'].includes(status)) return next;
    if (status !== '待开始') throw new Error('只有待开始订单可以开始服务');
    Object.assign(next, { status: '服务中', startedAt: timestamp });
  } else if (action === 'submit-proof') {
    if (order.staffId !== actor.id) throw new Error('只有接单打手可以上传结单截图');
    if (['待结单', '已完成'].includes(status) && order.completionProof) return next;
    if (status !== '服务中') throw new Error('只有服务中的订单可以提交结单');
    if (!proof) throw new Error('请上传结单截图');
    Object.assign(next, { status: '待结单', completionProof: proof, proofSubmittedAt: timestamp });
  } else if (action === 'finish') {
    if (actor.role !== 'merchant') throw new Error('只有商户可以结单');
    if (status === '已完成') return next;
    if (status !== '待结单' || !order.completionProof) throw new Error('需打手上传截图并进入待结单后才能结单');
    Object.assign(next, { status: '已完成', completedAt: timestamp, completedBy: actor.id });
  } else if (action === 'confirm') {
    // 老板端「确认结单」：打手上传截图后订单停在「待结单」，等下单老板确认才收尾。
    // 效果和商户结单一样（进「已完成」并给打手入佣金），但操作人是客户，
    // 所以单独一个 action —— 不要为了省一个分支让客户端冒充商户（completedBy 会记错人）。
    // 「这单是不是他的」由调用方按 record.customerId 校验，这里只管角色和状态。
    if (actor.role !== 'customer') throw new Error('只有下单老板可以确认结单');
    if (status === '已完成') return next;
    if (status !== '待结单' || !order.completionProof) throw new Error('需打手上传结单截图后才能确认结单');
    Object.assign(next, { status: '已完成', completedAt: timestamp, completedBy: actor.id, completedByRole: 'customer' });
  } else throw new Error('不支持的订单操作');
  return next;
}

module.exports = { PAYMENT_WINDOW_MS, displayStatus, advanceOrder };
