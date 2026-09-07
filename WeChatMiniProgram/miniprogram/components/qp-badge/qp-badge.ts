Component({
  properties: {
    variant: {
      type: String,
      value: "primary" // "primary" | "aurora" | "success" | "warning" | "danger" | "purple" | "neutral"
    },
    text: {
      type: String,
      value: ""
    },
    count: {
      type: Number,
      value: 0
    },
    isDot: {
      type: Boolean,
      value: false
    },
    glow: {
      type: Boolean,
      value: false
    }
  },
  data: {
    displayCount: ""
  },
  observers: {
    count(val: number) {
      if (typeof val !== "number" || val <= 0) {
        this.setData({ displayCount: "" });
      } else if (val > 99) {
        this.setData({ displayCount: "99+" });
      } else {
        this.setData({ displayCount: String(val) });
      }
    }
  }
});
