const api = require("../../services/api");
const { money } = require("../../utils/data");
const { resolveAssetUrl } = require("../../utils/image");

function wheelLayout(prizes, base) {
  const count = Math.max(1, prizes.length), segment = 360 / count;
  return prizes.map((prize, index) => {
    const angle = count === 1 ? 0 : (index + .5) * segment, rad = angle * Math.PI / 180;
    const points = ["50% 50%"];
    for (let step = 0; step <= 36; step++) {
      const theta = (index * segment + segment * step / 36) * Math.PI / 180;
      points.push(`${50 + Math.sin(theta) * 50}% ${50 - Math.cos(theta) * 50}%`);
    }
    return { ...prize, imageUrl: resolveAssetUrl(prize.imageUrl, base), sectorStyle: `background:${index % 2 ? "#ffffff" : "#fff4df"};clip-path:polygon(${points.join(",")});`, style: `left:${50 + Math.sin(rad) * 32}%;top:${50 - Math.cos(rad) * 32}%;width:${Math.min(25, 115 / count)}%;transform:translate(-50%,-50%) rotate(${angle}deg);` };
  });
}

Page({
  data: { loading: true, error: "", order: null, fields: [], prizes: [], results: [], lotteryVisible: false, drawing: false, resultText: "", rotation: 0, remaining: 0 },
  onLoad(options) { this.orderNo = options.no || ""; this.autoLottery = options.draw === "1"; },
  onShow() { this.active = true; this.load(); clearInterval(this.orderTimer); this.orderTimer = setInterval(() => { if (!this.data.lotteryVisible) this.load(); }, 5000); },
  onHide() { this.active = false; clearInterval(this.orderTimer); },
  onUnload() { this.active = false; this.unloaded = true; clearInterval(this.orderTimer); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.drawing || this.loadingOrder) return;
    this.loadingOrder = true;
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const order = await api.getOrderDetail(app.globalData.merchantAccount, this.orderNo);
      if (!this.active) return;
      this.applyOrder(order);
      if (this.autoLottery && order.paymentStatus === "paid" && order.lottery?.status === "pending") this.openLottery();
      this.autoLottery = false;
    } catch (error) { if (this.active) this.setData({ loading: false, error: error.message }); }
    finally { this.loadingOrder = false; }
  },
  applyOrder(order) {
    const base = getApp().globalData.apiBaseUrl;
    const prizes = wheelLayout(order.lottery?.prizes || [], base);
    const fields = [["订单编号", order.no, true], ["游戏 ID", order.gameId, true], ["游戏昵称", order.gameName], ["游戏区服", order.server], ["下单备注", order.remark || "无"], ...(order.refund ? [["退款原因", order.refund.reason]] : []), ["下单时间", order.time], ["付款时间", order.paidAt ? new Date(order.paidAt).toLocaleString() : order.paymentStatus === "paid" ? "已支付" : "未支付"]].map(([label, value, copy]) => ({ label, value: String(value || "-"), copy: !!copy }));
    const remaining = Math.max(0, Number(order.lottery?.totalDraws || 0) - Number(order.lottery?.completedDraws || 0));
    const status = ['待抽奖', '待服务'].includes(order.status) ? '待接单' : order.status === '进行中' ? '服务中' : order.status;
    order = { ...order, status };
    const progress = ({ '待付款': 0, '待接单': 25, '待开始': 40, '服务中': 65, '待结单': 85, '已完成': 100 })[status] || 0;
    const statusDescription = order.lottery?.status === 'pending' && order.paymentStatus === 'paid' ? '等待完成抽奖' : ({ '待付款': '等待支付', '待接单': '等待陪玩接单中', '待开始': '打手已接单，等待开始服务', '服务中': '陪玩正在为你服务', '待结单': '截图已提交，等待商户结单', '已完成': '本次服务已完成', '已取消': '订单已取消', '退款中': '商户已发起退款，等待原路退回', '退款异常': '退款异常，请联系商户处理', '退款失败': '退款未完成，请联系商户处理', '已退款': '订单款项已退回原支付方式' })[status] || status;
    this.setData({ statusDescription });
    this.setData({ loading: false, error: "", order: { ...order, priceText: money(order.price), paidText: money(["paid", "refund_pending", "refund_closed", "refunded"].includes(order.paymentStatus) ? order.price : 0), paymentLabel: order.paymentStatus === "refunded" ? "已退款" : order.paymentStatus === "refund_pending" ? order.status : order.paymentStatus === "refund_closed" ? "退款失败" : "实付款", productImage: resolveAssetUrl(order.productImage || "", base) }, fields, prizes, remaining, progress, canDraw: order.paymentStatus === "paid" && remaining > 0, results: (order.lottery?.results || []).map((result) => ({ ...result, imageUrl: resolveAssetUrl(result.imageUrl || prizes.find((prize) => prize.id === result.prizeId)?.imageUrl || "", base) })) });
  },
  openLottery() { if (this.data.canDraw) this.setData({ lotteryVisible: true, resultText: "", rotation: 0 }); },
  closeLottery() { if (!this.data.drawing) this.setData({ lotteryVisible: false }); },
  async drawLottery() {
    if (this.data.drawing) return;
    if (!this.data.remaining) return this.closeLottery();
    this.setData({ drawing: true, resultText: "抽奖中..." });
    try {
      const payload = await api.drawLottery(getApp().globalData.merchantAccount, this.orderNo, Number(this.data.order.lottery.completedDraws || 0) + 1);
      if (this.unloaded) return;
      const index = this.data.prizes.findIndex((prize) => prize.id === payload.result.prizeId);
      const target = this.data.prizes.length === 1 ? 0 : (360 - (index + .5) * 360 / this.data.prizes.length) % 360;
      const rotation = this.data.rotation + 1440 + (target - this.data.rotation % 360 + 360) % 360;
      this.setData({ rotation });
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (!this.unloaded) { this.applyOrder(payload.order); this.setData({ resultText: `抽中了：${payload.result.name}` }); }
    } catch (error) { if (this.active) this.setData({ resultText: error.message || "抽奖失败，请重试" }); }
    finally { if (!this.unloaded) this.setData({ drawing: false }); }
  },
  copy(event) { wx.setClipboardData({ data: event.currentTarget.dataset.value }); },
  orders() { wx.switchTab({ url: "/pages/orders/index" }); },
  pay() { wx.navigateTo({ url: `/pages/submit/index?no=${encodeURIComponent(this.orderNo)}` }); },
  noop() {}
});
