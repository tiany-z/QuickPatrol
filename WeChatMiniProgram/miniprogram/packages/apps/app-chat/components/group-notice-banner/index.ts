Component({
  properties: {
    notice: {
      type: Object,
      value: {
        visible: false,
        content: "",
        publisherName: "管理员",
        isPinned: true
      }
    }
  },

  data: {
    isExpanded: false
  },

  methods: {
    onTapToggleExpand() {
      this.setData({ isExpanded: !this.data.isExpanded });
    },

    onTapClose() {
      this.setData({ "notice.visible": false });
      this.triggerEvent("close");
    }
  }
});
