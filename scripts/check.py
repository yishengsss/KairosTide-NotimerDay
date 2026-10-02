#!/usr/bin/env python3
"""唯一门禁入口：python3 scripts/check.py <docs|architecture|contracts|api|web|all>

只做检查，不改动仓库文件；除 subprocess 调用真实工具外只用标准库。
退出码：0 全部通过；1 有门禁失败；2 没有失败但有门禁被跳过（未验证，不算通过）。
"""

from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATES = ("docs", "architecture", "contracts", "api", "web")

# AGENTS.md 列出的四份入口文档
ENTRY_DOCS = ("docs/memory/PRODUCT_MEMORY.md", "ARCHITECTURE.md",
              "docs/exec-plans/active/2026-10-02-m1.md", "docs/engineering/PROVENANCE.md")

MAX_LINES = 400
# 行数豁免名单：GLSL 写在模板字符串里的着色器源码文件，逐个登记
SHADER_ALLOWLIST = frozenset({"apps/web/src/scene/pastoral/render/gl.ts"})
SKIP_DIRS = frozenset({"node_modules", "__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".git", ".venv"})

# 后端依赖方向：目录 -> 禁止导入的模块
BACKEND_RULES = (
    ("services/api/src/kairos/domain", ("kairos.application", "kairos.adapters", "kairos.api", "fastapi", "sqlite3")),
    ("services/api/src/kairos/application", ("kairos.adapters", "kairos.api", "fastapi")),
    ("services/api/src/kairos/api/routes", ("kairos.adapters",)),
)
PY_SRC_ROOT = "services/api/src"
WEB_SRC = "apps/web/src"
PRESENTER = "apps/web/src/presentation/presenter.ts"
SYNC_FILE = "apps/web/src/schedule/sync.ts"
# 界面延时（自动隐藏、长按、卡片折叠）唯一的计时器出口；它不得导入任何模块，因此长不出轮询
DELAY_FILE = "apps/web/src/ui/delay.ts"
TIMER_FILES = (SYNC_FILE, DELAY_FILE)
AUDIO_FILE = "apps/web/src/scene/pastoral/audio.ts"
PASTORAL_FORBIDDEN = ("api", "schedule", "presentation")
UV_ENV = {"UV_PROJECT_ENVIRONMENT": "/tmp/kairos-venv", "UV_LINK_MODE": "copy"}
CONTRACT_CMD = ["npx", "--prefix", "apps/web", "openapi-typescript", "contracts/openapi.json"]

MD_LINK_RE = re.compile(r"!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\s*\)")
PY_FROM_RE = re.compile(r"^\s*from\s+(\.*)([\w.]*)\s+import\s+(.+)$")
PY_IMPORT_RE = re.compile(r"^\s*import\s+(.+)$")
TS_IMPORT_RES = (re.compile(r"\b(?:import|export)\b[^;'\"`]*?\bfrom\s*['\"]([^'\"]+)['\"]"),
                 re.compile(r"\bimport\s*['\"]([^'\"]+)['\"]"),
                 re.compile(r"\bimport\s*\(\s*['\"]([^'\"]+)['\"]"))
FETCH_RE = re.compile(r"\bfetch\s*\(")
TIMEOUT_RE = re.compile(r"\bsetTimeout\s*\(")
INTERVAL_RE = re.compile(r"\bsetInterval\s*\(")
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")


# ------------------------------------------------------------------ 结果与输出

class Report:
    """单个门禁的检查结果。"""

    def __init__(self, gate: str) -> None:
        self.gate = gate
        self.statuses: list[str] = []

    def emit(self, status: str, title: str, detail: str = "") -> None:
        self.statuses.append(status)
        print(f"[{status}] {title}")
        for line in detail.rstrip().splitlines():
            print(f"    {line}")

    def status(self) -> str:
        if "FAIL" in self.statuses:
            return "FAIL"
        return "SKIP" if "SKIP" in self.statuses else "PASS"


def tail(text: str, lines: int = 25) -> str:
    rows = ANSI_RE.sub("", text or "").rstrip().splitlines()
    return "\n".join(rows[-lines:]) if rows else "（无输出）"


def run(cmd: list[str], cwd: Path, extra_env: dict[str, str] | None = None) -> tuple[int, str]:
    """运行真实工具，返回（退出码，合并后的输出）。"""
    env = {**os.environ, "NO_COLOR": "1", "FORCE_COLOR": "0", **(extra_env or {})}
    where = "." if cwd == ROOT else cwd.relative_to(ROOT).as_posix()
    print(f"$ (cd {where} && {' '.join(cmd)})")
    try:
        proc = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=1800)
    except FileNotFoundError as exc:
        return 127, f"找不到命令：{exc}"
    except subprocess.TimeoutExpired:
        return 124, "超时（1800 秒）"
    return proc.returncode, proc.stdout + proc.stderr


# ------------------------------------------------------------------ 文件遍历

def walk(base: str, suffixes: tuple[str, ...]) -> list[Path]:
    found: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ROOT / base):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        found.extend(Path(dirpath) / n for n in sorted(filenames) if n.endswith(suffixes))
    return found


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


