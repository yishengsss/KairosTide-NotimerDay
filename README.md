# XIHackthon

KairosTide 的重新开发版本（2026-10-02 起）。KairosTide 和旧的 XiAnHacker 目录都只是**只读参考**，不是本仓库的运行、构建或依赖输入；迁入了什么、从哪个修订迁入，登记在 [来源台账](docs/engineering/PROVENANCE.md)。

## 这是什么

首页是一个弱化钟表的自然场景，而不是日历、待办或倒计时工具：用户从太阳、天空、月亮、云、水面和光线感知时间流动，平时不显示当前时间、时间轴、下一事件或剩余分钟数。规则以 [产品记忆](docs/memory/PRODUCT_MEMORY.md) 为准，它只记录用户确认过的内容。

首个里程碑 **M1** 的范围：

- 「田园四时」首页场景，由真实时间、地点和真实天气驱动；
- 长按查时：按住约 600ms，在按压点附近显示真实时间，约 3 秒后淡出；
- 刚性事件的完整流程：提前提醒 → 开始 → 收起后水面上留下一只当下的**生灵** → 例外 → 冲突选择 → 结束；
- 进入首页时取一次设备经纬度来决定季节、日月与天气（拒绝后不再追问，没有定位时按时区估算继续运行）；
- 数据只由开发命令写入，不开放创建事件的 HTTP 接口。

事件进行中不再用红圈、黄圈标记，而是在池塘上出现一只属于当时季节、时段与天气的动物（野鸭、蝴蝶、蜻蜓、白鹭、青蛙、萤火虫、白鹤），点它展开事件卡，事件结束或记为「例外」后它散场。理由是圆环是外来的符号，而生灵和画面里本来就在飞的蝴蝶、亮着的萤火虫是同一套物候，不打断田园画面。细节与物种表见 [M1.2 计划](docs/exec-plans/active/2026-10-02-m1.2-living-marks.md)。

助手、草稿、柔性任务和图片导入不在 M1 内（分别是 M2、M3、M4）。范围与验收标准见 [M1 计划](docs/exec-plans/active/2026-10-02-m1.md)。

## 目录

```
apps/web        Vue 3 + TypeScript + Vite。首页 index.html，预览 preview.html，地点 place.html
services/api    Python 3.12 + FastAPI + Pydantic + SQLite（uv 管理，mypy --strict）
contracts       openapi.json（后端生成）→ api.d.ts（openapi-typescript 生成），只读产物
scripts         check.py：唯一门禁入口
docs            memory/、design/、engineering/、exec-plans/
```

分层、依赖方向和三种时钟（`RealClock`、`SceneClock`、`ScheduleClock`）见 [架构](ARCHITECTURE.md)。

## 环境要求

| 依赖 | 本机实际使用 |
| --- | --- |
| Python | 3.12（由 uv 提供；`services/api/pyproject.toml` 要求 `>=3.12`） |
| uv | 0.12.13 |
| Node | 22（含 npm 10.9.8） |

系统自带的 `python3` 可能低于 3.12，`uv run` 会按 `pyproject.toml` 选 3.12，不要直接用系统 python 跑后端。

## 开发命令

```bash
python3 scripts/check.py all                                     # 依次运行 docs、architecture、contracts、api、web
cd services/api && uv run kairos-api                             # 启动 API，地址 127.0.0.1:8000
cd services/api && uv run kairos-dev seed --in 6m --minutes 20   # 写入一个开发用刚性事件
cd apps/web && npm run dev                                       # 首页 /，预览页 /preview.html
```

门禁的唯一入口是 `python3 scripts/check.py all`，依次检查文档链接、架构约束、契约、后端和前端。**注意：`scripts/check.py` 目前还没有写进本仓库**，上面的第一条命令现在无法执行；契约文件 `contracts/openapi.json` 与 `contracts/api.d.ts` 已经生成，但后端路由和前端业务层仍在开发中。

## 阅读顺序

开始任何工作前，按 [AGENTS.md](AGENTS.md) 给出的顺序读一遍：产品记忆 → 架构 → 当前执行计划 → 来源台账。AGENTS.md 同时列出硬性约束和协作规则，改动前请先确认自己没有违反其中任何一条。

## 当前状态

M1 尚未完成，也**没有任何浏览器视觉验收**。已完成的部分：

- 文档：架构、产品记忆、M1 计划、来源台账；
- 后端领域层（`services/api/src/kairos/domain/`）：时间区间、重复展开与 DST、实例身份、冲突分组、状态投影，并配有 `tests/domain/` 下的单测；
- 素材迁入（`apps/web/src/scene/pastoral/assets/`，98 个文件，逐文件校验值见 [素材台账](docs/design/PASTORAL_ASSETS.md)）；
- 场景引擎的部分模块：`astro.ts`、`model.ts`、`geometry.ts`、`assets.ts`、`wind.ts`、`audio.ts` 与 `render/*`。

尚未完成：SQLite 仓储与用例、路由与 seed CLI 的收尾、`scripts/check.py` 门禁、前端业务层（`api/`、`clock/`、`schedule/`、`presentation/`、`peek/`、`app/`、`preview/`、`place/` 目录都还是空的，三个 HTML 入口指向尚不存在的 `main.ts`）。

**验证记录**：[M1 计划](docs/exec-plans/active/2026-10-02-m1.md) §7 目前是空的，还没有填入任何一次运行结果。单测和构建通过不等于视觉验收，请不要据此宣称 M1 已经通过。
