// 状态栏占位：分类页用 navigationStyle: custom + 自绘标题栏，所以顶部需要一块
// 高度 = statusBarHeight 的占位，否则标题栏会被状态栏盖住。
// 取不到系统信息时高度按 0 处理，不报错（真机上极少数机型拿不到）。
Component({
  data: { style: "height:0px" },
  lifetimes: {
    attached() { this.refreshStyle(); }
  },
  methods: {
    refreshStyle() {
      let statusBarHeight = 0;
      try {
        const info = typeof wx.getWindowInfo === "function" ? wx.getWindowInfo() : wx.getSystemInfoSync();
        statusBarHeight = Number(info && info.statusBarHeight) || 0;
      } catch (error) {
        statusBarHeight = 0;
      }
      this.setData({ style: `height:${statusBarHeight}px` });
    }
  }
});
