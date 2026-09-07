Component({
  properties: {
    mode: {
      type: String,
      value: "empty" // "empty" | "offline" | "no_permission" | "search"
    },
    title: {
      type: String,
      value: ""
    },
    description: {
      type: String,
      value: ""
    },
    showAction: {
      type: Boolean,
      value: true
    },
    actionText: {
      type: String,
      value: ""
    }
  },
  methods: {
    handleActionTap() {
      this.triggerEvent("action", { mode: this.data.mode });
    }
  }
});
