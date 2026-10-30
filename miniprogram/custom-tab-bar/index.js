Component({
  data: { active: 'records', switching: false, tabs: [
    { key: 'records', label: '记录', route: 'pages/index/index' },
    { key: 'growth', label: '回顾', route: 'pages/growth/growth' },
    { key: 'assistant', label: '助手', route: 'pages/assistant/assistant' },
    { key: 'members', label: '家人', route: 'pages/members/members' },
  ] },
  methods: {
    open(e) {
      if (this.data.switching) return;
      const pages = getCurrentPages(), page = pages[pages.length - 1];
      if (!page) return;
      const d = page.data;
      if (d.busy || d.saving || d.pending || d.savePending || d.recording || d.transcribing || d.voiceStarting || d.profileBusy) {
        wx.showToast({ title: '请先完成当前操作', icon: 'none' }); return;
      }
      const tab = this.data.tabs[Number(e.currentTarget.dataset.index)];
      if (!tab || page.route === tab.route) return;
      this.setData({ switching: true });
      wx.switchTab({ url: '/' + tab.route,
        fail: () => wx.showToast({ title: '切换未成功，请重试', icon: 'none' }),
        complete: () => this.setData({ switching: false }),
      });
    },
  },
});