# ------------------------------------------------------------------ docs

def md_links(path: Path) -> list[tuple[int, str]]:
    """提取 Markdown 链接（跳过代码围栏与行内代码），返回（行号，原始目标）。"""
    targets: list[tuple[int, str]] = []
    in_fence = False
    for lineno, line in enumerate(read_lines(path), 1):
        if line.lstrip().startswith(("```", "~~~")):
            in_fence = not in_fence
        elif not in_fence:
            targets.extend((lineno, m.group(1)) for m in MD_LINK_RE.finditer(re.sub(r"`[^`]*`", "", line)))
    return targets


def gate_docs(rep: Report) -> None:
    missing = [d for d in ENTRY_DOCS if not (ROOT / d).is_file()]
    rep.emit("FAIL" if missing else "PASS", f"AGENTS.md 的 {len(ENTRY_DOCS)} 份入口文档都存在",
             "\n".join(f"缺少入口文档：{d}" for d in missing))

    broken: list[str] = []
    checked = 0
    for md in walk(".", (".md",)):
        for lineno, raw in md_links(md):
            if re.match(r"^[a-zA-Z][\w+.-]*:", raw) or raw.startswith(("#", "/")):
                continue  # 外部链接、页内锚点、绝对路径不在检查范围
            target = os.path.normpath(md.parent / raw.split("#", 1)[0].split("?", 1)[0])
            if not Path(target).resolve().is_relative_to(ROOT):
                continue  # 指向仓库之外
            checked += 1
            if not Path(target).exists():
                broken.append(f"{rel(md)}:{lineno} -> {raw}（{Path(target).relative_to(ROOT).as_posix()} 不存在）")
    rep.emit("FAIL" if broken else "PASS", f"Markdown 仓库内相对链接可解析（共 {checked} 条）", "\n".join(broken))


# ------------------------------------------------------------------ architecture：行数上限

def check_line_limits(rep: Report) -> None:
    scopes = (("services", (".py",)), (WEB_SRC, (".ts", ".vue")), ("apps/web/tests", (".ts", ".vue")))
    over: list[str] = []
    exempt: list[str] = []
    scanned = 0
    for base, suffixes in scopes:
        for path in walk(base, suffixes):
            count = len(read_lines(path))
            if rel(path) in SHADER_ALLOWLIST:
                exempt.append(f"{rel(path)}：{count} 行（着色器源码，豁免）")
            else:
                scanned += 1
                if count > MAX_LINES:
                    over.append(f"{rel(path)}：{count} 行（上限 {MAX_LINES}）")
    rep.emit("FAIL" if over else "PASS", f"单个源文件不超过 {MAX_LINES} 行（扫描 {scanned} 个）", "\n".join(over + exempt))


