/**
 * sdkAlias.ts —— `IMRTC_SDK` 三档开关的公共逻辑，被 demo/vite.config.ts 与
 * demo-react/vite.config.ts 一起引用（避免两处各写一份、走样）。
 *
 * 三档：
 *   source（默认）—— 保持现状：包名别名直接指到 `packages/<pkg>/src/index.ts`，
 *                     改 SDK 源码不用先 build。
 *   local         —— 指到 `.sdk-release/local/node_modules/<pkg>`（包根目录，
 *                     由 `scripts/pack-sdk.sh local` 打 tgz 后原样解包而来）。
 *   public        —— 指到 `.sdk-release/public/node_modules/<pkg>`（由
 *                     `scripts/pack-sdk.sh public` 从 npm registry 装来）。
 *
 * local / public 两档都指向**包根目录**而不是 dist 里的某个文件，让 vite 按包
 * 自己的 `package.json#exports` 解析——这与真实宿主 `npm install` 之后看到的
 * 解析路径一致，能验证「发出去的包本身能用」。
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type SdkMode = 'source' | 'local' | 'public';

const SDK_MODES: readonly SdkMode[] = ['source', 'local', 'public'];

function readMode(): SdkMode {
  const raw = process.env['IMRTC_SDK'] ?? 'source';
  if (!(SDK_MODES as readonly string[]).includes(raw)) {
    throw new Error(`IMRTC_SDK 只能是 source / local / public，收到：'${raw}'`);
  }
  return raw as SdkMode;
}

export interface SdkAliasResult {
  /** 传给 vite 的 `resolve.alias`：包名 → 绝对路径。 */
  alias: Record<string, string>;
  /** 启动时打的一行日志，说明这次用的是哪个 SDK。 */
  logLine: string;
  mode: SdkMode;
}

function readInstalledVersion(pkgDir: string): string | undefined {
  try {
    const raw = readFileSync(path.join(pkgDir, 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'version' in parsed) {
      // 安全：刚用 `in` 收窄过，parsed 确有 'version' 键，只是值类型未知，下面再收窄。
      const version = (parsed as { version?: unknown }).version;
      return typeof version === 'string' ? version : undefined;
    }
  } catch {
    // 版本号只用来拼日志，读不到就跳过——不能因为这个把 vite 启动搞挂。
  }
  return undefined;
}

/**
 * @param repoRoot 仓库根目录绝对路径（`.sdk-release/` 与 `packages/` 都挂在它下面）。
 * @param srcEntries 包名 → 源码入口相对 repoRoot 的路径，只在 source 档用到。
 */
export function resolveSdkAlias(repoRoot: string, srcEntries: Record<string, string>): SdkAliasResult {
  const mode = readMode();
  const names = Object.keys(srcEntries);

  if (mode === 'source') {
    const alias: Record<string, string> = {};
    for (const name of names) {
      const entry = srcEntries[name];
      if (entry !== undefined) alias[name] = path.join(repoRoot, entry);
    }
    return { alias, logLine: 'Demo 用的 SDK：源码', mode };
  }

  const nmDir = path.join(repoRoot, '.sdk-release', mode, 'node_modules');
  const alias: Record<string, string> = {};
  const labels: string[] = [];
  for (const name of names) {
    const pkgDir = path.join(nmDir, name);
    if (!existsSync(pkgDir)) {
      throw new Error(
        `找不到 ${mode} 档的 SDK 包 ${name}（${pkgDir} 不存在）。` +
          `先跑 ./scripts/pack-sdk.sh ${mode} 再启动 Demo。`,
      );
    }
    alias[name] = pkgDir;
    const version = readInstalledVersion(pkgDir);
    labels.push(version ? `${name}@${version}` : name);
  }

  const label = mode === 'local' ? `本地包 ${nmDir}（${labels.join(', ')}）` : `公网包 ${labels.join(', ')}`;
  return { alias, logLine: `Demo 用的 SDK：${label}`, mode };
}
