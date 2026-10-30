Component({
  properties: { active: String, flow: Boolean, disabled: Boolean },
  data: { tabs: [
    { key: 'records', label: '记录', route: 'pages/index/index' },
    { key: 'growth', label: '回顾', route: 'pages/growth/growth' },
    { key: 'assistant', label: '助手', route: 'pages/assistant/assistant' },
    { key: 'members', label: '家人', route: 'pages/members/members' },
  ] },
  methods: {
    open(e) {
      if (this.data.disabled) return;
      const tab = this.data.tabs[Number(e.currentTarget.dataset.index)];
      const pages = getCurrentPages();
      if (!tab || pages[pages.length - 1].route === tab.route) return;
      const found = pages.findIndex((p) => p.route === tab.route);
      if (found >= 0) wx.navigateBack({ delta: pages.length - found - 1 });
      else wx.navigateTo({ url: '/' + tab.route });
    },
  },
});
