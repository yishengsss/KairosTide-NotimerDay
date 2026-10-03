# KairosTide - 你说的都队

<p align="center">
  <b>田园四时 · 一块不催你的表</b><br/>
  <sub>从太阳、天空、月亮、云、水面和光线里感知时间，而不是盯着倒计时。</sub>
</p>

<p align="center">
  <img alt="Vue 3" src="https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-646cff?logo=vite&logoColor=white">
  <img alt="Python 3.12" src="https://img.shields.io/badge/Python-3.12-3776ab?logo=python&logoColor=white">
  <img alt="FastAPI" src="https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-003b57?logo=sqlite&logoColor=white">
  <img alt="mypy strict" src="https://img.shields.io/badge/mypy-strict-2a6db2">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
</p>

---

## 目录

- [这是什么](#这是什么)
- [核心体验](#核心体验)
- [里程碑](#里程碑)
- [项目结构](#项目结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [配置](#配置)
- [开发命令与门禁](#开发命令与门禁)
- [HTTP 接口一览](#http-接口一览)
- [设计原则](#设计原则)
- [当前状态](#当前状态)

---

## 这是什么

KairosTide 的重新开发版本（2026-10-02 起）。旧的 KairosTide 和 XiAnHacker 目录只是**只读参考**，不作为本仓库的运行、构建或依赖输入；迁入的代码都先经过审查并补上测试。

首页是一个**弱化钟表的自然场景**，而不是日历、待办或倒计时工具：用户从太阳、天空、月亮、云、水面和光线感知时间流动，平时不显示当前时间、时间轴、下一事件或剩余分钟数。

> 首页只有两个自动隐藏的控件：**环境音**（默认关闭）和**全屏**。

## 核心体验

| 功能 | 说明 |
| --- | --- |
| 🌾 田园四时场景 | 由真实时间、地点和真实天气驱动的首页画面 |
| ✋ 长按查时 | 按住约 600ms，在按压点附近显示真实时间，约 3 秒后淡出 |
| 🦆 生灵代替圆环 | 事件进行中，池塘上出现一只属于当时季节、时段与天气的动物 |
| 📍 定位一次 | 进入首页时取一次设备经纬度决定季节、日月与天气；拒绝后不再追问，按时区估算继续运行 |
| 💬 助手 Kairos | 用对话查日程、查天气，把你说的话整理成**待确认草稿** |
| 🌱 柔性任务 | 没有固定时间、要抽空完成的事（背单词、写实验报告），可带截止时间 |

### 刚性事件的完整流程

```
提前提醒 → 开始 → 收起后水面上留下一只当下的「生灵」 → 例外 → 冲突选择 → 结束
```

事件进行中不再用红圈、黄圈标记，而是在池塘上出现一只属于当时季节、时段与天气的动物（**野鸭、蝴蝶、蜻蜓、白鹭、青蛙、萤火虫、白鹤**），点它展开事件卡，事件结束或记为「例外」后它散场。

理由是圆环是外来的符号，而生灵和画面里本来就在飞的蝴蝶、亮着的萤火虫是同一套物候，不打断田园画面。

### 助手：只出草稿，不替你决定

- **草稿不是日程**：助手生成的只是待确认草稿，点「确认保存 / 确认修改 / 确认删除 / 确认请假」才生效。
- **不猜**：时刻、时长、标题、地点，你没说就不填，改为提问。
- **不编造依据**：每份草稿都必须引用你的原话，服务端逐字核对。
- **否定或假设不执行**：「别加了」「如果我要……」这样的话不会产生草稿。
- **冲突由你选**：重叠时只说明重叠了哪一条，由界面上的冲突卡片让你自己选保留哪条。

## 里程碑

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| **M1** | 田园场景、长按查时、刚性事件全流程、天气代理 | ✅ 完成 |
| **M1.2** | 生灵代替圆环标记 | ✅ 完成 |
| **M2** | 助手 Kairos：对话、查询、新建日程草稿 | ✅ 完成 |
| **M2.5** | 修改 / 删除 / 请假草稿，地点页 | ✅ 完成 |
| **M3** | 柔性任务：领域、仓储、助手工具 | 🚧 进行中 |
| **M4** | 图片导入 | ⏳ 计划中 |

## 项目结构

```
.
├── apps/web          Vue 3 + TypeScript + Vite
│                       首页 index.html，预览 preview.html，地点 place.html
├── services/api      Python 3.12 + FastAPI + Pydantic + SQLite（uv 管理，mypy --strict）
│   └── src/kairos
│       ├── domain        纯领域：时间区间、重复展开与 DST、冲突、草稿、柔性任务
│       ├── application   用例与端口；assistant/ 是助手的对话与工具白名单
│       ├── adapters      SQLite 仓储、MiMo 模型、天气源
│       └── api           FastAPI 路由与 DTO
├── contracts         openapi.json（后端生成）→ api.d.ts（openapi-typescript 生成），只读产物
├── scripts           check.py：唯一门禁入口
└── ARCHITECTURE.md   分层、依赖方向与三种时钟
```

分层、依赖方向和三种时钟（`RealClock`、`SceneClock`、`ScheduleClock`）见 [架构](ARCHITECTURE.md)。依赖方向固定为 `api → application → domain`。

## 环境要求

| 依赖 | 版本 |
| --- | --- |
| Python | 3.12（由 uv 提供；`services/api/pyproject.toml` 要求 `>=3.12`） |
| uv | 0.12.13 |
| Node | 22（含 npm 10.9.8） |

> ⚠️ 系统自带的 `python3` 可能低于 3.12。`uv run` 会按 `pyproject.toml` 选 3.12，不要直接用系统 python 跑后端。

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/yishengsss/KairosTide-NotimerDay.git
cd KairosTide-NotimerDay

# 2. 后端
cd services/api
uv sync
uv run kairos-api                              # 127.0.0.1:8000

# 3. 写入一个开发用刚性事件（另开终端）
cd services/api
uv run kairos-dev seed --in 6m --minutes 20

# 4. 前端（另开终端）
cd apps/web
npm install
npm run dev                                    # 首页 /，预览 /preview.html
```

## 配置

后端从环境变量读取配置，可以写在 `services/api/.env` 里（**该文件已被 `.gitignore` 忽略，永远不要提交**）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MIMO_API_KEY` | 空 | 助手使用的模型密钥。不填则助手不可用，其余功能照常 |
| `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | 模型接口地址 |
| `MIMO_MODEL` | `mimo-v2.6-pro` | 模型名 |
| `KAIROS_DB` | `services/api/var/kairos.sqlite3` | SQLite 数据库路径 |
| `KAIROS_OWNER` | `local` | 本地所有者 ID |
| `KAIROS_HOST` | `127.0.0.1` | 监听地址 |
| `KAIROS_PORT` | `8000` | 监听端口 |

> 🔒 `MIMO_API_KEY` 只在服务端使用，不会发到前端。

## 开发命令与门禁

```bash
python3 scripts/check.py all                                     # 依次运行 docs、architecture、contracts、api、web
cd services/api && uv run kairos-api                             # 启动 API，地址 127.0.0.1:8000
cd services/api && uv run kairos-dev seed --in 6m --minutes 20   # 写入一个开发用刚性事件
cd apps/web && npm run dev                                       # 首页 /，预览页 /preview.html
```

门禁的唯一入口是 `python3 scripts/check.py all`，依次检查：

1. **docs**：文档链接有效
2. **architecture**：分层依赖方向、单个源文件不超过 400 行
3. **contracts**：`openapi.json` 与 `api.d.ts` 与代码一致
4. **api**：`mypy --strict`、`ruff`、`pytest`
5. **web**：`vue-tsc`、`vitest`、构建

## HTTP 接口一览

所有路由挂在 `/api/v1` 下，完整定义见 [`contracts/openapi.json`](contracts/openapi.json)。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/state` | 当前日程状态 |
| POST | `/reminders/{occurrence_id}/ack` | 提醒「知道了」 |
| POST | `/occurrences/{occurrence_id}/exception` | 这一次记为例外 |
| POST | `/conflict-decisions` | 冲突时选保留哪一条 |
| GET | `/weather/scene` | 场景天气 |
| GET | `/places` | 地点搜索 |
| GET | `/assistant/status` | 助手是否可用 |
| POST | `/conversations` | 开始一段对话 |
| GET / POST | `/conversations/{id}/messages` | 读取 / 发送消息 |
| GET | `/drafts/{draft_id}` | 读取草稿 |
| POST | `/drafts/{draft_id}/commit` | 确认草稿 |
| POST | `/drafts/{draft_id}/discard` | 丢弃草稿 |

## 设计原则

- **时间是氛围，不是压力**：平时不显示钟点、时间轴和倒计时。
- **模型负责理解，服务端只负责拒绝**：否定只能撤回动作，不能触发动作。
- **草稿不可变**：内容带摘要校验，只有状态会变；确认时版本不符即拒绝。
- **单一写入者**：所有写入都经过服务端用例，前端只读状态、发意图。
- **前向迁移**：SQLite 迁移只增不改。
- **密钥不出服务端**：`.env` 永不提交，也不发往前端。

## 当前状态

- ✅ M1、M1.2、M2、M2.5 已完成，后端测试全部通过。
- 🚧 M3（柔性任务）进行中：领域、迁移、仓储、助手工具已完成，HTTP 路由与前端尚未接入。
- ⚠️ 单测和构建通过不等于视觉验收，界面效果以浏览器实测为准。

## License

[MIT](LICENSE)
