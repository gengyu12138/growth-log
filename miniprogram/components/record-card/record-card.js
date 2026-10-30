const { present } = require('../../utils/presentation');
Component({
  properties: { entry: Object, birthday: String, canEdit: Boolean, reading: Boolean, preview: Boolean, compact: Boolean },
  data: { view: null, expanded: false, evidence: false },
  observers: {
    'entry,birthday,preview,compact': function(entry, birthday, preview, compact) {
      const key = entry && JSON.stringify([entry._id || '', entry.revision || 0, entry.content]);
      const changed = key !== this.entryKey; this.entryKey = key;
      this.setData(Object.assign({ view: entry ? present(entry, birthday, preview, compact) : null }, changed ? { expanded: false, evidence: false } : {}));
    },
  },
  methods: {
    open() {
      if (!this.data.reading && !this.data.preview && this.data.entry && this.data.entry._id) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(this.data.entry._id) });
    },
    expand() { const expanded = !this.data.expanded; this.setData({ expanded, evidence: expanded && this.data.evidence }); },
    tag(e) { wx.navigateTo({ url: '/pages/search/search?q=' + encodeURIComponent(e.currentTarget.dataset.tag) }); },
    toggleEvidence() { this.setData({ evidence: !this.data.evidence }); },
    menu() { this.triggerEvent('menu', { id: this.data.entry._id }); },
    preview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.view.images }); },
  },
});
