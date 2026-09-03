import { useCall } from '@im-rtc/call-uikit-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

import type { CallRecord } from './api.js';
import { listCalls } from './api.js';

/** CallHistoryProps 是通话记录面板的参数。 */
export interface CallHistoryProps {
  readonly server: string;
  readonly token: string;
  readonly uid: string;
}

/**
 * 通话记录。
 *
 * **这是示范不是要求**（CONVENTIONS §11）：本产品不做「消息气泡」那类宿主业务界面。
 * 记录长什么样、要不要变成一条聊天消息，是宿主自己的事——
 * 我们只保证 `call.ended` 之后 REST 与 webhook 里都有这条数据。
 */
export function CallHistory({ server, token, uid }: CallHistoryProps): ReactNode {
  const { engine } = useCall();
  const [records, setRecords] = useState<readonly CallRecord[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(
    (signal: AbortSignal): void => {
      void listCalls(server, token, uid, signal)
        .then(setRecords)
        .catch((err: unknown) => {
          if (signal.aborted) return; // 组件卸载导致的中止不是错误
          setError(String(err));
        });
    },
    [server, token, uid],
  );

  // 首次加载。**中止是必须的**：卸载后回来的响应会往已卸载的组件里写状态。
  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  // 通话结束后自动刷新。记录是在服务端 `call.ended` 那一刻落库的，
  // 所以收到事件时去查一定查得到。
  useEffect(() => {
    const controller = new AbortController();
    const off = engine.on('callEnd', () => refresh(controller.signal));
    return () => {
      off();
      controller.abort();
    };
  }, [engine, refresh]);

  return (
    <div className="card">
      <h2>通话记录</h2>
      {records.length === 0 ? (
        <div className="muted">还没有记录。打一通就有了。</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间</th><th>发起人</th><th>类型</th><th>结果</th><th>时长</th><th>成员</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.call_id}>
                <td>{new Date(r.started_at_ms).toLocaleTimeString()}</td>
                <td>{r.caller}</td>
                <td>{r.media_type === 'video' ? '视频' : '语音'}{r.is_group ? '·群' : ''}</td>
                <td>{reasonText(r.reason)}</td>
                <td>{r.duration_sec > 0 ? `${r.duration_sec}s` : '—'}</td>
                <td className="muted">{r.members.map((m) => m.uid).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error !== '' && <div className="note" style={{ color: '#e5484d' }}>{error}</div>}
      <div className="note">
        数据来自服务端的 <code>GET /v1/calls</code>；宿主也可以只用 webhook 落自己的库。
      </div>
    </div>
  );
}

/** reasonText 把协议的 reason 枚举翻成中文。**翻译在宿主侧**，SDK 不带文案。 */
function reasonText(reason: string): string {
  const table: Record<string, string> = {
    hangup: '已挂断', cancel: '已取消', reject: '已拒接', busy: '忙线',
    no_answer: '无应答', offline: '对方离线', network: '网络中断',
    kicked: '被移出', room_closed: '房间关闭', timeout: '超时', error: '出错',
  };
  return table[reason] ?? reason;
}
