import type { MediaType } from 'im-rtc-call-engine';

/**
 * 「按通话向宿主要候选人」的类型（HOST_INTEGRATION_DESIGN §3.4，Web 命名对应 §3.4 表格）。
 *
 * uikit 不内置联系人系统（CONVENTIONS §11）：候选名单永远是宿主给的，
 * 这几个类型就是 uikit 与宿主之间唯一的接口。
 */

/**
 * InviteContext 是发起一次「要候选人」请求时给宿主的全部背景信息。
 *
 * `participantUids` **含自己**：宿主的 provider 常常要按「此刻已经占了几个位子」
 * 做本地过滤（比如把已经在通话里的人从「可邀请」列表里划掉）。
 */
export interface InviteContext {
  readonly callId: string;
  /** 宿主自己的群号；这通电话不是从群里发起的（临时拉人）时是空串。 */
  readonly chatGroupId: string;
  /** 原样透传的 user_data，uikit 不解析；provider 需要的话自己解析。 */
  readonly userData: string;
  /** 发起人 uid；`callId` 是 `joinCall()` 进来的时才可能是空串（服务端还没回 call.connected）。 */
  readonly callerUid: string;
  readonly mediaType: MediaType;
  /** 此刻在通话里 + 正在振铃的人，**含自己**。 */
  readonly participantUids: readonly string[];
  /** 还能加几个人 = 9 − participantUids.length。 */
  readonly slotsLeft: number;
}

/** InviteCandidate 是宿主给的「可以邀请的人」。 */
export interface InviteCandidate {
  readonly uid: string;
  readonly name?: string;
  readonly avatarUrl?: string;
  readonly subtitle?: string;
  /** 默认 true。false = 置灰不可选（配 `unselectableReason` 说明原因）。 */
  readonly selectable?: boolean;
  readonly unselectableReason?: string;
  /**
   * @deprecated 用 `subtitle` 自己拼文案。仅为兼容旧的静态 `inviteCandidates` 保留，
   * 新代码（provider / presentInvitePicker）不必给这个字段。
   */
  readonly isOnline?: boolean;
}

/** InvitePage 是 provider 一页的返回。`nextCursor` 缺席或为空串 = 没有下一页。 */
export interface InvitePage {
  readonly items: readonly InviteCandidate[];
  readonly nextCursor?: string;
}

/**
 * InviteMemberProvider 按 `(ctx, query, cursor)` 要一页候选人。
 * `query` 为空串 = 默认列表；小群一次返回全部，超级群走宿主自己的服务端搜索。
 */
export type InviteMemberProvider = (
  ctx: InviteContext,
  query: string,
  cursor?: string,
) => Promise<InvitePage>;

/**
 * PresentInvitePicker 让宿主**整页接管**「添加成员」——返回即表示宿主自己弹出了选人页。
 * 结果是选中的 uid 数组（空数组 = 用户取消）；返回 `null` 表示这次不接管，
 * 退回 `inviteMemberProvider` / 静态 `inviteCandidates`。
 */
export type PresentInvitePicker = (ctx: InviteContext) => Promise<string[] | null>;

/** CanInvite 是宿主的权限规则（例：群禁言时仅管理员可加人）。默认 true。 */
export type CanInvite = (ctx: InviteContext) => boolean;
