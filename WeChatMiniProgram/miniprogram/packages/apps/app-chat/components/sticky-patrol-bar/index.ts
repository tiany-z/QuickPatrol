/**
 * M37: 顶部工单微状态吸顶药丸逻辑组件 (sticky-patrol-bar)
 */



Component({
  properties: {
    patrolId: {
      type: Number,
      value: 0
    },
    orderNo: {
      type: String,
      value: ""
    },
    statusText: {
      type: String,
      value: "维修协同中"
    },
    locationName: {
      type: String,
      value: ""
    },
    isUrgent: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onTapPill() {
      this.triggerEvent("openDetailDrawer", {
        patrolId: this.data.patrolId,
        orderNo: this.data.orderNo
      });
    }
  }
});
