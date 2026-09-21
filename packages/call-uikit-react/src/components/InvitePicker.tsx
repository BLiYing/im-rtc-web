import { logger } from 'im-rtc-call-engine';
import type { ReactNode, UIEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { avatarGradient, avatarInitial } from '../format/avatar.js';
import { buildInviteContext } from '../invite/inviteContext.js';
import type { InviteCandidate } from '../invite/types.js';
import { useCall } from '../useCall.js';
import { styles } from '../styles.js';
import { Icon } from './Icon.js';
import { t } from '../i18n/index.js';

/**
 * InvitePicker 是「添加成员」的选人半屏（交互稿 §05 G2，HOST_INTEGRATION_DESIGN §3.4）。
 *
 * **候选名单永远是宿主给的**（uikit 不内置联系人系统，CONVENTIONS §11）。取名单优先级：
 * 1. `presentInvitePicker` 整页接管——**这一层根本不会挂载 InvitePicker**，接管与否在打开
 *    「添加成员」的那一下就决定了（见 `ActiveCall.tsx` 的 `handleInvite`）；
 * 2. `inviteMemberProvider`：按 `(ctx, query, cursor)` 分页要一页，300ms 防抖、10 秒超时、
 *    失败带重试、滚到底翻页；
 * 3. 静态 `inviteCandidates`（旧接口）：一次性给全部，本地按输入过滤，不发请求；
 * 4. 都没有：空态「没有可邀请的成员」，`allowManualUidInput` 开着才出现 uid 输入框。
 *
 * 三态（加载中 / 失败带重试 / 超时）只属于 provider 路径——静态名单是同步数据，没有这些态。
 */
export interface InvitePickerProps {
  readonly onClose: () => void;
}

/** SEARCH_DEBOUNCE_MS：停止输入多久才发请求（HOST_INTEGRATION_DESIGN §3.4）。 */
const SEARCH_DEBOUNCE_MS = 300;
/** REQUEST_TIMEOUT_MS：provider 这么久没回调算失败——容信 iOS 现有实现踩过「永远转圈」的坑。 */
const REQUEST_TIMEOUT_MS = 10_000;

/** ListState 是 provider 路径的加载态；静态路径恒为 `'ready'`。 */
type ListState = 'loading' | 'ready' | 'error' | 'timeout';

export function InvitePicker({ onClose }: InvitePickerProps): ReactNode {
  const { state, actions, candidates: staticCandidates, invite, engine } = useCall();
  const ctx = useMemo(() => buildInviteContext(engine, state), [engine, state]);
  const usesProvider = invite.provider !== undefined;

  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [items, setItems] = useState<readonly InviteCandidate[]>(usesProvider ? [] : staticCandidates);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [listState, setListState] = useState<ListState>('ready');
  const [loadingMore, setLoadingMore] = useState(false);

  // 已在通话里 + 正在振铃的人（含自己）：这些人不可选，显示「已在通话中」。
  const inCall = useMemo(() => new Set(ctx.participantUids), [ctx.participantUids]);
  const slots = ctx.slotsLeft - picked.length;

  /*
    **新请求作废旧结果**：每次发请求先自增 `seq`，回来时比对——手指快的人连续敲几个字，
    先发出去的那个请求慢悠悠地最后才回来，绝不能把它的结果盖在新结果上面。
  */
  const seqRef = useRef(0);

  const load = useCallback(
    async (q: string, cur: string | undefined, append: boolean): Promise<void> => {
      const provider = invite.provider;
      if (provider === undefined) return;
      const seq = (seqRef.current += 1);
      if (append) setLoadingMore(true);
      else setListState('loading');

      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (seqRef.current === seq && !append) setListState('timeout');
      }, REQUEST_TIMEOUT_MS);

      try {
        const page = await provider(ctx, q, cur);
        clearTimeout(timer);
        // 这次结果已经被更新的请求作废，或者已经先一步判了超时：都不要了。
        if (seqRef.current !== seq || timedOut) return;
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor !== undefined && page.nextCursor !== '' ? page.nextCursor : undefined);
        setListState('ready');
      } catch (err) {
        clearTimeout(timer);
        if (seqRef.current !== seq || timedOut) return;
        logger.warn('inviteMemberProvider 失败', { err: String(err), query: q, append });
        if (!append) setListState('error');
      } finally {
        if (append) setLoadingMore(false);
      }
    },
    [invite.provider, ctx],
  );
  // 回调型依赖走 ref（CONVENTIONS §5）：ctx 每次通话状态变化都会换引用，
  // 不这样搜索框的防抖计时器会被通话中途的任何一次心跳事件打断重置。
  const loadRef = useRef(load);
  loadRef.current = load;

  // 首次挂载：不防抖，立刻要一页默认列表；query 变化（用户在打字）才走 300ms 防抖。
  const mounted = useRef(false);
  useEffect(() => {
    if (!usesProvider) return;
    const first = !mounted.current;
    mounted.current = true;
    const timer = setTimeout(() => {
      setCursor(undefined);
      void loadRef.current(query, undefined, false);
    }, first ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `load` 特意不进依赖数组：它随 ctx（通话状态）变化换引用，进了依赖会让通话中途的
    // 任何一次心跳事件打断正在等的防抖计时器；真正调用走的是上面那个 loadRef（CONVENTIONS §5）。
  }, [query, usesProvider]);

  // 静态路径：本地过滤，不发请求，也没有加载态。
  useEffect(() => {
    if (usesProvider) return;
    setItems(staticCandidates);
  }, [usesProvider, staticCandidates]);

  const retry = (): void => {
    void loadRef.current(query, undefined, false);
  };

  /** onScroll 滚到底且还有下一页时取下一页（HOST_INTEGRATION_DESIGN §3.4）。 */
  const onScroll = (e: UIEvent<HTMLDivElement>): void => {
    if (!usesProvider || cursor === undefined || loadingMore || listState !== 'ready') return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 48) {
      void loadRef.current(query, cursor, true);
    }
  };

  // 宿主给什么就列什么（含自己与发起人）：在通话里的人置灰「已在通话中」，不隐藏。
  const shown = items.filter((c) =>
    usesProvider // provider 已经按 query 在服务端过滤过了，本地不用再筛一遍。
      || query.trim() === '' || c.uid.includes(query.trim()) || (c.name ?? '').includes(query.trim()));
  const typedUid = query.trim();
  const canTypeIn = invite.allowManualUidInput && items.length === 0 && listState === 'ready'
    && typedUid !== '' && !inCall.has(typedUid) && !picked.includes(typedUid);

  const toggle = (uid: string, selectable: boolean): void => {
    if (!selectable) return;
    setPicked((list) => (list.includes(uid) ? list.filter((u) => u !== uid) : slots > 0 ? [...list, uid] : list));
  };
  const invitePicked = (): void => {
    if (picked.length === 0) return;
    void actions.inviteMore(picked);
    onClose();
  };

  return (
    <div style={styles.sheet} role="dialog" aria-label={t('invite.title')} data-testid="invite-picker">
      <div style={styles.sheetHeader}>
        <b style={{ fontSize: 15 }}>{t('invite.title')}</b>
        <span style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }} data-testid="invite-slots">
          {t('invite.slotsLeft', { n: Math.max(slots, 0) })}
        </span>
        <button type="button" style={{ ...styles.headerButton, marginLeft: 'auto' }} aria-label={t('invite.close')} onClick={onClose} data-testid="invite-close">
          <Icon name="xmark" size={16} />
        </button>
      </div>
      <label style={styles.sheetSearch}>
        <Icon name="magnifyingglass" size={15} />
        <input
          style={styles.sheetSearchInput}
          placeholder={usesProvider || items.length > 0 ? t('invite.search') : t('invite.typeUid')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canTypeIn) { toggle(typedUid, true); setQuery(''); }
          }}
          data-testid="invite-search"
        />
      </label>
      <div style={styles.sheetList} onScroll={onScroll} data-testid="invite-list">
        {listState === 'loading' && <StateBlock text={t('invite.loading')} />}
        {listState === 'error' && <StateBlock text={t('invite.loadFailed')} onRetry={retry} />}
        {listState === 'timeout' && <StateBlock text={t('invite.timeout')} onRetry={retry} />}
        {listState === 'ready' && (
          <>
            {canTypeIn && (
              <button type="button" style={styles.sheetRow} onClick={() => { toggle(typedUid, true); setQuery(''); }} data-testid="invite-typed">
                <span style={{ ...styles.avatarDisc, width: 32, height: 32, fontSize: 12, background: avatarGradient(typedUid) }}>{avatarInitial(typedUid)}</span>
                <span>{t('invite.uid', { uid: typedUid })}</span>
              </button>
            )}
            {picked.filter((uid) => !items.some((c) => c.uid === uid)).map((uid) => (
              <Row key={uid} uid={uid} name={uid} sub="" checked selectable onClick={() => toggle(uid, true)} />
            ))}
            {shown.map((c) => {
              const already = inCall.has(c.uid);
              const selectable = !already && c.selectable !== false;
              const sub = already ? t('invite.already')
                : c.selectable === false ? (c.unselectableReason ?? '')
                  : c.subtitle ?? (c.isOnline === false ? t('invite.offlineOk') : c.isOnline === true ? t('invite.online') : '');
              return (
                <Row
                  key={c.uid}
                  uid={c.uid}
                  name={c.name ?? c.uid}
                  {...(c.avatarUrl === undefined ? {} : { avatarUrl: c.avatarUrl })}
                  sub={sub}
                  checked={already || picked.includes(c.uid)}
                  dim={!selectable}
                  selectable={selectable}
                  onClick={() => toggle(c.uid, selectable)}
                />
              );
            })}
            {shown.length === 0 && !canTypeIn && picked.length === 0 && <EmptyState allowsTyping={invite.allowManualUidInput} />}
            {loadingMore && <div style={styles.sheetFooter}>{t('invite.loading')}</div>}
          </>
        )}
      </div>
      <button
        type="button"
        style={{ ...styles.sheetGo, ...(picked.length === 0 ? styles.sheetGoDisabled : {}) }}
        onClick={invitePicked}
        aria-disabled={picked.length === 0 || undefined}
        data-testid="invite-go"
      >
        {picked.length === 0 ? t('invite.action') : t('invite.actionN', { n: picked.length })}
      </button>
    </div>
  );
}

