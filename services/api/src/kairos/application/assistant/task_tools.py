"""Tool schemas for flexible tasks, kept apart from the event whitelist so neither file grows unbounded.

A flexible task has a title and maybe a deadline, never a slot, so these schemas carry no start/end
time and no recurrence. The read tool mirrors `query_rigid_events`: it is the only way a change or
cancel can name a task this turn (M3 plan §2.3 rule 5), so it too demands a quoted basis.
"""

from kairos.application.assistant.limits import MAX_BASIS_FRAGMENTS
from kairos.application.assistant.model import ToolSchema
from kairos.application.assistant.task_proposals import (
    CREATE_TASK_DRAFT,
    PROPOSE_TASK_CANCEL,
    PROPOSE_TASK_CHANGE,
)

QUERY_FLEXIBLE_TASKS = "query_flexible_tasks"

TASK_READ_TOOLS = frozenset({QUERY_FLEXIBLE_TASKS})
TASK_KNOWN_TOOLS = TASK_READ_TOOLS | frozenset(
    {CREATE_TASK_DRAFT, PROPOSE_TASK_CHANGE, PROPOSE_TASK_CANCEL})

_TASK_TARGET = {"type": "string",
                "description": "本轮 query_flexible_tasks 结果里那条柔性任务的 task_id，原样填写"}
_TASK_BASIS = {"type": "array", "minItems": 1, "maxItems": MAX_BASIS_FRAGMENTS,
               "items": {"type": "string"},
               "description": "用户原话里提出这件事的片段，每段原样摘抄"}
_DEADLINE = {"type": "string",
             "description": "ISO 8601 带时区偏移的截止时刻，用户没说截止就不要填"}
_PRECISION = {"type": "string", "enum": ["date", "instant"],
              "description": "用户只说到某天用 date，说了具体钟点才用 instant"}

TASK_SCHEMAS: tuple[ToolSchema, ...] = (
    ToolSchema(
        name=QUERY_FLEXIBLE_TASKS,
        description=("只读查询用户自己的柔性任务（没有固定时间、要抽空完成的事）。用户问起他的待办、"
                     "或要修改、取消某件事前找到那一条时使用。要修改或取消前必须先用它查到。"),
        parameters={
            "type": "object",
            "properties": {
                "basis_phrase": {"type": "string", "description": "用户原话里请求这次查询的片段，原样摘抄"},
            },
            "required": ["basis_phrase"],
        },
    ),
    ToolSchema(
        name=CREATE_TASK_DRAFT,
        description=(
            "把用户说出的、没有固定时间的待办整理成一份待确认草稿。这不会创建任务，只生成一份需要用户点"
            "「确认保存」的草稿。标题要用用户说出的事，含糊时先问「具体做什么」，不要自己编。"
            "用户没说截止时间就不要填 deadline。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "用户说出的事，例如 背单词、写操作系统实验"},
                "timezone": {"type": "string", "description": "IANA 时区名"},
                "deadline": _DEADLINE,
                "precision": _PRECISION,
                "basis_phrases": _TASK_BASIS,
            },
            "required": ["basis_phrases"],
        },
    ),
    ToolSchema(
        name=PROPOSE_TASK_CHANGE,
        description=("为一条已保存的柔性任务生成一份修改草稿，用户点「确认修改」才会生效。必须先用 "
                     "query_flexible_tasks 查到这条任务。只填用户要改的字段，没提到的不要填。"),
        parameters={"type": "object", "properties": {
            "task_id": _TASK_TARGET,
            "title": {"type": "string", "description": "新的标题，用户没说要改就不要填"},
            "deadline": _DEADLINE, "precision": _PRECISION,
            "basis_phrases": _TASK_BASIS},
            "required": ["task_id", "basis_phrases"]},
    ),
    ToolSchema(
        name=PROPOSE_TASK_CANCEL,
        description=("为一条已保存的柔性任务生成一份取消草稿，用户点「确认取消」才会生效。必须先用 "
                     "query_flexible_tasks 查到这条任务。"),
        parameters={"type": "object", "properties": {
            "task_id": _TASK_TARGET, "basis_phrases": _TASK_BASIS},
            "required": ["task_id", "basis_phrases"]},
    ),
)
