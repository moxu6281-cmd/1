const { productView, normalizeCategories, isProductCategoryVisible } = require("../../utils/data");

// 骨架屏占位数组：左栏 8 条、商品 5 条、榜单 5 条（与参考页 §3.3 一致）
const SKELETON_SIDEBAR = new Array(8).fill(0);
const SKELETON_GOODS = new Array(5).fill(0);
const SKELETON_RANK = new Array(5).fill(0);

Page({
  // activeTab 恒为 0：全页再无任何地方给它赋值，所以 activeTab === 1 的榜单分支永远不渲染
  // （参考页 §八.1 的真实行为，别"顺手修好"成可切换的 tab）。
  data: {
    activeTab: 0,
    topCategories: [],
    subCategories: [],
    activeTopIndex: 0,
    activeSubIndex: 0,
    activeSubId: "",
    goodsList: [],
    currentSubName: "",
    rankingList: [],
    rankingLoaded: false,
    loading: true,
    skeletonSidebar: SKELETON_SIDEBAR,
    skeletonGoods: SKELETON_GOODS,
    skeletonRank: SKELETON_RANK
  },

  onLoad() {
    // 二级分类 -> 商品数组。与参考页一样放在实例上而不是 data 里（避免整张缓存进 setData）。
    this.goodsCache = {};
    this.visibleProducts = [];
    this.activeMainName = "";
    this.loadedOnce = false;
    this.init(true);
  },

  onShow() {
    // 底部导航是框架的 custom-tab-bar（app.json 里 tabBar.custom = true），
    // 高亮只能由页面自己告诉它，删了这行「分类」这个 tab 就不会亮。
    const tabBar = typeof this.getTabBar === "function" ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 1 });
    if (!this.data.loading && this.loadedOnce) this.init(true);
  },

  onPullDownRefresh() {
    this.init(true).finally(() => wx.stopPullDownRefresh());
  },

  // 首屏：分类与排行榜并发（§4.1）。本项目的商品全在 config 里，
  // 所以"排行榜那一路"等分类把商品索引建好再排，不需要另打一次接口。
  async init(force) {
    this.setData({ loading: true });
    try {
      const categoriesTask = this.loadCategories(force);
      await Promise.all([categoriesTask, this.loadRanking(categoriesTask)]);
    } finally {
      this.loadedOnce = true;
      this.setData({ loading: false });
    }
  },

  async loadCategories(force) {
    try {
      const config = await getApp().loadConfig(force);
      const topCategories = normalizeCategories(config);
      // 下架 / 回收站的商品被 productView 归一成 status: "hidden"，前台一律不展示；
      // 隐藏大分类下的商品也不展示（沿用原分类页 filter() 的口径）。
      this.visibleProducts = (config.products || [])
        .map(productView)
        .filter((item) => item.status === "visible" && (!item.mainCategory || isProductCategoryVisible(config, item)));
      this.setData({ topCategories });

      if (!topCategories.length) {
        this.activeMainName = "";
        this.setData({ subCategories: [], activeTopIndex: 0, activeSubIndex: 0, activeSubId: "", currentSubName: "", goodsList: [] });
        return;
      }

      // 只有首屏才默认落到第一个大分类；之后（onShow / 下拉刷新）保留用户当前选中的那个，
      // 否则每次切回这个 tab 都会被弹回第一个分类。选中的大分类照旧落到本地缓存。
      const currentName = topCategories[this.data.activeTopIndex] && topCategories[this.data.activeTopIndex].name;
      const stored = wx.getStorageSync("club_active_main_category") || "";
      let activeTopIndex = topCategories.findIndex((item) => item.name === currentName);
      if (activeTopIndex < 0) activeTopIndex = topCategories.findIndex((item) => item.name === stored);
      if (activeTopIndex < 0) activeTopIndex = 0;
      this.selectTop(activeTopIndex, this.data.activeSubId);
    } catch (error) {
      wx.showToast({ title: error.message, icon: "none" });
    }
  },

  // 切/定大分类：默认选中它的第一个小分类；有缓存就不重算。
  selectTop(index, keepSubId) {
    const group = this.data.topCategories[index];
    if (!group) return;
    const children = Array.isArray(group.children) ? group.children : [];
    this.activeMainName = group.name;
    wx.setStorageSync("club_active_main_category", group.name);

    if (!children.length) {
      // 这个大分类没有小分类：退回"该大分类下的全部商品"。
      // 参考页这里会闪空（左栏与商品区全空），但本项目允许商户只建大分类不建小分类，
      // 闪空会让整页看起来像坏了，所以保留原分类页"显示全部商品"的行为。
      this.setData({ activeTopIndex: index, subCategories: [], activeSubIndex: 0, activeSubId: "", currentSubName: "", goodsList: [] });
      this.loadGoods("");
      return;
    }

    const keptIndex = keepSubId ? children.indexOf(keepSubId) : -1;
    const activeSubIndex = keptIndex >= 0 ? keptIndex : 0;
    const activeSubId = children[activeSubIndex];
    this.setData({ activeTopIndex: index, subCategories: children, activeSubIndex, activeSubId, currentSubName: activeSubId });
    this.loadGoods(activeSubId);
  },

  // 懒加载 + 缓存：缓存命中就直接切过去，不清空列表、也不重算。
  loadGoods(subId) {
    const targetSubId = subId || "";
    const cacheKey = `${this.activeMainName}|${targetSubId}`;
    if (this.goodsCache[cacheKey]) {
      this.setData({ goodsList: this.goodsCache[cacheKey] });
      return;
    }
    try {
      const mainName = this.activeMainName;
      this.goodsCache[cacheKey] = (this.visibleProducts || []).filter((item) => {
        const mainOk = !mainName || item.mainCategory === mainName;
        const subOk = !targetSubId || item.subCategory === targetSubId || item.category === targetSubId;
        return mainOk && subOk;
      });
    } catch (error) {
      console.error("分类商品加载失败:", error);
      this.goodsCache[cacheKey] = [];
    }
    this.setData({ goodsList: this.goodsCache[cacheKey] });
  },

  async loadRanking(categoriesTask) {
    if (categoriesTask) await categoriesTask;
    if (this.data.rankingLoaded) return;
    try {
      // 参考页这里单独打了一次 limit=20, sort=1 的榜单单；本项目商品本来就全在 config 里，
      // 所以用同一批可见商品按销量倒序取前 20 当榜单。
      // ⚠️ 榜单分支当前进不去（activeTab 恒 0），这份数据拿了暂时没处用 —— 与参考页一致。
      const rankingList = (this.visibleProducts || [])
        .slice()
        .sort((a, b) => Number(b.sold || 0) - Number(a.sold || 0))
        .slice(0, 20);
      this.setData({ rankingList, rankingLoaded: true });
    } catch (error) {
      console.error("排行榜数据加载失败:", error);
    }
  },

  onTopCategoryTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    this.selectTop(index);          // 切大分类时选它的第一个小分类
  },

  onSubCategoryTap(event) {
    const dataset = event.currentTarget.dataset;
    const activeSubIndex = Number(dataset.index) || 0;
    const activeSubId = dataset.id == null ? "" : String(dataset.id);
    this.setData({ activeSubIndex, activeSubId, currentSubName: activeSubId });
    this.loadGoods(activeSubId);
  },

  // 商品卡 / 榜单：进商品详情
  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id == null || id === "") return;
    wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(id)}` });
  },

  // 「立即下单」按钮：参考页这张卡和按钮都跳详情，本项目的下单流程在下单页，
  // 所以按钮按项目原有行为走 /pages/submit/index（catchtap 仍然阻止冒泡）。
  buy(event) {
    const id = event.currentTarget.dataset.id;
    if (id == null || id === "") return;
    wx.navigateTo({ url: `/pages/submit/index?id=${encodeURIComponent(id)}` });
  }
});
