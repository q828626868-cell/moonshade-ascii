// 2D canvas 輸出：每格用 drawImage 從字元圖集貼上預先畫好的字元。
import { hexToRgb } from '../core/mathx.js';

export function createPresenter(canvas, renderCfg) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const debugCanvas = document.createElement('canvas');
  const debugCtx = debugCanvas.getContext('2d');
  let layout = null;
  let image = null;

  function clear() {
    const [r, g, b] = hexToRgb(renderCfg.background).map((c) => Math.round(c * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return {
    ctx,

    resize(l) {
      layout = l;
      canvas.width = l.width;
      canvas.height = l.height;
      debugCanvas.width = l.cols;
      debugCanvas.height = l.rows;
      image = debugCtx.createImageData(l.cols, l.rows);
      ctx.imageSmoothingEnabled = false;
    },

    // atlas：glyphAtlas（調色盤 p 在第 floor(p / rowsPerColumn) 欄、該欄的第 p % rowsPerColumn 列）
    draw(glyph, color, atlas) {
      clear();
      const { cols, rows, cw, ch, ox, oy } = layout;
      const source = atlas.canvas;
      const perColumn = atlas.layout.rowsPerColumn;
      const columnWidth = atlas.chars.length * cw;
      for (let y = 0, i = 0; y < rows; y++) {
        const dy = oy + (rows - 1 - y) * ch;
        for (let x = 0; x < cols; x++, i++) {
          const g = glyph[i];
          if (!g) continue;
          const p = color[i];
          const col = (p / perColumn) | 0;
          ctx.drawImage(source, col * columnWidth + g * cw, (p - col * perColumn) * ch, cw, ch, ox + x * cw, dy, cw, ch);
        }
      }
    },

    // WebGL 畫好的字元畫面整張貼上（render/glyphPass.js）
    blit(source) {
      ctx.drawImage(source, 0, 0);
    },

    drawDebug(fill) {
      fill(image.data);
      debugCtx.putImageData(image, 0, 0);
      clear();
      const { cols, rows, cw, ch, ox, oy } = layout;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(debugCanvas, ox, oy, cols * cw, rows * ch);
    },
  };
}
