const { productView, isProductCategoryVisible } = require("../../utils/data");

// 详情页的评价一律来自服务端注入的 config.reviews —— 里面只有「商户审核通过」的评价，
// 待审核和被驳回的不会下发到前台。所以这里读到的每一条都是可以公开展示的真实评价。
function reviewsOfProduct(config, productId) {
  return (Array.isArray(config.reviews) ? config.reviews : [])
    .filter((item) => item && String(item.content || "").trim())
    .filter((item) => String(item.productId || "") === String(productId));
}

function starText(count) {
  return "★★★★★".slice(0, Math.min(5, Math.max(1, Number(count) || 5)));
}

Page({
  data: { loading: true, productId: "", product: null, reviews: [], positiveRate: 0, floatItems: [], floatEnabled: false },
  onLoad(options) {
    this.setData({ productId: String(options.id || "") });
    this.loadProduct(true);
  },
  onShow() {
    if (this.data.product && this.data.productId) this.loadProduct(true, false);
  },
  async loadProduct(force, showLoading = true) {
    if (showLoading) this.setData({ loading: true });
    try {
      const config = await getApp().loadConfig(force);
      const source = (config.products || []).find((item) => String(item.id) === this.data.productId);
      const product = source ? productView(source) : null;
      if (!product || product.status !== "visible" || !isProductCategoryVisible(config, product)) {
        throw new Error("商品不存在或已下架");
      }
      const reviews = reviewsOfProduct(config, product.id).map((item) => {
        const displayName = String(item.displayName || "用户");
        return {
          id: String(item.id || item.orderNo),
          displayName,
          initial: displayName.slice(0, 1),
          stars: starText(item.rating),
          content: String(item.content || "")
        };
      });
      const good = reviewsOfProduct(config, product.id).filter((item) => Number(item.rating || 0) >= 4).length;
      const positiveRate = reviews.length ? Math.round((good / reviews.length) * 100) : 0;
      // 详情图内飘屏 = 这个商品已通过审核的真实评价，一条都没有就不飘。
      const floatItems = reviews.slice(0, 8).map((item, index) => ({
        id: item.id,
        text: `${item.displayName}：${item.content}`,
        avatarUrl: "",
        initial: item.initial,
        lane: index % 4,
        delay: Number((index * 0.85).toFixed(2)),
        duration: Number((4.8 + (index % 3) * 0.6).toFixed(2))
      }));
      this.setData({ loading: false, product, reviews, positiveRate, floatItems, floatEnabled: config.detailFloatEnabled !== false && floatItems.length > 0 });
      wx.setNavigationBarTitle({ title: product.title || "详情展示" });
    } catch (error) { this.setData({ loading: false }); wx.showModal({ title: "无法打开商品", content: error.message, showCancel: false }); }
  },
  buy() { wx.navigateTo({ url: `/pages/submit/index?id=${encodeURIComponent(this.data.product.id)}` }); },
  support() {
    const actions = Object.values(getApp().globalData.config?.quickActions || {});
    const service = actions.find((item) => item && item.type === "customerService");
    if (service?.appId) {
      return wx.navigateToMiniProgram({ appId: service.appId, path: service.path || "", fail: () => wx.showToast({ title: service.text || "暂时无法打开客服", icon: "none" }) });
    }
    wx.showModal({ title: service?.title || "联系客服", content: service?.text || "请从首页联系客服入口咨询", showCancel: false });
  }
});