# ------------------------------------------------------------------ architecture：后端依赖方向

def py_imports(path: Path) -> list[tuple[int, str]]:
    """返回文件中的（行号，绝对模块名）；相对导入按包路径展开。"""
    parts = list(path.relative_to(ROOT / PY_SRC_ROOT).with_suffix("").parts)
    package = parts[:-1] if path.name == "__init__.py" else parts[:-1]
    found: list[tuple[int, str]] = []
    for lineno, line in enumerate(read_lines(path), 1):
        if m := PY_FROM_RE.match(line):
            dots, module, names = m.groups()
            base = package[: len(package) - (len(dots) - 1)] if len(dots) > 1 else package
            prefix = ".".join(base)
            if module:
                found.append((lineno, f"{prefix}.{module}"))
            else:  # from .. import a, b
                found.extend((lineno, f"{prefix}.{n.split()[0]}") for n in names.strip("() \\").split(",") if n.strip())
        elif m := PY_IMPORT_RE.match(line):
            found.extend((lineno, p.split()[0]) for p in m.group(1).split(",") if p.strip())
    return found


def check_backend_imports(rep: Report) -> None:
    bad: list[str] = []
    scanned = 0
    for base, forbidden in BACKEND_RULES:
        for path in walk(base, (".py",)):
            scanned += 1
            for lineno, module in py_imports(path):
                if any(module == f or module.startswith(f + ".") for f in forbidden):
                    bad.append(f"{rel(path)}:{lineno} 导入了 {module}（{base} 禁止导入 {', '.join(forbidden)}）")
    rep.emit("FAIL" if bad else "PASS", f"后端依赖方向（扫描 {scanned} 个文件）", "\n".join(bad))


# ------------------------------------------------------------------ architecture：前端规则

def ts_imports(text: str) -> list[tuple[int, str]]:
    found = {(text.count("\n", 0, m.start(1)) + 1, m.group(1)) for p in TS_IMPORT_RES for m in p.finditer(text)}
    return sorted(found)


def resolve_spec(key: str, spec: str) -> str:
    """相对说明符解析成仓库相对路径；@/ 视为 src 别名；包名原样返回。"""
    if spec.startswith("."):
        return os.path.normpath(os.path.join(os.path.dirname(key), spec))
    return f"{WEB_SRC}/{spec[2:]}" if spec.startswith("@/") else spec


def is_vue(spec: str) -> bool:
    return spec == "vue" or spec.startswith(("vue/", "@vue/"))


def under(path: str, directory: str) -> bool:
    return path == directory or path.startswith(directory + "/")


def in_dir(target: str, name: str) -> bool:
    """目标路径是否落在名为 name 的目录里（包名说明符如 x/y 也能命中）。"""
    return under(target, f"{WEB_SRC}/{name}") or f"/{name}/" in f"/{target}"


def import_violations(key: str, lineno: int, spec: str) -> list[str]:
    target = resolve_spec(key, spec)
    out: list[str] = []
    if under(key, f"{WEB_SRC}/scene/pastoral"):
        if is_vue(spec):
            out.append(f"{key}:{lineno} scene/pastoral 不得导入 vue：{spec}")
        out.extend(f"{key}:{lineno} scene/pastoral 不得导入 {d}/：{spec}" for d in PASTORAL_FORBIDDEN if in_dir(target, d))
    if key == PRESENTER and is_vue(spec):
        out.append(f"{key}:{lineno} presenter.ts 必须是纯函数，不得导入 vue：{spec}")
    if key == DELAY_FILE:
        out.append(f"{key}:{lineno} ui/delay.ts 不得导入任何模块（计时器出口不能接触数据）：{spec}")
    if under(key, f"{WEB_SRC}/app") and in_dir(target, "preview"):
        out.append(f"{key}:{lineno} 正式首页 app/ 不得引用 preview/：{spec}")
    return out


