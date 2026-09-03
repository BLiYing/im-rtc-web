/**
 * 状态机的公共类型。
 *
 * 状态机是**纯函数 reducer**：`(state, input) => { state, send, emit }`。
 * 不碰网络、不碰 DOM、不碰计时器——所以它能被
 * `im-rtc-server/docs/conformance/*_fsm.json` 的向量逐条驱动，
 * 与另外三端跑**同一份**用例。
 */

/** OutgoingFrame 是状态机要求发出去的一帧（线路形状，snake_case）。 */
export interface OutgoingFrame {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * EmittedEvent 是状态机要求抛给宿主的一个回调。
 *
 * `args` 的键用**协议的 snake_case 名**，与一致性向量一致；
 * 由 engine 门面转成各端惯用形式再交给宿主。
 */
export interface EmittedEvent {
  readonly cb: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/** MachineOutput 是一次状态转移的产物。 */
export interface MachineOutput<S> {
  readonly state: S;
  readonly send: readonly OutgoingFrame[];
  readonly emit: readonly EmittedEvent[];
}

/** MachineInput 是驱动状态机的三种输入之一（与向量的 act / recv / internal 一一对应）。 */
export type MachineInput =
  /** 宿主调用了 engine 的公开方法。 */
  | { readonly kind: 'act'; readonly op: string; readonly args?: Readonly<Record<string, unknown>> }
  /** 收到一条下行帧。 */
  | {
      readonly kind: 'recv';
      readonly type: string;
      readonly data: Readonly<Record<string, unknown>>;
    }
  /** engine 内部事件，既不来自信令也不来自宿主（如媒体就绪）。 */
  | { readonly kind: 'internal'; readonly name: string };

/** str 从线路数据里安全取一个字符串字段。 */
export function str(data: Readonly<Record<string, unknown>>, key: string): string {
  const value = data[key];
  return typeof value === 'string' ? value : '';
}

/** num 从线路数据里安全取一个整数字段。 */
export function num(data: Readonly<Record<string, unknown>>, key: string): number {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** bool 从线路数据里安全取一个布尔字段。 */
export function bool(data: Readonly<Record<string, unknown>>, key: string): boolean {
  return data[key] === true;
}

/** strArray 从线路数据里安全取一个字符串数组字段。 */
export function strArray(data: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
