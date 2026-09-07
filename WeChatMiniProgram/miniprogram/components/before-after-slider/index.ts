/**
 * 高校后勤巡查e速办 v4.0 - M30: 施工整改实拍双图视差对比滑动组件
 * (Before-After Parallax Slider Component)
 */

Component({
  properties: {
    beforeImageUrl: {
      type: String,
      value: ""
    },
    afterImageUrl: {
      type: String,
      value: ""
    }
  },

  data: {
    sliderPercent: 50,
    containerWidth: 0,
    containerLeft: 0
  },

  lifetimes: {
    ready() {
      this.initContainerBounds();
    }
  },

  methods: {
    initContainerBounds() {
      const query = this.createSelectorQuery();
      query.select("#sliderContainer").boundingClientRect((rect) => {
        if (rect) {
          this.setData({
            containerWidth: rect.width,
            containerLeft: rect.left
          });
        }
      }).exec();
    },

    onTouchStart(e: WechatMiniprogram.TouchEvent) {
      this.updateSliderByTouch(e);
    },

    onTouchMove(e: WechatMiniprogram.TouchEvent) {
      this.updateSliderByTouch(e);
    },

    onTouchEnd() {
      // 触控结束，保留当前位置
    },

    updateSliderByTouch(e: WechatMiniprogram.TouchEvent) {
      if (!e.touches || e.touches.length === 0) return;
      const touchX = e.touches[0].clientX;
      const width = this.data.containerWidth;
      const left = this.data.containerLeft;

      if (width <= 0) {
        this.initContainerBounds();
        return;
      }

      let offsetX = touchX - left;
      if (offsetX < 0) offsetX = 0;
      if (offsetX > width) offsetX = width;

      const percent = Math.round((offsetX / width) * 100);
      this.setData({
        sliderPercent: percent
      });
    }
  }
});
