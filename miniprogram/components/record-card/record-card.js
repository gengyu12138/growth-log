const { present } = require('../../utils/presentation');
Component({
  properties: { entry: Object, birthday: String, canEdit: Boolean, reading: Boolean, preview: Boolean },
  data: { view: null, expanded: false, evidence: false },
  observers: {
    'entry,birthday,preview': function(entry, birthday, preview) {
      this.setData({ view: entry ? present(entry, birthday, preview) : null, expanded: false });
    },
  },
  methods: {
    open() {
      if (!this.data.reading && !this.data.preview && this.data.entry && this.data.entry._id) wx.navigateTo({ url: '/pages/edit/edit?readonly=1&id=' + encodeURIComponent(this.data.entry._id) });
    },
    expand() { this.setData({ expanded: !this.data.expanded }); },
    tag(e) { wx.navigateTo({ url: '/pages/search/search?q=' + encodeURIComponent(e.currentTarget.dataset.tag) }); },
    toggleEvidence() { this.setData({ evidence: !this.data.evidence }); },
    menu() { this.triggerEvent('menu', { id: this.data.entry._id }); },
    preview(e) { wx.previewImage({ current: e.currentTarget.dataset.src, urls: this.data.view.images }); },
  },
});
