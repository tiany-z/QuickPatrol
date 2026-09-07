Component({
  properties: {
    layout: {
      type: String,
      value: "card" // "card" | "detail" | "list"
    },
    count: {
      type: Number,
      value: 3
    },
    animated: {
      type: Boolean,
      value: true
    }
  },
  data: {
    loopList: [0, 1, 2]
  },
  observers: {
    count(val: number) {
      const targetCount = typeof val === "number" && val > 0 ? val : 3;
      const arr = [];
      for (let i = 0; i < targetCount; i++) {
        arr.push(i);
      }
      this.setData({ loopList: arr });
    }
  }
});
