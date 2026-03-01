import { memo } from 'react';
import type { WsConnectionStatus } from '../types/binance';

const LABELS: Record<WsConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting:   'Connecting…',
  connected:    'Live',
  error:        'Error',
};

interface Props {
  status: WsConnectionStatus;
}

/**
 * Small pill that shows WebSocket connection state.
 * Wrapped in memo — only re-renders when `status` actually changes.
 */
export const WsStatusIndicator = memo(({ status }: Props) => (
  <div className="ws-status">
    <div className={`ws-status-dot ${status}`} />
    <span>{LABELS[status]}</span>
  </div>
));

WsStatusIndicator.displayName = 'WsStatusIndicator';
