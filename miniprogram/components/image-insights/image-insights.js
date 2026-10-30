Component({
  properties: { items: Array, busy: Boolean },
  data: { expanded: '' },
  methods: {
    toggle(e) { const path = e.currentTarget.dataset.path; this.setData({ expanded: this.data.expanded === path ? '' : path }); },
    retry(e) { this.triggerEvent('retry', { path: e.currentTarget.dataset.path }); },
    apply(e) { this.triggerEvent('apply', { path: e.currentTarget.dataset.path }); },
    edit(e) { this.triggerEvent('change', { path: e.currentTarget.dataset.path, field: e.currentTarget.dataset.field, value: e.detail.value }); },
    preview(e) { wx.previewImage({ current: e.currentTarget.dataset.path, urls: this.data.items.map((row) => row.path) }); },
  },
});
