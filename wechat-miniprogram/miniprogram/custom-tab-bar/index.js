const api = require('../services/api');
Component({
  data: {
    selected: 0,
    unread: 0,
    tabs: [
      { pagePath: "/pages/home/index", text: "首页", icon: "home" },
      { pagePath: "/pages/category/index", text: "分类", icon: "grid" },
      { pagePath: "/pages/orders/index", text: "订单", icon: "order" },
      { pagePath: "/pages/messages/index", text: "消息", icon: "message" },
      { pagePath: "/pages/mine/index", text: "我的", icon: "user" }
    ]
  },
  lifetimes: {
    attached() { this.startMessages(); },
    detached() { this.alive = false; clearInterval(this.messageTimer); }
  },
  pageLifetimes: {
    show() { this.startMessages(); },
    hide() { this.alive = false; clearInterval(this.messageTimer); }
  },
  methods: {
    startMessages() {
      this.alive = true;
      clearInterval(this.messageTimer);
      this.refreshMessages();
      this.messageTimer = setInterval(() => this.refreshMessages(), 5000);
    },
    async refreshMessages() {
      if (this.checking || !this.alive) return;
      const app = getApp();
      if (!app.globalData.customerToken) return;
      this.checking = true;
      try {
        const role = wx.getStorageSync('club_active_identity') === 'staff' ? 'staff' : 'boss';
        const result = await api.getConversations(app.globalData.merchantAccount, role);
        if (this.alive) this.setData({ unread: (result.conversations || []).reduce((sum, item) => sum + item.unread, 0) });
      } catch (_) {} finally { this.checking = false; }
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index);
      const pagePath = event.currentTarget.dataset.path;
      if (!pagePath) return;
      this.setData({ selected: index });
      wx.switchTab({ url: pagePath });
    }
  }
});
