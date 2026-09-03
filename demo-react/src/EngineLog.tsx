import type { EngineEventName } from '@im-rtc/call-engine';
import { useCall } from '@im-rtc/call-uikit-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

/** LogLine 是一条事件记录。 */
interface LogLine {
  readonly seq: number;
  readonly name: string;
  readonly payload: string;
  readonly isError: boolean;
}

/**
 * WATCHED 是这一页要显示的事件。
 *
 * **`error` 必须在里面**：engine 把失败的请求转成 error 事件而不是抛异常
 * （不然一次协商失败会中断整个事件流）。宿主不订阅它的话，
 * 「界面卡住但什么都不报」就成了默认体验——这一页自己踩过。
 */
const WATCHED: EngineEventName[] = [
  'error', 'connected', 'disconnected', 'kickedOut',
  'callReceived', 'callBegin', 'callEnd',
  'callCancelled', 'callRejected', 'callBusy', 'callNoAnswer', 'handledOnOtherDevice',
  'roomJoined', 'roomLeft', 'roomClosed',
  'userEnter', 'userLeave', 'userAccept', 'userReject', 'userNoResponse',
  // 音频与视频**两条都要在**：只显示视频那条的话，语音通话看起来像什么都没发生。
  'userAudioAvailable', 'userVideoAvailable', 'firstVideoFrame',
];

/*
 activeSpeakers 与 networkQuality **故意不显示**：它们是节流后的周期性事件
 （300ms / 2s），进这个面板会把真正要看的那几条冲掉。
 要看它们请单独订阅。
*/

/** EngineLog 把公开事件流打到页面上——这一页的「日志」就是产品的事件表。 */
export function EngineLog(): ReactNode {
  const { engine } = useCall();
  const [lines, setLines] = useState<readonly LogLine[]>([]);

  useEffect(() => {
    let seq = 0;
    const push = (name: EngineEventName, payload: unknown): void => {
      seq += 1;
      const line: LogLine = {
        seq, name, payload: JSON.stringify(payload), isError: name === 'error',
      };
      setLines((prev) => [line, ...prev].slice(0, 40));
    };
    const off = WATCHED.map((name) => engine.on(name, (payload) => push(name, payload)));
    return () => {
      for (const unsubscribe of off) unsubscribe();
    };
  }, [engine]);

  return (
    <div className="card">
      <h2>engine 事件流</h2>
      {lines.length === 0 ? (
        <div className="muted">还没有事件。</div>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', maxHeight: 220, overflow: 'auto' }}>
          {lines.map((line) => (
            <li key={line.seq} style={{ fontSize: 12, padding: '2px 0' }}>
              <b style={{ color: line.isError ? '#e5484d' : undefined }}>{line.name}</b>{' '}
              <span className="muted">{line.payload}</span>
            </li>
          ))}
        </ol>
      )}
      <div className="note">
        这些就是 <code>engine.on(...)</code> 能拿到的全部信息；uikit 也只用这些。
      </div>
    </div>
  );
}
