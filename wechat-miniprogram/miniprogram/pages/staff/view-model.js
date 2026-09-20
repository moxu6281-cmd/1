const { normalizeCategories } = require('../../utils/data');
const { resolveAssetUrl } = require('../../utils/image');

const statuses = ['全部', '待开始', '服务中', '待结单', '已完成'];
const tabs = [
  { id: 'hall', label: '接单大厅', icon: 'hall' },
  { id: 'orders', label: '我的订单', icon: 'orders' },
  { id: 'chat', label: '聊天', icon: 'chat' },
  { id: 'withdraw', label: '佣金提现', icon: 'wallet' },
  { id: 'home', label: '陪玩中心', icon: 'person' }
];
const features = [
  { id: 'center', label: '陪玩中心', icon: 'person' },
  { id: 'level', label: '陪玩等级', icon: 'star' },
  { id: 'ranking', label: '排行', icon: 'ranking' },
  { id: 'support', label: '客服', icon: 'chat' },
  { id: 'notice', label: '平台通知', icon: 'notice' },
  { id: 'bound', label: '保证金', icon: 'wallet' },
  { id: 'orders', label: '我的接单', icon: 'orders' },
  { id: 'assistance', label: '协助订单', icon: 'people' },
  { id: 'identity', label: '切换身份', icon: 'switch' },
  { id: 'settings', label: '设置', icon: 'settings' }
];

function timeLabel(value) {
  const date = new Date(Number(value));
  if (!value || Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function orderView(order, config, baseUrl, unread = 0) {
  const product = (config.products || []).find(item => String(item.id) === String(order.productId)) || {};
  const configured = order.staffIncome ?? order.staffShare;
  const income = configured == null ? null : Number(configured);
  const status = order.status === '进行中' ? '服务中' : order.status;
  return {
    ...order, status,
    productName: order.product || order.title || '订单商品',
    customerName: order.user || '微信客户',
    timeText: order.time || '',
    paidTimeText: timeLabel(order.paidAt),
    acceptedTimeText: timeLabel(order.acceptedAt),
    mainCategory: order.mainCategory || product.mainCategory || product.gameCategory || '',
    productImage: resolveAssetUrl(order.productImage || product.imageUrl || '', baseUrl),
    priceText: Number(order.price || 0).toFixed(2),
    incomeText: income !== null && Number.isFinite(income) && income >= 0 ? income.toFixed(2) : '待确认',
    prizeText: (order.lottery?.results || []).map(item => item.name).filter(Boolean).join('、'),
    statusTone: status === '服务中' ? 'serving' : status === '待结单' ? 'pending' : 'plain',
    chatUnread: Number(unread) || 0
  };
}

function dashboard(orders, customer, config, baseUrl, unread) {
  const pendingOrders = orders.filter(order => !order.staffId && ['待服务', '待接单'].includes(order.status)
    && order.paymentStatus === 'paid'
    && (!order.lottery || order.lottery.status === 'completed'))
    .map(order => orderView(order, config, baseUrl));
  const myTasks = orders.filter(order => order.staffId === customer.customerId)
    .map(order => orderView(order, config, baseUrl, unread[order.no]));
  const games = normalizeCategories(config).map(game => ({ ...game,
    count: pendingOrders.filter(order => order.mainCategory === game.name).length
  }));
  const stats = ['待开始', '服务中', '待结单', '协助单', '已完成'].map(status => ({
    status, label: status === '已完成' ? '已结单' : status,
    count: status === '协助单' ? '—' : myTasks.filter(order => order.status === status).length
  }));
  return { pendingOrders, myTasks, games, stats, pendingCount: pendingOrders.length,
    doingCount: myTasks.length, unreadCount: myTasks.reduce((sum, order) => sum + order.chatUnread, 0) };
}

function filterOrders(data) {
  // 输入框还在打字时（没点「搜索」）先本地即时过滤，反馈快；
  // 一旦点了「搜索」，关键词就交给服务端做模糊匹配（那边匹配的字段比这几个多），
  // 本地必须让位 —— 否则「服务端搜到了、本地又砍掉」会出现搜不到的单。
  const query = data.searchTerm ? '' : String(data.keyword || '').trim().toLowerCase();
  const source = data.activeTab === 'hall' ? data.pendingOrders : data.myTasks;
  return source.filter(order => (data.activeTab !== 'hall' || !data.activeGame || order.mainCategory === data.activeGame)
    && (data.activeTab !== 'orders' || data.activeStatus === '全部' || order.status === data.activeStatus)
    && `${order.no} ${order.productName} ${order.customerName} ${order.gameId || ''}`.toLowerCase().includes(query));
}

module.exports = { statuses, tabs, features, dashboard, filterOrders };