def code_violations(key: str, lineno: int, line: str) -> list[str]:
    code = "" if line.lstrip().startswith("*") else line.split("//", 1)[0]
    out: list[str] = []
    if FETCH_RE.search(code) and not under(key, f"{WEB_SRC}/api"):
        out.append(f"{key}:{lineno} fetch( 只能出现在 apps/web/src/api/：{line.strip()}")
    if TIMEOUT_RE.search(code) and key not in TIMER_FILES:
        out.append(f"{key}:{lineno} setTimeout 只能出现在 sync.ts 和 ui/delay.ts：{line.strip()}")
    if INTERVAL_RE.search(code) and key not in (*TIMER_FILES, AUDIO_FILE):
        out.append(f"{key}:{lineno} setInterval 只允许 sync.ts、ui/delay.ts 和 audio.ts 的音频 tick：{line.strip()}")
    return out


def check_frontend_rules(rep: Report) -> None:
    bad: list[str] = []
    files = walk(WEB_SRC, (".ts", ".vue"))
    for path in files:
        key = rel(path)
        text = path.read_text(encoding="utf-8", errors="replace")
        bad.extend(v for lineno, spec in ts_imports(text) for v in import_violations(key, lineno, spec))
        for lineno, line in enumerate(text.splitlines(), 1):
            bad.extend(code_violations(key, lineno, line))
    title = f"前端规则：fetch、pastoral/presenter/app 导入、setTimeout（扫描 {len(files)} 个文件）"
    rep.emit("FAIL" if bad else "PASS", title, "\n".join(bad))


def gate_architecture(rep: Report) -> None:
    check_line_limits(rep)
    check_backend_imports(rep)
    check_frontend_rules(rep)


# ------------------------------------------------------------------ contracts

def check_contract_files(rep: Report) -> None:
    openapi, types = ROOT / "contracts/openapi.json", ROOT / "contracts/api.d.ts"
    try:
        json.loads(openapi.read_text(encoding="utf-8"))
        rep.emit("PASS", "contracts/openapi.json 存在且是合法 JSON")
    except FileNotFoundError:
        rep.emit("FAIL", "contracts/openapi.json 存在且是合法 JSON", "文件不存在")
    except json.JSONDecodeError as exc:
        rep.emit("FAIL", "contracts/openapi.json 存在且是合法 JSON",
                 f"解析失败：第 {exc.lineno} 行第 {exc.colno} 列：{exc.msg}")
    has_types = types.is_file()
    rep.emit("PASS" if has_types else "FAIL", "contracts/api.d.ts 存在", "" if has_types else "文件不存在")


def check_contract_regen(rep: Report) -> None:
    title = "重新生成类型与 contracts/api.d.ts 一致"
    if shutil.which("npx") is None:
        rep.emit("SKIP", title, "原因：PATH 中找不到 npx")
        return
    if not (ROOT / "apps/web/node_modules/.bin/openapi-typescript").exists():
        rep.emit("SKIP", title, "原因：apps/web/node_modules 缺少 openapi-typescript（先在 apps/web 执行 npm ci）")
        return
    code, out = run(CONTRACT_CMD, ROOT)
    if code != 0:
        rep.emit("FAIL", f"{title}（生成命令退出码 {code}）", "输出末尾：\n" + tail(out))
        return
    with tempfile.NamedTemporaryFile("w", suffix=".d.ts", delete=False, encoding="utf-8") as tmp:
        tmp.write(out)
    print(f"$ 生成结果 -> {tmp.name}（临时文件）")
    generated = Path(tmp.name).read_text(encoding="utf-8").splitlines(keepends=True)
    Path(tmp.name).unlink()
    current = (ROOT / "contracts/api.d.ts").read_text(encoding="utf-8").splitlines(keepends=True)
    diff = list(difflib.unified_diff(current, generated, "contracts/api.d.ts", "重新生成的结果"))
    if diff:
        rep.emit("FAIL", f"{title}（退出码 {code}）",
                 "contracts/api.d.ts 已过期，需重新生成；差异前 40 行：\n" + "".join(diff[:40]))
    else:
        rep.emit("PASS", f"{title}（退出码 {code}，无差异）")


