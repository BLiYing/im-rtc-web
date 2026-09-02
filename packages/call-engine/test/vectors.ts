import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 一致性向量的定位：**只读 `im-rtc-server/docs/conformance/` 那一份**。
 *
 * 禁止把向量拷进本仓（conformance/README.md 明说）——一拷贝就会漏同步，
 * 而向量存在的全部意义就是防止四端漂移。
 *
 * 找不到时**抛错而不是跳过**：一个被静默跳过的一致性测试比没有测试更糟，
 * 它会让人以为四端是对齐的。
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** SIBLING_HINT 是找不到向量时给出的两条出路。 */
const SIBLING_HINT = [
  '找不到一致性向量。两条出路：',
  '  1) 把 im-rtc-server 克隆到本仓同级目录（默认布局）；',
  '  2) 设 RTC_CONFORMANCE_DIR 指向 im-rtc-server/docs/conformance。',
  '向量是四仓共用的单一真相源，**不要拷贝一份到本仓**。',
].join('\n');

function resolveDir(): string {
  const fromEnv = process.env['RTC_CONFORMANCE_DIR'];
  if (fromEnv !== undefined && fromEnv !== '' && existsSync(fromEnv)) return fromEnv;

  // packages/call-engine/test → 仓库根 → 同级的 im-rtc-server
  const sibling = resolve(HERE, '../../..', '../im-rtc-server/docs/conformance');
  if (existsSync(sibling)) return sibling;

  throw new Error(SIBLING_HINT);
}

/** loadVector 读取并解析一份向量文件。 */
export function loadVector<T>(name: string): T {
  const path = join(resolveDir(), name);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** ErrorCodeEntry 对应 error_codes.json 里 wire / local 的一条。 */
export interface ErrorCodeEntry {
  code: number;
  name: string;
  msg: string;
  retryable: boolean;
  group: string;
}

/** ErrorCodeVector 是 error_codes.json 的形状。 */
export interface ErrorCodeVector {
  version: number;
  kind: string;
  wire: ErrorCodeEntry[];
  local: ErrorCodeEntry[];
  close_codes: { code: number; meaning: string; reconnect: boolean }[];
}

/** ReasonVector 是 reasons.json 的形状。 */
export interface ReasonVector {
  version: number;
  kind: string;
  unknown_fallback: string;
  reasons: { value: string; webhook: string[] }[];
  group_dominant_priority: string[];
  group_dominant_cases: { name: string; member_outcomes: string[]; expect: string }[];
  duration_cases: {
    name: string;
    connected_at_ms: number;
    ended_at_ms: number;
    expect_duration_sec: number;
  }[];
}

/** EnvelopeCase 是 envelope.json 的一条解析用例。 */
export interface EnvelopeCase {
  name: string;
  input: string;
  expect: {
    ok: boolean;
    type?: string;
    req_id?: string;
    ts?: number;
    data?: Record<string, unknown>;
    error?: string;
    client_action?: string;
    server_action?: string;
  };
}

/** DefaultCase 是 envelope.json 的一条默认值填充用例。 */
export interface DefaultCase {
  name: string;
  type: string;
  input_data: string;
  expect_data: Record<string, unknown>;
}

/** EnvelopeVector 是 envelope.json 的形状。 */
export interface EnvelopeVector {
  version: number;
  kind: string;
  cases: EnvelopeCase[];
  default_cases: DefaultCase[];
}
