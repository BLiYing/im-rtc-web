import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useReducer } from 'react';

/**
 * 宿主身份解析：把 uid 翻成**这台设备上该显示的**名字与头像。
 *
 * # 为什么这件事必须交给宿主
 *
 * Kit 只认识 uid。而宿主的显示名往往是一条链——备注 > 群昵称 > 昵称——其中
 * **备注是查看者私有的**：同一个 uid 在五个人的九宫格里可能要显示五个不同的名字。
 * 服务端只有一份房间状态、一条广播通道，它在物理上就发不出五个不同的值；
 * 硬塞进协议的结果是「我给某人起的私房备注被广播给了全房间」。
 *
 * 所以这条链整个留在宿主，Kit 只开一个口子问它。
 * 详见 im-rtc-server/docs/design/HOST_PROFILE_DISPLAY_DESIGN.md §1、§3。
 *
 * # 为什么是「同步读 + 异步失效通知」
 *
 * 宿主的解析器（IMProgram 的 IMUserProfileCache / im-web 的 useUserProfiles）都是
 * 「命中就返回，没命中返回空并在后台攒一批去拉」。Kit 在渲染热路径上调用它，
 * 做成 `async` 会让每个格子挂一个 Promise，与那层批量合并窗口打架。
 * 所以是 `resolve()` 同步读 + 可选的 `subscribe()` 在解析回来后通知重画。
 *
 * # 没有 provider 时会怎样
 *
 * 退化成显示 uid（`fallbackLabel` 可改）。作为通用 SDK 这是合理的默认——
 * 「内部 ID 不该上屏」是某个宿主的产品纪律，不是本产品的。
 */

/** ParticipantProfile 是宿主给出的显示信息。两个字段都可空，缺哪个 Kit 兜哪个。 */
export interface ParticipantProfile {
  /** 该显示的名字。空 / 缺省 → 用兜底（默认 uid）。 */
  readonly name?: string;
  /**
   * 头像图地址。空 / 缺省 → 退化成首字母色块。
   *
   * **必须是这台设备能直接加载的完整地址**：Kit 不知道宿主的 base host、
   * 不知道要不要带鉴权头，也不会替你拼。IMServer 那种相对路径
   * （`/avatars/<sha256>.jpg`）请宿主自己补全了再给。
   */
  readonly avatarUrl?: string;
}

/** ProfileResolver 是宿主要实现的东西。 */
export interface ProfileResolver {
  /**
   * 同步取一个 uid 的显示信息。
   *
   * **返回 undefined 是正常的**（还没解析到），Kit 会先画兜底；
   * 解析回来后通过 {@link ProfileResolver.subscribe} 通知重画即可。
   */
  resolve(uid: string): ParticipantProfile | undefined;
  /**
   * 订阅「这批 uid 刚解析出来」。返回退订函数。
   *
   * 可选：宿主的解析器如果是纯同步的（比如一张已经在手的成员表），不实现也行。
   */
  subscribe?(onResolved: (uids: readonly string[]) => void): () => void;
}

const ProfileContext = createContext<ProfileResolver | null>(null);

/** ProfileProviderProps 是 {@link ProfileProvider} 的参数。 */
export interface ProfileProviderProps {
  readonly resolver: ProfileResolver;
  readonly children: ReactNode;
}

/**
 * ProfileProvider 把宿主的解析器交给 Kit。
 *
 * 套在 `CallProvider` 外面或里面都行，Kit 只在渲染格子时读它。
 */
export function ProfileProvider({ resolver, children }: ProfileProviderProps): ReactNode {
  return <ProfileContext.Provider value={resolver}>{children}</ProfileContext.Provider>;
}

/**
 * useParticipantProfile 取某个 uid 的显示信息，并在宿主解析回来后自动重画。
 *
 * 只对**自己这个 uid** 的解析通知作出反应：九宫格里九个格子各自订阅，
 * 一个人解析回来不该让另外八个也重渲染。
 */
export function useParticipantProfile(uid: string): ParticipantProfile | undefined {
  const resolver = useContext(ProfileContext);
  const [, redraw] = useReducer((n: number): number => n + 1, 0);

  useEffect(() => {
    if (resolver?.subscribe === undefined || uid === '') return undefined;
    return resolver.subscribe((uids) => {
      if (uids.includes(uid)) redraw();
    });
  }, [resolver, uid]);

  if (resolver === null || uid === '') return undefined;
  return resolver.resolve(uid);
}

/**
 * useDisplayName 是格子上那行字。
 *
 * 兜底链：宿主给的名字 → `fallback`（调用方通常传 uid）。
 * **空白名字不算数**——宿主的解析器返回 `{name: ''}` 是「查到了但没名字」，
 * 那时候显示一个空字符串比显示 uid 更糟（格子上什么都没有）。
 */
export function useDisplayName(uid: string, fallback: string): string {
  const profile = useParticipantProfile(uid);
  const name = profile?.name?.trim() ?? '';
  return name === '' ? fallback : name;
}
