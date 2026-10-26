Component({
  properties: {
    title: {
      type: String,
      value: '',
    },
    back: {
      type: Boolean,
      value: false,
    },
    customBack: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    statusBar: 20,
    barHeight: 44,
    total: 64,
  },

  lifetimes: {
    attached() {
      let statusBar = 20;
      let barHeight = 44;

      try {
        const win = wx.getWindowInfo();
        statusBar = win.statusBarHeight || 20;

        // 用胶囊按钮的位置反推导航栏高度，保证标题和胶囊垂直居中对齐
        const rect = wx.getMenuButtonBoundingClientRect();
        if (rect && rect.height) {
          barHeight = (rect.top - statusBar) * 2 + rect.height;
        }
      } catch (e) {
        // 取不到就用默认值
      }

      this.setData({
        statusBar,
        barHeight,
        total: statusBar + barHeight,
      });
    },
  },

  methods: {
    onBack() {
      if (this.properties.customBack) {
        this.triggerEvent('back');
        return;
      }
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
        return;
      }
      wx.reLaunch({ url: '/pages/index/index' });
    },
  },
});
