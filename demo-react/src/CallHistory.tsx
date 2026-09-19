import type { CallHistoryRecord } from 'im-rtc-call-engine';
import { normalizeReason } from 'im-rtc-call-engine';
import { endReasonText, useCall } from 'im-rtc-call-uikit-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { formatCallTime } from './historyTime.js';

const PAGE_SIZE = 20;

/** CallHistoryProps 是通话记录面板的参数。 */
export interface CallHistoryProps {
  readonly uid: string;
}

/**
 * 通话记录：**调 SDK 的 `engine.fetchCallHistory` 从服务端拉**，游标翻页。
 *
 * **这是示范不是要求**（CONVENTIONS §11）：本产品不做「消息气泡」那类宿主业务界面。
 * 想自己存，就拿 `callEnd` 事件落自己的库；想让清缓存、换设备后记录还在，就查这里。
 * 进页与每次通话结束重拉首页；「加载更多」按 `nextCursor` 翻页，为 `null` 就没有了。
 */
export function CallHistory({ uid }: CallHistoryProps): ReactNode {
  const { engine } = useCall();
  const [records, setRecords] = useState<readonly CallHistoryRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** 刷新会让还在路上的旧请求作废：应答回来时代数对不上就丢掉。 */
  const generation = useRef(0);
  const now = Date.now();

  const load = useCallback(
    (first: boolean, cursor: number | null): void => {
      const ticket = first ? ++generation.current : generation.current;
      setLoading(true);
      engine
        .fetchCallHistory({ limit: PAGE_SIZE, ...(cursor === null ? {} : { cursor }) })
        .then((page) => {
          if (ticket !== generation.current) return;
          setRecords((prev) => (first ? page.records : [...prev, ...page.records]));
          setNextCursor(page.nextCursor);
          setError('');
        })
        .catch((err: unknown) => {
          if (ticket !== generation.current) return;
          setError(String(err));
        })
        .finally(() => {
          if (ticket === generation.current) setLoading(false);
        });
    },
    [engine],
  );

  // 首次加载；卸载时把代数推进一格，让在路上的应答作废（不往已卸载的组件里写状态）。
  useEffect(() => {
    load(true, null);
    return () => {
      generation.current += 1;
    };
  }, [load]);

  // 通话结束后自动刷新。记录是在服务端 `call.ended` 那一刻落库的，收到事件时去查一定查得到。
  useEffect(() => engine.on('callEnd', () => load(true, null)), [engine, load]);

  return (
    <div className="card">
      <h2>通话记录</h2>
      {records.length === 0 ? (
        <div className="muted">{loading ? '加载中…' : '还没有记录。打一通就有了。'}</div>
      ) : (
        <div>
          {records.map((r) => {
            const role = r.caller === uid ? 'caller' : 'callee';
            // 未接来电红字：被叫 + 没接通。这是记录页唯一需要一眼看出来的东西。
            const missed = role === 'callee' && r.durationSec === 0;
            return (
              <div className="history-row" key={r.callId}>
                <div className="history-icon">{iconOf(r)}</div>
                <div className="history-main">
                  <div className={missed ? 'history-name missed' : 'history-name'}>{peerText(r, uid)}</div>
                  <div className="history-sub">
                    {role === 'callee' ? '来电' : '呼出'} · {reasonText(r, role)}
                  </div>
                </div>
                <div className="history-time">{formatCallTime(r.startedAtMs, now)}</div>
              </div>
            );
          })}
        </div>
      )}
      {nextCursor !== null && (
        <button type="button" disabled={loading} onClick={(): void => load(false, nextCursor)}>
          {loading ? '加载中…' : '加载更多'}
        </button>
      )}
      {error !== '' && <div className="note" style={{ color: '#e5484d' }}>{error}</div>}
      <div className="note">
        数据来自 SDK 的 <code>engine.fetchCallHistory</code>（服务端 <code>GET /v1/calls</code>，只返回本人参与过的通话）；
        宿主也可以只用 webhook 落自己的库。
      </div>
    </div>
  );
}

function iconOf(record: CallHistoryRecord): string {
  return record.isGroup ? '👥' : record.mediaType === 'video' ? '📹' : '📞';
}

/** 对方是谁：被叫看主叫；主叫看第一个被叫；群通话显示人数（与 Android `peerText` 同一套）。 */
function peerText(record: CallHistoryRecord, me: string): string {
  if (record.isGroup) {
    const extra = record.members.some((m) => m.uid === record.caller) ? 0 : 1;
    return `群通话 · ${Math.max(record.members.length, 1) + extra} 人`;
  }
  if (record.caller !== me) return record.caller === '' ? '（未知）' : record.caller;
  return record.members.find((m) => m.uid !== me)?.uid ?? '（未知）';
}

/**
 * reasonText 把一条记录的 reason 翻成中文。
 *
 * **翻译其实在 SDK 侧**：uikit 公开导出了 `endReasonText`（`CallEnded` 结束画面用的就是它），
 * Demo 没有理由自己再维护一张覆盖不全的表。`normalizeReason` 先把陌生值折成 `error`，
 * 与 `endReasonText` 的兜底（「已结束」）配套。
 */
function reasonText(record: CallHistoryRecord, role: 'caller' | 'callee'): string {
  return endReasonText(normalizeReason(record.reason), role, record.durationSec);
}
