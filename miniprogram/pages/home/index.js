const api = require("../../services/api");
const { productView, normalizeCategories, isProductCategoryVisible } = require("../../utils/data");

function getProductColumns(requestedColumns) {
  return Math.min(4, Math.max(1, Math.floor(Number(requestedColumns || 2))));
}

// The card size is owned by the CSS grid (`.product-grid.columns-N`), so a short last
// row keeps the configured card width and lines up with the first column instead of
// being centred by the mini program's default `button` auto margins.
function safeColor(value, fallback) {
  const color = String(value || "").trim();
  return /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%]+\))$/i.test(color) ? color : fallback;
}

function popupStyles(config) {
  const size = Math.min(28, Math.max(14, Number(config.popupFontSize || 18)));
  const family = String(config.popupFontFamily || "Microsoft YaHei, PingFang SC, sans-serif").replace(/[;{}]/g, "");
  return {
    body: `color:${safeColor(config.popupTextColor, "#111827")};font-size:${size * 2}rpx;font-family:${family};`,
    title: `color:${safeColor(config.popupTitleColor, "#111827")};font-family:${family};`
  };
}

function textHash(value) {
  let hash = 0;
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function noticeStorageKey(account, config) {
  const version = textHash([
    config.popupHeader,
    config.popupTitle,
    config.popupContent,
    config.popupBannerText,
    config.popupBannerColor
  ].join("|"));
  return `notice_closed_${account}_${version}`;
}

function broadcastText(item) {
  if (!item || !item.user || !item.product) return "";
  return `${item.user} 购买了 ${item.product}`;
}

// 首页播报改成「漂浮气泡」（与老板端一致）：每条气泡各自跑一条 16s 无限循环的
// broadcastFloat 动画（时长写在 index.wxss 的 animation 上），靠 animation-delay
// 依次错开入场/停留/飘走，纯 CSS 自循环，不再需要 JS 定时器反复重挂类名。
// 一轮 16s / 每 4s 一条 = 4 个气泡刚好铺满，超出的会落在同一相位重叠，所以只取最近 4 条。
const BROADCAST_STEP_MS = 4000;
const BROADCAST_MAX = 4;

function buildBroadcasts(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => broadcastText(item))
    .filter(Boolean)
    .slice(0, BROADCAST_MAX)
    .map((text, index) => ({ id: `broadcast-${index}`, text, delay: (index * BROADCAST_STEP_MS) / 1000 }));
}

