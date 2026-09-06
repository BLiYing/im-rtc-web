import type { ReactNode } from 'react';

import { useCall } from '../useCall.js';
import { ActiveCall } from './ActiveCall.js';
import { CallEnded } from './CallEnded.js';
import { IncomingCall } from './IncomingCall.js';
import { MiniWindow } from './MiniWindow.js';
import { PromptCard } from './PromptCard.js';

/**
 * CallOverlay 是 uikit 的唯一入口组件：按阶段决定显示什么。
 *
 * 宿主把它放在应用根部就行——**它自己知道什么时候该出现**，
 * 不需要宿主判断「现在有没有通话」。这正是「引 uikit 就完事」那条集成路线。
 *
 * 权限说明卡 / 被拒提示卡叠在最上面，**不受阶段限制**：它们出现在拨出之前、接听之前。
 */
export function CallOverlay(): ReactNode {
  const { state, prompt } = useCall();
  const card = prompt === null ? null : (
    <PromptCard
      title={prompt.title}
      body={prompt.body}
      primary={prompt.primary}
      {...(prompt.secondary === undefined ? {} : { secondary: prompt.secondary })}
      testId={`prompt-${prompt.kind}`}
    />
  );

  return (
    <>
      {body(state.phase, state.isMinimized)}
      {card}
    </>
  );
}

function body(phase: string, isMinimized: boolean): ReactNode {
  if (phase === 'idle') return null;
  if (phase === 'incoming') return <IncomingCall />;
  /*
    **结束态有自己的一屏**，不能落到 ActiveCall 上——那会把「静音 / 关摄像头 /
    小窗 / 挂断」这排接通后才有的按钮连同九宫格一起显示出来。
    （还在响铃的来电根本不会进结束态，直接回 idle，见 callView.ts。）
  */
  if (phase === 'ended') return <CallEnded />;
  if (isMinimized) return <MiniWindow />;
  return <ActiveCall />;
}
