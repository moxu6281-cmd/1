const api = require('../../services/api');

Page({
  data: { conversations: [], visible: [], keyword: '', loading: true, error: '', chat: null, messages: [], input: '', sending: false, feedback: '', scrollTarget: '' },
  onShow() {
    this.active = true;
    const role = wx.getStorageSync('club_active_identity') === 'staff' ? 'staff' : 'boss';
    if (this.role && this.role !== role) this.setData({ chat: null, messages: [], input: '', conversations: [], visible: [] });
    this.role = role;
    const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tab) tab.setData({ selected: 3, hidden: !!this.data.chat });
    this.setData({ sending: false });
    this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.data.chat ? this.refreshChat() : this.refresh(), 3000);
  },
  onHide() { this.active = false; clearInterval(this.timer); },
  onUnload() { this.active = false; clearInterval(this.timer); },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  async refresh() {
    if (this.loadingList || !this.active) return;
    this.loadingList = true;
    try {
      const app = getApp();
      await app.ensureCustomerIdentity();
      const result = await api.getConversations(app.globalData.merchantAccount, this.role);
      if (!this.active) return;
      const conversations = (result.conversations || []).map((item) => ({ ...item, initial: item.peerName.slice(0, 1), date: `${new Date(item.updatedAt).getMonth() + 1}/${new Date(item.updatedAt).getDate()}` }));
      this.setData({ conversations, loading: false, error: '' }, () => this.filter());
      const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tab) tab.refreshMessages();
    } catch (error) { if (this.active) this.setData({ loading: false, error: error.message || '消息加载失败' }); }
    finally { this.loadingList = false; }
  },
  search(event) { this.setData({ keyword: event.detail.value }, () => this.filter()); },
  filter() {
    const query = this.data.keyword.trim().toLowerCase();
    this.setData({ visible: this.data.conversations.filter((item) => `${item.peerName} ${item.product} ${item.orderNo}`.toLowerCase().includes(query)) });
  },
  openChat(event) {
    const chat = this.data.conversations.find((item) => item.orderNo === event.currentTarget.dataset.no);
    if (!chat) return;
    this.fingerprint = '';
    this.setData({ chat, messages: [], input: '', feedback: '加载中...', scrollTarget: '' });
    const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tab) tab.setData({ hidden: true });
    this.refreshChat();
  },
  closeChat() {
    this.setData({ chat: null, input: '', messages: [], feedback: '' });
    const tab = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tab) tab.setData({ hidden: false });
    this.refresh();
  },
  applyMessages(messages) {
    const value = JSON.stringify(messages);
    if (value === this.fingerprint) return;
    this.fingerprint = value;
    this.setData({ messages, scrollTarget: '' }, () => this.setData({ scrollTarget: 'messageBottom' }));
  },
  async refreshChat() {
    const chat = this.data.chat;
    if (!chat || !this.active || this.reading || this.data.sending) return;
    this.reading = true;
    const revision = this.revision;
    try {
      const result = await api.getOrderChat(getApp().globalData.merchantAccount, chat.orderNo, { role: this.role });
      if (!this.active || this.data.chat !== chat || revision !== this.revision) return;
      this.applyMessages(result.messages || []);
      this.setData({ feedback: '' });
    } catch (error) { if (this.active && this.data.chat === chat) this.setData({ feedback: error.message || '连接失败，正在重试' }); }
    finally { this.reading = false; }
  },
  typeMessage(event) { this.setData({ input: event.detail.value }); },
  async send() {
    const chat = this.data.chat, text = this.data.input.trim();
    if (!chat || !text || this.data.sending) return;
    this.revision = (this.revision || 0) + 1;
    this.setData({ sending: true });
    try {
      const result = await api.sendOrderChat(getApp().globalData.merchantAccount, chat.orderNo, { role: this.role, text });
      if (!this.active || this.data.chat !== chat) return;
      this.applyMessages(result.messages || []);
      this.setData({ input: this.data.input.trim() === text ? '' : this.data.input, feedback: '' });
    } catch (error) { if (this.active && this.data.chat === chat) this.setData({ feedback: error.message || '发送失败，请重试' }); }
    finally { if (this.active) this.setData({ sending: false }); }
  }
});
