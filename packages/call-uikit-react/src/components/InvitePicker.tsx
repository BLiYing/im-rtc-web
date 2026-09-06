import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { inviteSlotsLeft } from '../state/callView.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { Icon } from './Icon.js';

/**
 * InvitePicker 是「添加成员」的选人半屏（交互稿 §05 G2）。
 *
 * **候选名单是宿主给的**（`CallProvider` 的 `inviteCandidates`）——uikit 不内置联系人系统
 * （CONVENTIONS §11）。宿主没给名单时退化成一个 uid 输入框，功能不缺、只是没那么顺手。
 *
 * 已在通话里的人**置灰 + 勾选禁用**，不是隐藏：用户要能看到「他已经在里面了」。
 * 顶部实时算「还能加 N 人」= 9 − 当前人数 − 已选。离线的人照样可以邀请，服务端会回 offline。
 */
export interface InvitePickerProps {
  readonly onClose: () => void;
}

export function InvitePicker({ onClose }: InvitePickerProps): ReactNode {
  const { state, actions, candidates, engine } = useCall();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const inCall = useMemo(() => new Set(state.participants.map((p) => p.uid)), [state.participants]);
  const slots = inviteSlotsLeft(state) - picked.length;

  // 宿主的名单里多半含自己（Demo 实测就是）；自己不能邀请自己，直接不列。
  const shown = candidates.filter((c) =>
    c.uid !== engine.uid
    && (query.trim() === '' || c.uid.includes(query.trim()) || (c.name ?? '').includes(query.trim())));
  const typedUid = query.trim();
  const canTypeIn = candidates.length === 0 && typedUid !== '' && !inCall.has(typedUid) && !picked.includes(typedUid);

  const toggle = (uid: string): void => {
    setPicked((list) => (list.includes(uid) ? list.filter((u) => u !== uid) : slots > 0 ? [...list, uid] : list));
  };
  const invite = (): void => {
    if (picked.length === 0) return;
    void actions.inviteMore(picked);
    onClose();
  };

  return (
    <div style={styles.sheet} role="dialog" aria-label="添加成员" data-testid="invite-picker">
      <div style={styles.sheetHeader}>
        <b style={{ fontSize: 15 }}>添加成员</b>
        <span style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }} data-testid="invite-slots">
          还能加 {Math.max(slots, 0)} 人
        </span>
        <button type="button" style={{ ...styles.headerButton, marginLeft: 'auto' }} aria-label="关闭" onClick={onClose} data-testid="invite-close">
          <Icon name="xmark" size={16} />
        </button>
      </div>
      <input
        style={styles.sheetSearch}
        placeholder={candidates.length === 0 ? '输入对方 uid' : '搜索联系人'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && canTypeIn) { toggle(typedUid); setQuery(''); }
        }}
        data-testid="invite-search"
      />
      <div style={styles.sheetList}>
        {canTypeIn && (
          <button type="button" style={styles.sheetRow} onClick={() => { toggle(typedUid); setQuery(''); }} data-testid="invite-typed">
            <span style={{ ...styles.avatarDisc, width: 32, height: 32, fontSize: 12, background: avatarGradient(typedUid) }}>{avatarInitial(typedUid)}</span>
            <span>邀请 {typedUid}</span>
          </button>
        )}
        {picked.filter((uid) => !candidates.some((c) => c.uid === uid)).map((uid) => (
          <Row key={uid} uid={uid} name={uid} sub="" checked onClick={() => toggle(uid)} />
        ))}
        {shown.map((c) => {
          const already = inCall.has(c.uid);
          return (
            <Row
              key={c.uid}
              uid={c.uid}
              name={c.name ?? c.uid}
              sub={already ? '已在通话中' : c.isOnline === false ? '离线 · 仍可邀请' : c.isOnline === true ? '在线' : ''}
              checked={already || picked.includes(c.uid)}
              dim={already}
              {...(already ? {} : { onClick: () => toggle(c.uid) })}
            />
          );
        })}
      </div>
      <button
        type="button"
        style={{ ...styles.sheetGo, ...(picked.length === 0 ? styles.sheetGoDisabled : {}) }}
        onClick={invite}
        aria-disabled={picked.length === 0 || undefined}
        data-testid="invite-go"
      >
        {picked.length === 0 ? '邀请' : `邀请 ${picked.length} 人`}
      </button>
    </div>
  );
}

function Row(props: {
  readonly uid: string; readonly name: string; readonly sub: string; readonly checked: boolean;
  readonly dim?: boolean; readonly onClick?: () => void;
}): ReactNode {
  const { uid, name, sub, checked, dim = false, onClick } = props;
  return (
    <button type="button" style={{ ...styles.sheetRow, ...(dim ? styles.sheetRowDim : {}) }} onClick={onClick}
      aria-disabled={onClick === undefined || undefined} data-testid={`invite-row-${uid}`}>
      <span style={{ ...styles.avatarDisc, width: 32, height: 32, fontSize: 12, background: avatarGradient(uid) }}>{avatarInitial(name)}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block' }}>{name}</span>
        {sub !== '' && <span style={{ display: 'block', fontSize: 10.5, opacity: 0.7 }}>{sub}</span>}
      </span>
      <span style={{ ...styles.sheetCheck, ...(checked ? styles.sheetCheckOn : {}) }} aria-hidden="true">{checked ? '✓' : ''}</span>
    </button>
  );
}
