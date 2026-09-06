import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { useCall } from '../useCall.js';

/**
 * RemoteAudioSink 是一个看不见的 `<audio>`，只为了让某个远端成员的**声音**播出来。
 *
 * # 为什么需要它
 *
 * engine 把某人的音视频轨道都装在同一条 `MediaStream` 里，经 `attachView(uid, el)` 挂到元素的
 * `srcObject` 上——**没挂元素的人是没有声音的**。语音版式上没有他的格子（只有大头像），
 * 小窗里也只画主讲人一格，这两处都得靠这个组件把其余人的声音接上。
 *
 * 一个 uid 只能挂一个元素（后挂的顶掉先挂的），所以**画了格子的人不要再给 sink**。
 */
export function RemoteAudioSink({ uid }: { readonly uid: string }): ReactNode {
  const { engine } = useCall();
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null || uid === '') return;
    engine.attachView(uid, el);
    return () => engine.attachView(uid, null);
  }, [engine, uid]);

  return <audio ref={ref} autoPlay style={{ display: 'none' }} data-testid={`audio-${uid}`} />;
}
