#!/usr/bin/env python3
"""校验 packages/call-engine/test/vectors.ts 的一致性向量定位（2026-09-10 code-review 修复）。

要成立的：
  ① 主检出、`.claude/worktrees/<分支>` 两种布局都找得到同级的 im-rtc-server；
  ② 同级没有时**抛错**——哪怕更上层碰巧有一份 im-rtc-server（旧版会静默拿去用）；
  ③ RTC_CONFORMANCE_DIR 设了就只认它：存在就用、不存在就抛；空串等于没设。

做法：把 vectors.ts 拷进临时目录搭出的各种布局，用 node（≥23.6 自带去类型）直接 import 调用。
同一组用例再对修复前的版本（830f2f2）跑一遍，确认用例真的抓得住那个 bug。

跑法：python3 temp_verify.py          （在 im-rtc-web 或它的 worktree 下）
     python3 temp_verify.py --fast   不跑真实的 vitest
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
log: Final = logging.getLogger("verify")

ROOT: Final[Path] = Path(__file__).resolve().parent
SRC: Final[Path] = ROOT / "packages" / "call-engine" / "test" / "vectors.ts"
OLD_REV: Final[str] = "830f2f2"
CONF: Final[str] = "im-rtc-server/docs/conformance"
TEST_DIR: Final[str] = "packages/call-engine/test"

# 结果打成一行 JSON。import 本身失败（语法错、node 太老）不会走到 catch，由调用方按驱动故障处理。
PROBE_JS: Final[str] = (
    "const { loadVector } = await import(process.env.VECTORS_URL);"
    "try { console.log(JSON.stringify({ ok: true, from: loadVector('probe.json').from })); }"
    "catch (e) { console.log(JSON.stringify({ ok: false, error: String(e.message) })); }"
)


@dataclass(frozen=True)
class Case:
    """一种目录布局。路径都相对临时目录；want=None 表示期望抛错。"""

    name: str
    repo: str
    vector_dirs: tuple[str, ...]
    env: str | None = None  # 以 "@" 开头 = 相对临时目录
    want: str | None = None
    want_error: str = ""
    old_fails: bool = False  # 修复前的版本应当在这条上挂


CASES: Final[tuple[Case, ...]] = (
    Case("主检出 + 同级", "ws/im-rtc-web", (f"ws/{CONF}",), want=f"ws/{CONF}"),
    Case("worktree + 同级", "ws/im-rtc-web/.claude/worktrees/b", (f"ws/{CONF}",), want=f"ws/{CONF}"),
    Case("主检出、同级缺、上层有旧克隆 → 抛错", "ws/im-rtc-web", (CONF,),
         want_error="im-rtc-server", old_fails=True),
    Case("worktree、同级缺、worktrees 目录与上层各有一份 → 抛错",
         "ws/im-rtc-web/.claude/worktrees/b", (CONF, f"ws/im-rtc-web/.claude/worktrees/{CONF}"),
         want_error="im-rtc-server", old_fails=True),
    Case("父目录叫 worktrees 但不在 .claude 下 → 按主检出算", "ws/worktrees/im-rtc-web",
         (f"ws/worktrees/{CONF}",), want=f"ws/worktrees/{CONF}"),
    Case("env 存在 → 优先于同级", "ws/im-rtc-web", (f"ws/{CONF}", "elsewhere/vec"),
         env="@elsewhere/vec", want="elsewhere/vec"),
    Case("env 设了但不存在 → 抛错、不退回同级", "ws/im-rtc-web", (f"ws/{CONF}",),
         env="@nope", want_error="RTC_CONFORMANCE_DIR", old_fails=True),
    Case("env 空串 = 没设", "ws/im-rtc-web", (f"ws/{CONF}",), env="", want=f"ws/{CONF}"),
)


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


def build_layout(base: Path, source: Path, case: Case) -> Path:
    """搭目录、放向量、拷源码，返回拷过去的 vectors 文件。.mts 让 node 按 ESM 解析。"""
    for rel in case.vector_dirs:
        (base / rel).mkdir(parents=True, exist_ok=True)
        (base / rel / "probe.json").write_text(json.dumps({"from": rel}), encoding="utf-8")
    target = base / case.repo / TEST_DIR / "vectors.mts"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    return target


def probe(target: Path, conformance_env: str | None) -> dict[str, object]:
    """在干净环境里 import 并调一次 loadVector。驱动本身出问题时返回带 driver_error 的结果。"""
    env = {k: v for k, v in os.environ.items() if k != "RTC_CONFORMANCE_DIR"}
    env["VECTORS_URL"] = target.as_uri()
    if conformance_env is not None:
        env["RTC_CONFORMANCE_DIR"] = conformance_env
    try:
        out = subprocess.run(
            ["node", "--no-warnings", "--input-type=module", "-e", PROBE_JS],
            env=env, capture_output=True, text=True, timeout=30,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        return {"driver_error": f"node 起不来：{exc}"}
    lines = out.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"driver_error": out.stderr.strip()[-300:]}
    except json.JSONDecodeError:
        return {"driver_error": f"输出不是 JSON：{lines[-1][:200]}"}


def run_case(source: Path, case: Case) -> tuple[bool, str]:
    """跑一条布局，返回（是否符合期望，细节）。驱动故障一律算不符合，免得「期望抛错」的用例空过。"""
    with tempfile.TemporaryDirectory(prefix="vectors-") as tmp:
        base = Path(tmp).resolve()
        target = build_layout(base, source, case)
        env_value = case.env
        if env_value is not None and env_value.startswith("@"):
            env_value = str(base / env_value[1:])
        result = probe(target, env_value)
    if "driver_error" in result:
        return False, f"驱动故障：{result['driver_error']}"
    if case.want is not None:
        return result.get("from") == case.want, json.dumps(result, ensure_ascii=False)
    error = str(result.get("error", ""))
    return (not result.get("ok")) and case.want_error in error, json.dumps(result, ensure_ascii=False)


def old_source(dest: Path) -> Path | None:
    """取修复前的 vectors.ts。不在 git 仓里或版本不存在时返回 None，调用方跳过对照。"""
    try:
        out = subprocess.run(
            ["git", "show", f"{OLD_REV}:{TEST_DIR}/vectors.ts"],
            cwd=ROOT, capture_output=True, text=True, timeout=20,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        log.warning("git show 失败，跳过旧版对照：%s", exc)
        return None
    if out.returncode != 0:
        log.warning("取不到 %s 的旧版，跳过对照：%s", OLD_REV, out.stderr.strip())
        return None
    dest.write_text(out.stdout, encoding="utf-8")
    return dest


def check_new(rep: Report) -> None:
    for case in CASES:
        ok, detail = run_case(SRC, case)
        rep.check(f"新版：{case.name}", ok, detail)


def check_old(rep: Report) -> None:
    """对照组：旧版应当恰好挂在 old_fails 的那几条上——证明用例不是摆设。"""
    with tempfile.TemporaryDirectory(prefix="vectors-old-") as tmp:
        source = old_source(Path(tmp) / "vectors.ts")
        if source is None:
            return
        for case in CASES:
            ok, detail = run_case(source, case)
            expect = "挂" if case.old_fails else "过"
            rep.check(f"旧版应当{expect}：{case.name}", ok != case.old_fails, detail)


def check_vitest(rep: Report) -> None:
    """真跑一次 engine 的 vitest，**不带** RTC_CONFORMANCE_DIR，走的就是 siblingDir 那条路。"""
    env = {k: v for k, v in os.environ.items() if k != "RTC_CONFORMANCE_DIR"}
    try:
        out = subprocess.run(
            ["npx", "vitest", "run", "--root", "packages/call-engine"],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=600,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        rep.check("不设 env 直接跑 engine vitest", False, str(exc))
        return
    tail = "\n".join((out.stdout + out.stderr).strip().splitlines()[-6:])
    rep.check("不设 env 直接跑 engine vitest", out.returncode == 0, tail)


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 vectors.ts 的向量定位")
    parser.add_argument("--fast", action="store_true", help="不跑真实的 vitest")
    args = parser.parse_args()

    rep = Report()
    check_new(rep)
    check_old(rep)
    if not args.fast:
        check_vitest(rep)

    log.info("—— %d 过 / %d 挂 ——", len(rep.passed), len(rep.failed))
    for name in rep.failed:
        log.error("  ✗ %s", name)
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
