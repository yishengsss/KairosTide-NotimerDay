# 架构

状态：工程方案（2026-10-02）。用户确认过的产品规则另行维护，本文只描述实现方式。

## 总览

```
apps/web        Vue 3 + TS + Vite。首页 index.html，预览 preview.html
services/api    Python 3.12 + FastAPI + Pydantic + SQLite（uv 管理，mypy --strict）
contracts       openapi.json（后端生成）→ api.d.ts（openapi-typescript 生成），只读产物
scripts/check.py 唯一门禁入口：docs | architecture | contracts | api | web | all
```

## 四个维度分离

| 维度 | 权威来源 | 例子 |
| --- | --- | --- |
| 环境 | 浏览器：真实时间 + 地点 + 真实天气 | 太阳/月亮、节气、雨雪雾 |
| 业务事实 | 后端 SQLite | 事件、实例、处置（scheduled/excused/missed）、提醒确认 |
| 呈现 | 前端纯函数 `presenter` | 是否显示提醒、事件卡、生灵站位、冲突选择 |
| 交互 | 前端组件局部状态 | 长按、卡片展开/收起 |

各维度只单向流动：环境不读业务；业务不读环境；呈现读取业务快照和交互状态，输出视图模型；场景只接收环境帧和一个 `mood`（`free | work`）。

## 三种时钟

- `RealClock`：设备时间。长按查时只用它。
- `SceneClock`：场景环境时间。首页等于 `RealClock`；只有预览页可以加速或指定时刻。
- `ScheduleClock`：`RealClock` 加上服务器时间偏移（由 `/state` 的 `server_now` 校准）。用于计算提醒紧迫度和本地切换时刻。

## 后端分层（`services/api/src/kairos`）

```
domain/        纯规则：时间区间、重复展开与 DST、实例身份、冲突分组、提醒推导、状态投影。无 I/O
application/   用例：ports.py（Clock、UnitOfWork 协议）+ 每个用例一个模块。只依赖 domain 和 ports
adapters/      sqlite（连接、迁移、UnitOfWork、各仓储）、open_meteo、clock
api/           dto.py（Pydantic 请求/响应）、errors.py（统一错误）、routes/*.py（薄路由）
bootstrap.py   组装 settings、adapters、services 和路由，产出 FastAPI app
cli.py         开发命令（seed、openapi 导出）
```

依赖方向是 `api → application → domain`，`adapters → application.ports`。`scripts/check.py architecture` 会检查：

- `domain` 不导入 `kairos.application/adapters/api`、`fastapi` 或 `sqlite3`；
- `application` 不导入 `adapters`、`api` 或 `fastapi`；
- 路由不直接导入 `adapters`；
- 单个源文件不超过 400 行。

关键设计：

- **`GET /state` 只读**：提醒由 `domain/reminders.py` 按 “scheduled 且开始前 5 分钟内” 推导得出。数据库只记录确认（ack），不再在 GET 中写入提醒行。
- **写操作**都带 `Idempotency-Key` 和乐观版本（`expected_version`，冲突决定额外带 `state_revision`）。同一个键加相同请求返回原结果；同一个键加不同请求返回 409。
- **事务**：每个用例一个 `UnitOfWork`（`BEGIN IMMEDIATE`）。仓储按聚合拆分，不出现上千行的单类。
- **错误**：统一 `{ "error": { "code", "message" } }`，code 是稳定的机器可读值。
- **天气**：`GET /weather/scene?lat&lon` 返回归一化观测，坐标取到 0.01°，缓存 10 分钟。供应商失败时返回 `availability: "unavailable"`，不伪造晴天。`GET /places?q=` 做地名搜索。
- **助手（M2）**：`application/assistant/` 依赖 `ports.AssistantModel`，适配器在 `adapters/ai/mimo.py`。模型只能从三个白名单工具里选（查刚性日程、查天气、建草稿），服务端逐个校验依据、所有权与写入否决；每轮最多 3 次模型往返、4 次工具调用、1 份草稿。一轮分两个事务，中间调用模型；失败的轮次保持 pending，用同一个 `client_message_id` 续跑。草稿只能由 `POST /drafts/{id}/commit` 写入日程，该路径不接触模型；有重叠时返回 409 `CONFLICT_REVIEW_REQUIRED` 和复核令牌。`MIMO_API_KEY` 只在 `services/api/.env`；未配置时助手接口返回 503，其余功能照常。

## 前端分层（`apps/web/src`）

```
api/           唯一允许 fetch 的地方：client.ts（错误、幂等键）+ 各资源函数；types 来自 contracts
clock/         RealClock、SceneClock、ScheduleClock
schedule/      store.ts（快照 + 待同步操作）、sync.ts（单一同步引擎：轮询、切换时刻、可见性）
presentation/  presenter.ts（纯函数）、markLayout.ts、ScheduleLayer、ReminderLayer、EventCard、MarkTarget、ConflictPicker
environment/   location.ts、geolocate.ts（进入首页时的一次定位）、weather.ts、frame.ts（地点 + 天气 + 天文 → EnvironmentFrame）
scene/pastoral/ 不依赖框架的场景引擎（astro、model、geometry、assets、wind、render/*、audio、engine、residents）
scene/fauna/  生灵：species.ts（谁此刻在场）、draw.ts（每种的画法）、layer.ts（到场/离场/换种）、project.ts（CSS→美术像素）
scene/         PastoralScene.vue、AmbientControls.vue
peek/          长按查时
assistant/     M2 助手：session.ts（只在本地存对话 ID）、AssistantPanel、DraftCard、HouseEntry（农舍透明命中区）
place/         地点页：手动选择、用设备定位、复位
app/           App.vue、main.ts
preview/       预览页入口（倍速、跳节气、节气随机天气、调试参数）
```

`scripts/check.py architecture` 会检查：

- `fetch(` 只出现在 `api/`；
- `scene/pastoral` 不导入 `vue`、`api`、`schedule` 或 `presentation`；
- `presentation/presenter.ts` 不导入 `vue`；
- 正式首页（`app/`）不引用 `preview/`；
- 单个源文件不超过 400 行。着色器源码文件除外，单独登记在豁免列表中。

## 同步

只有一个 `syncEngine`，所有向服务端拉取的计时都在 `schedule/sync.ts`。界面自身的短延时（控件 3 秒自动隐藏、长按 600 毫秒、卡片折叠、查时标签刷新）统一走 `ui/delay.ts`；该文件不得导入任何模块，因此无法发请求或读写日程。除这两处外，`setTimeout` 不得出现（音频模块的节拍 `setInterval` 单独登记）。`check.py architecture` 强制执行。syncEngine 负责：

- 定时拉取 `/state`：页面可见时 30 秒一次，隐藏时暂停，回到可见立刻拉取；
- 在 `next_transition_at` 和提醒窗口边界拉取；
- 写操作完成后拉取。

D5：沿用 HTTP 轮询，暂不引入 SSE/WebSocket。

写操作先做本地乐观更新，例如点“知道了”立即隐藏提醒；网络失败时保留本地结果，并在下次同步时重试。“例外”失败时恢复卡片，并提示“未同步”。
