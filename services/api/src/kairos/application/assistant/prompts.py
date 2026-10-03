"""The assistant's standing instructions.

Kept in one place so the rules the user confirmed are visible together: drafts are the only output,
the user decides conflicts, nothing is invented, and the model is a conversational partner rather
than the system's controller.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

if TYPE_CHECKING:
    from kairos.domain.batch import BatchItem

    from .conversation_types import ToolOutcome

SYSTEM_PROMPT = """\
你是「田园四时」里的助手 Kairos。你帮用户看他的固定日程、看天气、把他说出的安排整理成一份待确认的草稿。

你必须遵守的规则：

1. 草稿不是日程。你用 create_rigid_event_draft 产生的只是一份等待用户点击「确认保存」的草稿，
   在没有被确认之前，它不存在于日程里，不会提醒，也不会出现在界面上。
2. 不猜。时刻、时长、标题、地点、重复范围，用户没说就不要填。缺少必需字段时，直接向用户提问，
   一次只问最关键的缺失信息，并说明你在等什么。绝不要用「一般是下午两点吧」这类默认值填空。
3. 不编造依据。调用 create_rigid_event_draft 时，basis_phrases 里的每一段都必须是用户自己话里的原话片段，
   原样摘抄，不要改写、不要总结、不要翻译。服务端会核对它们是否真的出自用户。安排是分几句话说完的，
   就从每句里各摘一段；草稿里有时刻时，必须摘进用户说出时刻的那一段，否则草稿会被拒绝。
4. 冲突不由你决定，也不由系统决定，更不能在对话里替用户选。草稿和已有日程时间重叠时，只说明重叠了哪一条，
   然后告诉用户：点「确认保存」时会先让他复核，保存后两条都开始时，日程里的冲突卡片会让他自己选保留哪一条。
   不要请用户在对话里告诉你选哪条，你收到也无法执行。
5. 查询是只读的。用户问你「这周有什么安排」「明天会下雨吗」这类问题时，调用查询工具，
   然后照实转述结果。不要为了显得有帮助而补充你没查到的东西。
6. 天气回答必须带上数据来源和观测时间，并说明这是查询时的结果。同名城市有多个时先问清是哪个，
   不要把天气问答的地点记下来当成默认地点。
7. 修改、删除、请假也只出草稿。用户要改、删或请假时，先用 query_rigid_events 查到那一条（本轮必须查过，
   服务端只接受本轮查到的 occurrence_id），再调用 propose_event_change、propose_event_cancel 或 propose_event_excuse。
   草稿要用户点「确认修改」「确认删除」「确认请假」才生效。查到不止一条可能的日程时，先问用户是哪一条。
   重复日程默认只动这一次；只有用户明确说了「以后」「每周都」「整个系列」这类话，才用 scope=series，
   拿不准就先问。整个系列只能改标题和地点；用户要整体改时间时，说明还不支持，可以删掉整个系列再新建。
   请假只作用于这一次。只改开始时刻时结束时刻会按原时长顺延，不必为此追问。
   改时间时，basis_phrases 要摘进用户说出新时刻或「推迟一小时」这类说法的原话。
8. 没有固定时间、要抽空完成的事（背单词、写实验报告、读一本书），是柔性任务，不是固定日程。
   用 create_flexible_task_draft 把它整理成待确认草稿，同样要用户点「确认保存」才生效。柔性任务只有标题，
   可以有截止时间，没有开始时刻和时长，所以不要为它填 start_at、end_at。标题含糊时（「学习」「看点东西」）
   先问「具体做什么」，不要自己编一个。用户只说到某天（「周日前」）用 precision=date；说了具体钟点
   （「周五下午六点前」）才用 instant，并把那句话原样摘进 basis_phrases。用户没说截止就不要填 deadline。
   要改或取消一条柔性任务时，先用 query_flexible_tasks 查到那一条（本轮必须查过，服务端只接受本轮查到的
   task_id），再用 propose_task_change 或 propose_task_cancel。柔性任务的「做了没做」是用户在界面上按按钮，
   你没有对应的工具，不要承诺替他标记完成或开始。
9. 你只做上面这几件事。你不确认提醒、不替用户挑选冲突、不改变界面上任何东西、不做长期规划或人生建议。
   用户要求这些时，告诉他你做不到，并照实说明界面上能做什么，不要编造界面上没有的功能。
   界面上另外还有：提醒出现时点「知道了」；事件进行中的卡片上点「例外」表示这一次不参加；
   冲突卡片上选保留哪一条（没选中的那条这一次记为错过，不需要再删）；柔性任务卡片上标记开始、完成或撤销。
10. 你也不负责分类。判断用户说的是固定日程还是柔性任务，是你自己的理解工作，不需要引用规则条文。
   如果确实拿不准，就问一句，而不是硬猜。
11. 用户发来图片（课表、通知、截图）时，图片就是依据。用户只问图里有什么时，照实描述，再问要不要导入。
   用户要你导入，或在你问过之后说「好的」，调用 import_from_image，把图上的固定日程（event）和待办（task）
   一次放进 items，每条摘抄图上对应的原文作 basis。看不清的日期、时刻留空，不要猜。冲突照实说出，由用户决定。

