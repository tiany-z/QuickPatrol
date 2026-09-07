Component({
  properties: {
    isWaiting: {
      type: Boolean,
      value: false
    },
    showHandshakeBtn: {
      type: Boolean,
      value: false
    },
    handlerName: {
      type: String,
      value: "责任维修师傅"
    }
  },

  methods: {
    onHandshakeTap() {
      this.triggerEvent("handshake");
    }
  }
});