/** StateBlock 是加载中 / 失败 / 超时三态的共用展示（HOST_INTEGRATION_DESIGN §3.4）。 */
function StateBlock({ text, onRetry }: { readonly text: string; readonly onRetry?: () => void }): ReactNode {
  return (
    <div style={styles.sheetState} data-testid="invite-state">
      <span>{text}</span>
      {onRetry !== undefined && (
        <button type="button" style={styles.sheetRetry} onClick={onRetry} data-testid="invite-retry">{t('invite.retry')}</button>
      )}
    </div>
  );
}

function EmptyState({ allowsTyping }: { readonly allowsTyping: boolean }): ReactNode {
  return (
    <div style={styles.sheetState} data-testid="invite-empty">
      <span>{t('invite.empty')}</span>
      {allowsTyping && <span style={{ fontSize: 11.5, opacity: 0.7 }}>{t('invite.emptyTyping')}</span>}
    </div>
  );
}

function Row(props: {
  readonly uid: string; readonly name: string; readonly sub: string; readonly checked: boolean;
  readonly avatarUrl?: string; readonly dim?: boolean; readonly selectable?: boolean; readonly onClick?: () => void;
}): ReactNode {
  const { uid, name, sub, checked, avatarUrl, dim = false, selectable = true, onClick } = props;
  return (
    <button type="button" style={{ ...styles.sheetRow, ...(dim ? styles.sheetRowDim : {}) }}
      onClick={selectable ? onClick : undefined}
      aria-disabled={!selectable || undefined} data-testid={`invite-row-${uid}`}>
      {avatarUrl !== undefined && avatarUrl !== '' ? (
        <img src={avatarUrl} alt="" style={{ ...styles.avatarDisc, width: 32, height: 32, objectFit: 'cover' }} />
      ) : (
        <span style={{ ...styles.avatarDisc, width: 32, height: 32, fontSize: 12, background: avatarGradient(uid) }}>{avatarInitial(name)}</span>
      )}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block' }}>{name}</span>
        {sub !== '' && <span style={{ display: 'block', fontSize: 10.5, opacity: 0.7 }}>{sub}</span>}
      </span>
      <span style={{ ...styles.sheetCheck, ...(checked ? styles.sheetCheckOn : {}) }} aria-hidden="true">{checked ? '✓' : ''}</span>
    </button>
  );
}
