#!/usr/bin/env python3
"""校验 scripts/dev.sh 这一轮改动。

三件事要成立：
  ① 两个 Demo 都能起 —— demo（5178）不回归，demo-react（5179）是这次新加的；
  ② Ctrl+Z 留下的僵尸占用（STAT=T，占着 listen socket 但不响应）会被自动回收；
  ③ 端口被**本仓之外**的进程占着时，绝不误杀。

跑法：python3 temp_verify.py（在 im-rtc-web 下）
     python3 temp_verify.py --fast   只跑不需要起 vite 的静态与边界检查
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Iterator

logging.basicConfig(level=logging.INFO, format="%(levelname)-7s %(message)s")
log: Final = logging.getLogger("verify")

ROOT: Final[Path] = Path(__file__).resolve().parent
DEV: Final[Path] = ROOT / "scripts" / "dev.sh"
REACT_PORT: Final[int] = 5179
DEMO_PORT: Final[int] = 5178


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


def dev(*args: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    """跑 dev.sh。超时/找不到脚本都折成一个 returncode!=0 的结果，调用方统一按失败处理。"""
    try:
        return subprocess.run(
            [str(DEV), *args], cwd=ROOT, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        log.error("dev.sh %s 超时 %ds", " ".join(args), timeout)
        return subprocess.CompletedProcess([str(DEV), *args], 124, "", "timeout")
    except OSError as exc:
        log.error("dev.sh %s 起不来：%s", " ".join(args), exc)
        return subprocess.CompletedProcess([str(DEV), *args], 127, "", str(exc))


def port_holder(port: int) -> str:
    """端口上的 LISTEN 进程 pid（没有则空串）。lsof 不在就当空。"""
    try:
        out = subprocess.run(
            ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
            capture_output=True, text=True, timeout=10,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        log.warning("lsof 查 %d 失败：%s", port, exc)
        return ""
    return out.stdout.split("\n")[0].strip()


def pgid_of(pid: str) -> str:
    try:
        out = subprocess.run(
            ["ps", "-o", "pgid=", "-p", pid], capture_output=True, text=True, timeout=10
        )
    except (subprocess.TimeoutExpired, OSError):
        return ""
    return out.stdout.strip()


def proc_stat(pid: str) -> str:
    try:
        out = subprocess.run(
            ["ps", "-o", "stat=", "-p", pid], capture_output=True, text=True, timeout=10
        )
    except (subprocess.TimeoutExpired, OSError):
        return ""
    return out.stdout.strip()


def page_title(port: int, timeout: float = 3.0) -> str:
    """取页面标题；连不上/超时都返回空串——调用方只关心「能不能拿到正确标题」。"""
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/", timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        log.debug("取 %d 标题失败：%s", port, exc)
        return ""
    start = body.find("<title>")
    return "" if start < 0 else body[start + 7 : body.find("</title>", start)].strip()


def wait_port(port: int, want: bool, limit: float = 30.0) -> bool:
    """等端口出现/消失。"""
    deadline = time.time() + limit
    while time.time() < deadline:
        if bool(port_holder(port)) == want:
            return True
        time.sleep(0.3)
    return bool(port_holder(port)) == want


@contextmanager
def suspended_vite(script: str) -> Iterator[str]:
    """复现 Ctrl+Z：单独进程组起 vite，等它占上端口后整组 SIGSTOP，退出时兜底清理。"""
    if port_holder(REACT_PORT):
        raise RuntimeError(f"{REACT_PORT} 起手就被占着，前一个用例没收干净")
    proc = subprocess.Popen(
        ["npm", "run", script], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
    )
    try:
        if not wait_port(REACT_PORT, want=True):
            raise RuntimeError(f"{script} 30 秒内没占上 {REACT_PORT}")
        holder = port_holder(REACT_PORT)
        # 必须确认占端口的是我们刚起的这一棵（同进程组），否则 SIGSTOP 打空、用例失去意义。
        if pgid_of(holder) != str(proc.pid):
            raise RuntimeError(f"{REACT_PORT} 上的 pid {holder} 不属于本用例起的进程组")
        os.killpg(proc.pid, signal.SIGSTOP)
        time.sleep(0.5)
        yield port_holder(REACT_PORT)
    finally:
        for sig in (signal.SIGCONT, signal.SIGKILL):
            try:
                os.killpg(proc.pid, sig)
            except (ProcessLookupError, PermissionError):
                pass
        proc.wait(timeout=10)


@contextmanager
def foreign_listener(port: int) -> Iterator[None]:
    """占住端口的「外人」：命令行里不含仓库路径，dev.sh 应当认出来并拒绝下手。"""
    code = (
        "import socket,time\n"
        "s=socket.socket()\n"
        "s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\n"
        f"s.bind(('127.0.0.1',{port}))\n"
        "s.listen(1)\n"
        "time.sleep(120)\n"
    )
    proc = subprocess.Popen([sys.executable, "-c", code], cwd="/", start_new_session=True)
    try:
        if not wait_port(port, want=True, limit=10):
            raise RuntimeError(f"占位进程没能占上 {port}（rc={proc.poll()}）")
        yield
    finally:
        proc.kill()
        proc.wait(timeout=10)


def check_static(rep: Report) -> None:
    """静态：那句骗人的 PORT 提示必须没了，两个 workspace 都要在。"""
    try:
        text = DEV.read_text(encoding="utf-8")
    except OSError as exc:
        rep.check("能读到 dev.sh", False, str(exc))
        return
    rep.check("不再建议 `PORT=5179 ./scripts/dev.sh`（vite 不读 PORT）",
              "PORT=5179 ./scripts/dev.sh" not in text.split("老版本")[0])
    rep.check("两个 workspace 都在", "demo-react" in text and "-w \"$WORKSPACE\"" in text)
    rep.check("回收端口只对本仓下手", '*"$REPO_ROOT"*)' in text)


def check_cli(rep: Report) -> None:
    """边界：无效参数、干净时的 status。"""
    bad = dev("bogus", timeout=20)
    rep.check("无效参数 → exit 2 且打用法",
              bad.returncode == 2 and "用法" in bad.stdout, bad.stdout.strip())
    dev("stop", "react", timeout=30)
    st = dev("status", "react", timeout=20)
    rep.check("干净状态下 status → stopped", "stopped" in st.stdout, st.stdout.strip())


def check_start_stop(rep: Report, target: str, port: int, title_mark: str) -> None:
    started = dev(target, timeout=90)
    ok = rep.check(f"起 {target} → exit 0",
                   started.returncode == 0, (started.stdout + started.stderr).strip()[-300:])
    if ok:
        rep.check(f"{target} 页面标题对得上（{title_mark}）", title_mark in page_title(port))
        rep.check(f"{target} status → running", "running" in dev("status", target, timeout=20).stdout)
    dev("stop", target, timeout=30)
    rep.check(f"停 {target} 后端口 {port} 释放", wait_port(port, want=False, limit=15))


def check_reclaim(rep: Report) -> None:
    """核心：Ctrl+Z 挂起的僵尸占用，dev.sh 要能自己收拾掉。"""
    with suspended_vite("dev:react") as holder:
        rep.check("僵尸进程确实处于挂起态（STAT=T）", proc_stat(holder).startswith("T"),
                  f"pid={holder} stat={proc_stat(holder)}")
        rep.check("僵尸占着端口却不响应 HTTP", page_title(REACT_PORT, timeout=3) == "")
        started = dev("react", timeout=90)
        rep.check("dev.sh react 回收僵尸后成功起来",
                  started.returncode == 0, (started.stdout + started.stderr).strip()[-300:])
        rep.check("回收日志有交代", "回收" in started.stdout, started.stdout.strip())
        rep.check("新服务真的在服务", "引 uikit 的 Demo" in page_title(REACT_PORT))
    dev("stop", "react", timeout=30)


def check_no_friendly_fire(rep: Report) -> None:
    """外部进程占端口时必须拒绝启动，而不是把人家杀了。"""
    with foreign_listener(REACT_PORT):
        before = port_holder(REACT_PORT)
        started = dev("react", timeout=60)
        rep.check("外部进程占端口 → 拒绝启动", started.returncode != 0, started.stdout.strip())
        rep.check("拒绝理由说清楚是「本仓之外」", "本仓之外" in started.stdout, started.stdout.strip())
        rep.check("外部进程毫发无损", port_holder(REACT_PORT) == before and before != "")
    dev("stop", "react", timeout=30)
    wait_port(REACT_PORT, want=False, limit=15)


def main() -> int:
    parser = argparse.ArgumentParser(description="校验 scripts/dev.sh")
    parser.add_argument("--fast", action="store_true", help="只跑静态与边界检查，不起 vite")
    args = parser.parse_args()

    rep = Report()
    check_static(rep)
    check_cli(rep)
    if not args.fast:
        check_no_friendly_fire(rep)
        check_reclaim(rep)
        check_start_stop(rep, "react", REACT_PORT, "引 uikit 的 Demo")
        check_start_stop(rep, "demo", DEMO_PORT, "im-rtc Demo")

    log.info("—— %d 过 / %d 挂 ——", len(rep.passed), len(rep.failed))
    for name in rep.failed:
        log.error("  ✗ %s", name)
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
