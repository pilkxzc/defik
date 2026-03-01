import { memo } from 'react';
import type { Timeframe } from '../types/binance';
import { ALL_TIMEFRAMES, SUB_MINUTE_TFS } from '../types/binance';

const SUB_TFS = ALL_TIMEFRAMES.filter(tf => SUB_MINUTE_TFS.has(tf));
const STD_TFS = ALL_TIMEFRAMES.filter(tf => !SUB_MINUTE_TFS.has(tf));

interface Props {
  current:  Timeframe;
  onChange: (tf: Timeframe) => void;
}

/**
 * Timeframe selector bar.
 * Renders two groups separated by a divider:
 *   - Purple: sub-minute (1s, 2s, 5s, 15s, 30s) — live aggregated
 *   - Green:  standard   (1m … 1M)              — Binance kline stream
 *
 * Wrapped in memo — only re-renders when `current` changes.
 */
export const TimeframeSelector = memo(({ current, onChange }: Props) => (
  <div className="interval-btns">
    {/* Sub-minute group */}
    <div className="interval-group">
      {SUB_TFS.map(tf => (
        <button
          key={tf}
          className={`interval-btn sub-tf${current === tf ? ' active' : ''}`}
          onClick={() => onChange(tf)}
        >
          {tf}
        </button>
      ))}
    </div>

    <div className="interval-tf-sep" />

    {/* Standard group */}
    <div className="interval-group">
      {STD_TFS.map(tf => (
        <button
          key={tf}
          className={`interval-btn${current === tf ? ' active' : ''}`}
          onClick={() => onChange(tf)}
        >
          {tf}
        </button>
      ))}
    </div>
  </div>
));

TimeframeSelector.displayName = 'TimeframeSelector';
