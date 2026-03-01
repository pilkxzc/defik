/**
 * Custom klinecharts overlay: tradeMarker
 * Renders a filled triangle at a price/timestamp coordinate.
 *   - Buy  → upward triangle below the price level (green)
 *   - Sell → downward triangle above the price level (red)
 *
 * Usage:
 *   registerTradeMarkerOverlay(klinecharts)
 *
 *   chart.createOverlay({
 *     name:       'tradeMarker',
 *     groupId:    'trade-markers',
 *     lock:       true,
 *     points:     [{ timestamp: ms, value: price }],
 *     extendData: { isBuy: true },
 *   })
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerTradeMarkerOverlay(klinecharts: any): void {
  try {
    klinecharts.registerOverlay({
      name:                    'tradeMarker',
      totalStep:               1,
      needDefaultPointFigure:  false,
      needDefaultXAxisFigure:  false,
      needDefaultYAxisFigure:  false,

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createPointFigures({ overlay, coordinates }: any) {
        const c = coordinates?.[0] as { x: number; y: number } | undefined;
        if (!c) return [];

        const data   = (overlay.extendData ?? {}) as { isBuy?: boolean };
        const isBuy  = data.isBuy === true;
        const color  = isBuy ? '#10B981' : '#EF4444';
        const size   = 7;
        const offset = 12;

        let coords: Array<{ x: number; y: number }>;

        if (isBuy) {
          // Upward-pointing triangle, tip just below the price level
          const tipY  = c.y + offset;
          coords = [
            { x: c.x,        y: tipY },
            { x: c.x - size, y: tipY + size * 1.5 },
            { x: c.x + size, y: tipY + size * 1.5 },
          ];
        } else {
          // Downward-pointing triangle, tip just above the price level
          const tipY  = c.y - offset;
          coords = [
            { x: c.x,        y: tipY },
            { x: c.x - size, y: tipY - size * 1.5 },
            { x: c.x + size, y: tipY - size * 1.5 },
          ];
        }

        return [
          {
            type:   'polygon',
            attrs:  { coordinates: coords },
            styles: { style: 'fill', color },
          },
        ];
      },
    });
  } catch {
    // Already registered — harmless on hot-reload
  }
}