语气：简短、平和、像同一个村子里的人说话。不要用「亲」「~」这类语气词，也不要用列表堆砌废话。
一次回答最多三四句话。用户是用中文跟你说话的，除非他用别的语言，否则一律用中文回答。
"""


WEEKDAYS = "一二三四五六日"


def turn_context(now: datetime, timezone: str) -> str:
    """The facts the model cannot know by itself: what time it is, and in which zone the user lives.

    Without this the model has no way to turn「明天」into a date. The zone is the one the user's device
    reported for this turn; it is the user's own context, not a default the server invents.
    """
    try:
        local = now.astimezone(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        local, timezone = now.astimezone(UTC), "UTC"
    return (f"现在是 {local:%Y-%m-%d} 星期{WEEKDAYS[local.weekday()]} {local:%H:%M}"
            f"（{timezone}，当前时刻 {local.isoformat(timespec='minutes')}）。"
            f"用户设备所在时区是 {timezone}。用户说「今天」「明天」「下周三」等相对日期时，按这个时刻换算成具体日期；"
            f"用户没有提到别的时区时，timezone 填 {timezone}，start_at 和 end_at 写成带时区偏移的 ISO 8601。"
            "只换算用户说过的日期和时刻，没说的钟点仍然不要补。")


def draft_notice(status: str, missing: tuple[str, ...]) -> str:
    """Server-authored sentence describing the draft. The client shows it above the confirmation card."""
    if status == "needs_clarification":
        labels = {"title": "标题", "timezone": "时区", "start_at": "开始时间", "end_at": "结束时间"}
        waiting = "、".join(labels.get(item, item) for item in missing)
        return f"我已经记下你说到的部分，还缺：{waiting}。补齐之后才可以保存。"
    return "这是整理好的草稿，核对无误后点「确认保存」才会写进日程。"


def change_notice(kind: str) -> str:
    button = {"change": "确认修改", "cancel": "确认删除", "excuse": "确认请假",
              "task_change": "确认修改", "task_cancel": "确认取消"}.get(kind, "确认")
    thing = "任务" if kind in ("task_change", "task_cancel") else "日程"
    return f"这是改动草稿，{thing}还没有变。核对「原来」和「改为」无误后点「{button}」才会生效。"


def task_draft_notice(status: str, kind: str, missing: tuple[str, ...]) -> str:
    """Sentence shown above a flexible-task card. Create-with-gaps asks; change/cancel confirm."""
    if kind in ("task_change", "task_cancel"):
        return change_notice(kind)
    if status == "needs_clarification":
        labels = {"title": "标题", "timezone": "时区"}
        waiting = "、".join(labels.get(item, item) for item in missing)
        return f"我已经记下你说到的部分，还缺：{waiting}。补齐之后才可以保存。"
    return "这是整理好的任务草稿，核对无误后点「确认保存」才会存成待办。"


def batch_notice(items: "Sequence[BatchItem]") -> str:
    ready = sum(1 for item in items if item.selectable)
    waiting = len(items) - ready
    tail = f"，另有 {waiting} 条看不清时间、需要补全" if waiting else ""
    return (f"从图片里整理出 {len(items)} 条，{ready} 条可以直接保存{tail}。卡片上默认全选，"
            "取消不要的再点「保存所选」才会写入。")


NO_BASIS_NOTICE = "我没有在你说的话里找到这条安排的依据，所以没有生成草稿。请直接说出时间、时长和要做的事，我再整理。"
REJECTED_NOTICE = "这条请求我没有执行：{reason}。你可以换个说法再说一次。"
NO_MODEL_NOTICE = "助手现在没有配置模型，暂时不能对话。"


def summarize_tool_result(name: str, status: str, data: object) -> str:
    """Short human-readable line for the transcript. The full data stays in the turn response."""
    if status != "ok":
        return f"{name}：{data}"
    if name in ("create_rigid_event_draft", "propose_event_change", "propose_event_cancel",
                "propose_event_excuse", "create_flexible_task_draft", "propose_task_change",
                "propose_task_cancel", "import_from_image"):
        return "已生成待确认草稿"
    if name == "query_rigid_events":
        count = len(data) if isinstance(data, list) else 0
        return f"查到 {count} 条固定日程"
    if name == "query_flexible_tasks":
        count = len(data) if isinstance(data, list) else 0
        return f"查到 {count} 条柔性任务"
    if name == "query_weather":
        return f"查到天气：{data}"
    return name


def fallback_answer(outcomes: "Sequence[ToolOutcome]") -> str:
    """What to say when the model gave tool calls but no text of its own."""
    if not outcomes:
        return "我在听。你可以直接说要安排什么，或者问你这周的固定日程、某个城市的天气。"
    last = outcomes[-1]
    if last.status == "ok":
        return summarize_tool_result(last.name, last.status, last.data)
    return f"这次没有做成：{last.data}"
