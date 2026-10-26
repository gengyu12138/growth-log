Component({
  properties: {
    // 登录页用更密的粒子，主界面保持克制
    dense: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    motes: [],
  },

  lifetimes: {
    attached() {
      const n = this.data.dense ? 26 : 14;
      const motes = [];
      for (let i = 1; i <= n; i += 1) motes.push(i);
      this.setData({ motes });
    },
  },
});
