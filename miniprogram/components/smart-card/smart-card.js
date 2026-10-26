Component({
  properties: { card: { type: Object, value: null }, editable: Boolean, changeableType: Boolean, disabled: Boolean },
  data: { showEvidence: false },
  methods: {
    toggleEvidence() { this.setData({ showEvidence: !this.data.showEvidence }); },
    changeType(e) { if (this.data.editable && !this.data.disabled) this.triggerEvent('typechange', { value: e.detail.value }); },
    changeField(e) {
      if (!this.data.editable || this.data.disabled) return;
      this.triggerEvent('fieldchange', { index: Number(e.currentTarget.dataset.index), value: e.detail.value });
    },
    removeField(e) {
      if (!this.data.editable || this.data.disabled) return;
      this.triggerEvent('fieldchange', { index: Number(e.currentTarget.dataset.index), remove: true });
    },
    openSource(e) {
      const item = this.data.card.related[Number(e.currentTarget.dataset.index)];
      if (item) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(item.id) + '&revision=' + item.revision });
    },
    removeSource(e) {
      if (!this.data.editable || this.data.disabled) return;
      this.triggerEvent('unlink', { index: Number(e.currentTarget.dataset.index) });
    },
  },
});