Page({
  data: {
    loading: true,
    error: "",
    config: {},
    products: [],
    filteredProducts: [],
    categories: [],
    subCategories: [],
    activeMain: "",
    activeSub: "",
    keyword: "",
    categoryVisible: false,
    noticeVisible: false,
    noticePending: false,
    noticeStorageKey: "",
    productsPerRow: 2,
    gridStyle: "",
    configMeta: "",
    noticeBodyStyle: "",
    noticeTitleStyle: "",
    compactProducts: false,
    ultraCompactProducts: false,
    broadcasts: [],
    previewFallback: false
  },

  onLoad() { this.refresh(true); },
  onShow() {
    this.syncTabBar();
    if (!this.data.loading) this.refresh(true);
    this.startConfigWatcher();
  },
  onHide() { this.stopConfigWatcher(); },
  onUnload() { this.stopConfigWatcher(); },
  onPullDownRefresh() { this.refresh(true).finally(() => wx.stopPullDownRefresh()); },

  // Keep the storefront in step with the backend: poll a tiny version probe and only
  // re-download the full config when the merchant actually saved something.
  startConfigWatcher() {
    this.stopConfigWatcher();
    this.configTimer = setInterval(async () => {
      try {
        const app = getApp();
        const meta = await api.getConfigMeta(app.globalData.merchantAccount);
        if (!meta || meta === this.data.configMeta) return;
        await this.refresh(true);
      } catch (error) {
        // Polling must never break the page; the next tick retries.
      }
    }, 5000);
  },
  stopConfigWatcher() {
    if (this.configTimer) clearInterval(this.configTimer);
    this.configTimer = null;
  },

  async refresh(force) {
    try {
      const app = getApp();
      const account = app.globalData.merchantAccount;
      // Probe before downloading so an edit landing mid-request is caught next tick.
      const configMeta = await api.getConfigMeta(account);
      const config = await app.loadConfig(force);
      let recentBroadcasts = [];
      try {
        recentBroadcasts = await api.getRecentBroadcasts(account);
      } catch (error) {
        if (!app.globalData.previewFallback) throw error;
      }
      const categories = normalizeCategories(config);
      const retainedMain = categories.some((item) => item.name === this.data.activeMain) ? this.data.activeMain : "";
      const activeMain = retainedMain || categories[0]?.name || "";
      const subCategories = categories.find((item) => item.name === activeMain)?.children || [];
      const productsPerRow = getProductColumns(config.productsPerRow);
      const gridStyle = `grid-template-columns: repeat(${productsPerRow}, minmax(0, 1fr));`;
      const styles = popupStyles(config);
      const storageKey = noticeStorageKey(account, config);
      const shouldShowCategory = !retainedMain && !this.data.activeMain && categories.length > 1;
      const shouldShowNotice = Boolean(config.popupEnabled && !wx.getStorageSync(storageKey));
      console.log(`[首页] 每排列数=${productsPerRow} 栅格=${gridStyle} 商品数=${Array.isArray(config.products) ? config.products.length : 0} 配置版本=${configMeta || "未取到"}`);
      this.setData({
        loading: false,
        error: "",
        config,
        products: Array.isArray(config.products)
          ? config.products.map(productView).filter((product) => isProductCategoryVisible(config, product))
          : [],
        categories,
        subCategories,
        activeMain,
        productsPerRow,
        gridStyle,
        configMeta,
        noticeBodyStyle: styles.body,
        noticeTitleStyle: styles.title,
        compactProducts: productsPerRow >= 3,
        ultraCompactProducts: productsPerRow >= 4,
        broadcasts: buildBroadcasts(recentBroadcasts),
        previewFallback: Boolean(app.globalData.previewFallback),
        categoryVisible: shouldShowCategory,
        noticeStorageKey: storageKey,
        noticeVisible: shouldShowNotice && !shouldShowCategory,
        noticePending: shouldShowNotice && shouldShowCategory
      }, () => {
        this.applyFilters();
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || "配置加载失败" });
    }
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const filteredProducts = this.data.products.filter((product) => {
      const mainOk = !this.data.activeMain || product.mainCategory === this.data.activeMain;
      const subOk = !this.data.activeSub || product.subCategory === this.data.activeSub || product.category === this.data.activeSub;
      const keywordOk = !keyword || `${product.title || ""} ${product.desc || ""}`.toLowerCase().includes(keyword);
      return mainOk && subOk && keywordOk && product.status === "visible";
    });
    this.setData({ filteredProducts });
  },

  onSearch(event) { this.setData({ keyword: event.detail.value }, () => this.applyFilters()); },
  chooseMain(event) {
    const activeMain = event.currentTarget.dataset.name;
    const subCategories = this.data.categories.find((item) => item.name === activeMain)?.children || [];
    wx.setStorageSync("club_active_main_category", activeMain);
    const showNotice = this.data.noticePending;
    this.setData({
      activeMain,
      activeSub: "",
      subCategories,
      categoryVisible: false,
      noticeVisible: showNotice,
      noticePending: false
    }, () => this.applyFilters());
  },
  chooseSub(event) { this.setData({ activeSub: event.currentTarget.dataset.name || "" }, () => this.applyFilters()); },
  openChooser() { this.setData({ categoryVisible: true }); },
  closeChooser() {
    const showNotice = this.data.noticePending;
    this.setData({ categoryVisible: false, noticeVisible: showNotice, noticePending: false });
  },
  closeNotice() {
    if (this.data.noticeStorageKey) wx.setStorageSync(this.data.noticeStorageKey, true);
    this.setData({ noticeVisible: false, noticePending: false });
  },
  openProduct(event) { wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  showAction(item) { wx.showModal({ title: item.title || "服务说明", content: item.text || item.action || "请联系俱乐部客服", showCancel: false }); },
  openSupport() {
    const item = Object.values(this.data.config.quickActions || {}).find((action) => action?.type === "customerService");
    if (item) this.runSupportAction(item);
    else wx.showToast({ title: "商户暂未配置客服", icon: "none" });
  },
  runSupportAction(item) {
    if (item.appId) return wx.navigateToMiniProgram({ appId: item.appId, path: item.path || "", fail: () => this.showAction(item) });
    this.showAction(item);
  },
  syncTabBar() {
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 0 });
  },
  noop() {}
});