def gate_contracts(rep: Report) -> None:
    check_contract_files(rep)
    if all((ROOT / f).is_file() for f in ("contracts/openapi.json", "contracts/api.d.ts")):
        check_contract_regen(rep)
    else:
        rep.emit("SKIP", "重新生成类型与 contracts/api.d.ts 一致", "原因：契约文件缺失，跳过比较")


# ------------------------------------------------------------------ api

def gate_api(rep: Report) -> None:
    api_dir = ROOT / "services/api"
    if shutil.which("uv", path=f"{Path.home()}/.local/bin{os.pathsep}{os.environ.get('PATH', '')}") is None:
        rep.emit("SKIP", "后端测试", "原因：PATH 与 ~/.local/bin 中都找不到 uv")
        return
    print("环境：PATH=$HOME/.local/bin:$PATH " + " ".join(f"{k}={v}" for k, v in UV_ENV.items()))
    pyproject = (api_dir / "pyproject.toml").read_text(encoding="utf-8")
    cmds = [["uv", "run", "pytest", "-q"]]
    if "[tool.mypy]" in pyproject:
        cmds.append(["uv", "run", "mypy", "src"])
    if re.search(r"^\[tool\.ruff[.\]]", pyproject, re.M):
        cmds.append(["uv", "run", "ruff", "check", "."])
    for cmd in cmds:
        code, out = run(cmd, api_dir, UV_ENV)
        rep.emit("PASS" if code == 0 else "FAIL", f"{' '.join(cmd)}（退出码 {code}）", "输出末尾：\n" + tail(out))


# ------------------------------------------------------------------ web

def gate_web(rep: Report) -> None:
    web_dir = ROOT / "apps/web"
    if shutil.which("npm") is None:
        rep.emit("SKIP", "前端检查", "原因：PATH 中找不到 npm")
        return
    if not (web_dir / "node_modules").is_dir():
        rep.emit("SKIP", "前端检查", "原因：apps/web/node_modules 不存在（先在 apps/web 执行 npm ci）")
        return
    for cmd in (["npm", "run", "typecheck"], ["npm", "run", "test"]):
        code, out = run(cmd, web_dir)
        rep.emit("PASS" if code == 0 else "FAIL", f"{' '.join(cmd)}（退出码 {code}）", "输出末尾：\n" + tail(out))


# ------------------------------------------------------------------ 入口

GATE_FUNCS = {"docs": gate_docs, "architecture": gate_architecture, "contracts": gate_contracts,
              "api": gate_api, "web": gate_web}
STATUS_ZH = {"PASS": "通过", "FAIL": "失败", "SKIP": "跳过（未验证）"}


def print_summary(reports: list[Report]) -> int:
    print("\n===== 汇总 =====")
    for rep in reports:
        print(f"  {rep.gate:<13}{rep.status():<6}{STATUS_ZH[rep.status()]}")
    failed = [r.gate for r in reports if r.status() == "FAIL"]
    skipped = [r.gate for r in reports if r.status() == "SKIP"]
    if failed:
        print(f"结果：失败（{', '.join(failed)}）")
        return 1
    if skipped:
        print(f"结果：没有失败，但 {', '.join(skipped)} 被跳过，不能视为通过")
        return 2
    print("结果：全部通过")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in (*GATES, "all"):
        print("用法：python3 scripts/check.py <docs|architecture|contracts|api|web|all>")
        return 2
    reports: list[Report] = []
    for gate in GATES if argv[0] == "all" else (argv[0],):
        print(f"\n===== 门禁 {gate} =====")
        rep = Report(gate)
        GATE_FUNCS[gate](rep)
        reports.append(rep)
    return print_summary(reports)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
