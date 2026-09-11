#!/usr/bin/env python3
"""静态校验：Web 端 SDK 统一到 1.0.0 + demo-react 设置卡片（2026-09-11，分支 feat/settings-sdk-1.0.0）。

要成立的：
  ① 两个包的 package.json 与 package-lock.json 都是 1.0.0，uikit 对 engine 的依赖也是 1.0.0；
     lockfile 相对 main 只动了这三行（没有无关依赖漂移）；
  ② engine 的 sys.hello 默认 sdk 由 SDK_VERSION 拼出 web/1.0.0，常量从 index.ts 导出；
  ③ 源码与清单里没有残留的 0.0.1 版本号（127.0.0.1 这种 IP 不算，.claude/launch.json 是配置 schema 版本，不算）；
  ④ demo-react 的设置卡片接上了 bannerFirst / setLogLevel / WebRTCAdapter 档位，放在 CallHistory 与 EngineLog 之间；
  ⑤ 设置持久化走 im-rtc-demo.settings.* 且每次读写都包了 try/catch；test.sh 跑 demo-react 的 vitest。

跑法：python3 temp_verify.py          （在 im-rtc-web 或它的 worktree 下）
     python3 temp_verify.py --fast   不跑真实的 vitest
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
log: Final = logging.getLogger("verify")

ROOT: Final[Path] = Path(__file__).resolve().parent
VERSION: Final[str] = "1.0.0"
ENGINE: Final[Path] = ROOT / "packages" / "call-engine"
UIKIT: Final[Path] = ROOT / "packages" / "call-uikit-react"
DEMO: Final[Path] = ROOT / "demo-react" / "src"
# 前后都不能挨着数字或点：127.0.0.1 里的 0.0.1 前面是点，不算。
OLD_VERSION: Final[re.Pattern[str]] = re.compile(r"(?<![\d.])0\.0\.1(?![\d.])")
SCAN_DIRS: Final[tuple[str, ...]] = ("packages", "demo", "demo-react", "scripts")
SCAN_SUFFIXES: Final[frozenset[str]] = frozenset({".ts", ".tsx", ".json", ".sh", ".html"})


@dataclass
class Report:
    """跑过的断言。失败只记账不中断，最后一次性报账。"""

    passed: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        if ok:
            log.info("✓ %s", name)
            self.passed.append(name)
        else:
            log.error("✗ %s%s", name, f" —— {detail}" if detail else "")
            self.failed.append(f"{name}{f' —— {detail}' if detail else ''}")
        return ok


def read_text(path: Path) -> str:
    """读文件；读不到返回空串并记一条错误，让后续断言照常失败而不是整个脚本崩掉。"""
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        log.error("读不到 %s：%s", path.relative_to(ROOT), exc)
        return ""


def read_json(path: Path) -> dict[str, object]:
    """读 JSON；坏了返回空字典。"""
    raw = read_text(path)
    try:
        value = json.loads(raw) if raw else {}
    except json.JSONDecodeError as exc:
        log.error("%s 不是合法 JSON：%s", path.relative_to(ROOT), exc)
        return {}
    return value if isinstance(value, dict) else {}


def dig(obj: object, *keys: str) -> object:
    """按键一路往下取，中途不是字典就返回 None。"""
    for key in keys:
        if not isinstance(obj, dict):
            return None
        obj = obj.get(key)
    return obj


def check_manifests(rep: Report) -> None:
    engine = read_json(ENGINE / "package.json")
    uikit = read_json(UIKIT / "package.json")
    lock = read_json(ROOT / "package-lock.json")
    rep.check("engine package.json = 1.0.0", engine.get("version") == VERSION, str(engine.get("version")))
    rep.check("uikit package.json = 1.0.0", uikit.get("version") == VERSION, str(uikit.get("version")))
    dep = dig(uikit, "dependencies", "@im-rtc/call-engine")
    rep.check("uikit 依赖 engine 1.0.0", dep == VERSION, str(dep))
    pkgs = dig(lock, "packages")
    rep.check("lockfile engine = 1.0.0", dig(pkgs, "packages/call-engine", "version") == VERSION)
    rep.check("lockfile uikit = 1.0.0", dig(pkgs, "packages/call-uikit-react", "version") == VERSION)
    lock_dep = dig(pkgs, "packages/call-uikit-react", "dependencies", "@im-rtc/call-engine")
    rep.check("lockfile uikit 依赖 engine 1.0.0", lock_dep == VERSION, str(lock_dep))


def git(*args: str) -> str | None:
    """跑一条 git；失败返回 None，调用方决定跳过还是记失败。"""
    try:
        out = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=20)
    except (subprocess.TimeoutExpired, OSError) as exc:
        log.warning("git %s 起不来：%s", " ".join(args), exc)
        return None
    if out.returncode != 0:
        log.warning("git %s 失败：%s", " ".join(args), out.stderr.strip())
        return None
    return out.stdout


def check_lock_drift(rep: Report) -> None:
    """lockfile 相对 main 的分叉点只许改三行，且改的都是版本号。"""
    base = git("merge-base", "HEAD", "main")
    if base is None:
        log.warning("找不到与 main 的分叉点，跳过 lockfile 漂移检查")
        return
    diff = git("diff", base.strip(), "--", "package-lock.json")
    if diff is None:
        rep.check("lockfile 无无关漂移", False, "git diff 失败")
        return
    changed = [ln for ln in diff.splitlines() if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
    removed = [ln for ln in changed if ln.startswith("-")]
    added = [ln for ln in changed if ln.startswith("+")]
    is_versions_only = all("0.0.1" in ln for ln in removed) and all(VERSION in ln for ln in added)
    rep.check("lockfile 只动 3 处版本号", len(removed) == 3 and len(added) == 3 and is_versions_only,
              f"-{len(removed)} +{len(added)}")


def check_sdk_constant(rep: Report) -> None:
    version_ts = read_text(ENGINE / "src" / "version.ts")
    connection = read_text(ENGINE / "src" / "signaling" / "connection.ts")
    index = read_text(ENGINE / "src" / "index.ts")
    rep.check("SDK_VERSION = '1.0.0'", f"export const SDK_VERSION = '{VERSION}';" in version_ts)
    rep.check("index.ts 导出 SDK_VERSION", "export { SDK_VERSION } from './version.js';" in index)
    rep.check("connection.ts 默认 sdk 由常量拼出", "const DEFAULT_SDK = `web/${SDK_VERSION}`;" in connection)
    rep.check("connection.ts 两处都用 DEFAULT_SDK", connection.count("?? DEFAULT_SDK") == 2)
    rep.check("connection.ts 不再写死 web/x.y.z", re.search(r"'web/\d", connection) is None)


def iter_scan_files() -> list[Path]:
    """要查残留版本号的文件：几个源码目录 + 根清单。跳过 node_modules / dist。"""
    files = [ROOT / "package.json", ROOT / "package-lock.json"]
    for name in SCAN_DIRS:
        base = ROOT / name
        if not base.is_dir():
            continue
        for path in base.rglob("*"):
            parts = set(path.relative_to(ROOT).parts)
            if path.is_file() and path.suffix in SCAN_SUFFIXES and not parts & {"node_modules", "dist"}:
                files.append(path)
    return files


def check_no_old_version(rep: Report) -> None:
    hits: list[str] = []
    for path in iter_scan_files():
        for number, line in enumerate(read_text(path).splitlines(), start=1):
            if OLD_VERSION.search(line):
                hits.append(f"{path.relative_to(ROOT)}:{number}")
    rep.check("无残留 0.0.1 版本号", not hits, ", ".join(hits[:5]))


def check_demo_wiring(rep: Report) -> None:
    app = read_text(DEMO / "App.tsx")
    card = read_text(DEMO / "Settings.tsx")
    hook = read_text(DEMO / "useDemoSettings.ts")
    rep.check("App 不再写死 setLogLevel('debug')", "setLogLevel('debug')" not in app)
    rep.check("App 启动按存储设日志档位", "setLogLevel(loadSettings(browserStore()).logLevel)" in app)
    rep.check("CallProvider 接 bannerFirst", "bannerFirst={settings.bannerFirst}" in app)
    rep.check("登录时按档位建 WebRTCAdapter", "new WebRTCAdapter(source, VideoProfiles[videoProfile])" in app)
    rep.check("档位读 ref 不读 state", "settingsRef.current.videoProfile" in app)
    order = [app.find(tag) for tag in ("<CallHistory", "<Settings", "<EngineLog")]
    rep.check("卡片在 CallHistory 之后、EngineLog 之前", -1 not in order and order == sorted(order), str(order))
    rep.check("卡片开关：横幅", "onChange('bannerFirst'" in card)
    rep.check("卡片开关：详细日志 debug/info", "onChange('logLevel', e.target.checked ? 'debug' : 'info')" in card)
    rep.check("卡片档位用 engine 的 VideoProfiles", "VideoProfiles[key].name" in card and "VIDEO_PROFILE_KEYS.map" in card)
    rep.check("卡片写明重登才生效", "重登" in card)
    rep.check("关于：SDK 取常量", "im-rtc-web {SDK_VERSION}" in card)
    rep.check("关于：WebRTC 跟随浏览器", "浏览器内置，版本跟随浏览器" in card and "describeBrowser(" in card)
    rep.check("关于：设备 ID", "{deviceId}" in card)
    rep.check("改日志档位立即 setLogLevel", "if (key === 'logLevel') setLogLevel(next.logLevel);" in hook)


def check_store(rep: Report) -> None:
    store = read_text(DEMO / "settingsStore.ts")
    rep.check("存储键前缀 im-rtc-demo.settings.", "SETTINGS_KEY_PREFIX = 'im-rtc-demo.settings.'" in store)
    rep.check("默认值：横幅 / debug / 720p",
              all(s in store for s in ("bannerFirst: true,", "logLevel: 'debug',", "videoProfile: 'p720',")))
    rep.check("三处存储访问都有 try/catch（取 localStorage、读、写）", store.count("try {") >= 3 and store.count("} catch {") >= 3)
    test_sh = read_text(ROOT / "scripts" / "test.sh")
    rep.check("test.sh 跑 demo-react vitest", "npx vitest run --root demo-react" in test_sh)


def check_vitest(rep: Report) -> None:
    """真跑一次 demo-react 与 engine 的 vitest。"""
    for root in ("demo-react", "packages/call-engine"):
        try:
            out = subprocess.run(["npx", "vitest", "run", "--root", root],
                                 cwd=ROOT, capture_output=True, text=True, timeout=600)
        except (subprocess.TimeoutExpired, OSError) as exc:
            rep.check(f"vitest {root}", False, str(exc))
            continue
        tail = "\n".join((out.stdout + out.stderr).strip().splitlines()[-4:])
        rep.check(f"vitest {root}", out.returncode == 0, tail)


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 Web SDK 1.0.0 与 demo-react 设置卡片")
    parser.add_argument("--fast", action="store_true", help="不跑真实的 vitest")
    args = parser.parse_args()

    rep = Report()
    check_manifests(rep)
    check_lock_drift(rep)
    check_sdk_constant(rep)
    check_no_old_version(rep)
    check_demo_wiring(rep)
    check_store(rep)
    if not args.fast:
        check_vitest(rep)

    log.info("—— %d 过 / %d 挂 ——", len(rep.passed), len(rep.failed))
    for name in rep.failed:
        log.error("  ✗ %s", name)
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
