/**
 * Demo 的联系人名单。**这是宿主的东西**（CONVENTIONS §11：uikit 不内置联系人系统）：
 * Demo 用一份写死的名单，真实宿主传自己的联系人 / 群成员。
 *
 * 群呼选人与通话中的「添加成员」用**同一份**——两处各写一份的话，
 * 选人页里有的人在加人页里找不到，联调时会以为是服务端把人弄丢了。
 *
 * **名单要 9 个人。** 自己会被过滤掉，8 个名字只剩 7 个可选，于是最多凑出 8 格，
 * **永远看不到真正的九宫格**——而九宫格正是这一屏存在的理由。
 * （与 Android Demo 的 `ContactPicker.ALL` 是同一份名单，双端联调不用互相翻文档。）
 *
 * **2026-09-09 从 9 个加到 16 个**：9 个人剔掉自己剩 8 个，**恰好等于上限**，
 * 于是「选到第 9 个该被挡住」这条根本走不到——上限逻辑一直没被验过。
 * 加到 16 之后可选 15 个，能真的撞上限。九宫格该有的 9 个人依然凑得出。
 */
export const DEMO_CONTACTS = [
  { uid: 'alice' }, { uid: 'bob' }, { uid: 'carol' }, { uid: 'dave' }, { uid: 'erin' },
  { uid: 'frank' }, { uid: 'grace' }, { uid: 'heidi' }, { uid: 'ivan' },
  { uid: 'judy' }, { uid: 'mallory' }, { uid: 'niaj' }, { uid: 'olivia' },
  { uid: 'peggy' }, { uid: 'rupert' }, { uid: 'sybil' },
] as const;

/** 群呼最多选几个人：自己 + 8 = 9，正好 3×3（拍板 §11-1）。 */
export const GROUP_PICK_LIMIT = 8;

/**
 * 群呼名单里**必须把自己剔掉**。
 *
 * 带着自己发出去，服务端会以 `1004` 拒掉**整通**电话——报错说的是参数非法，
 * 而界面上看起来只是「呼叫失败」，很难想到是名单里多了个自己。
 */
export function calleesFor(uid: string, picked: readonly string[]): string[] {
  return picked.filter((id) => id !== uid).slice(0, GROUP_PICK_LIMIT);
}
