"""The assistant's use cases: run a turn, and read back what happened.

Ordering rules that exist for a reason:

1. The model call happens *between* two transactions. SQLite holds its write lock while reserving a
   turn and while completing it, never across a network call.
2. Reading never runs anything. `history` and `draft_view` only read, so a refresh cannot re-fire a
   tool, re-query the weather or move anything.
3. A reserved-but-unfinished turn stays pending. Retrying the same client message ID resumes it
   instead of starting a second one, so a crashed request is recoverable.
"""

import json
from collections.abc import Sequence
from datetime import datetime
from hashlib import sha256
from typing import Any
from uuid import uuid4

from kairos.domain.conversation import Conversation, ConversationMessage, ConversationTurn
from kairos.domain.draft import (
    DRAFT_TTL,
    Draft,
    DraftFields,
    DraftKind,
    DraftStatus,
    Target,
    compute_digest,
    initial_status,
    parse_fields,
)

from ..errors import (
    AssistantUnavailable,
    ConversationConflict,
    NotFound,
    VersionConflict,
)
from ..ports import Clock, PendingTurnError, UnitOfWork, UnitOfWorkFactory
from ..weather import WeatherService
from . import changes
from . import tools as whitelist
from .context import MAX_CONTEXT_MESSAGES as MAX_CONTEXT_MESSAGES
from .context import build_context as build_context
from .conversation_types import MessagePage, ToolOutcome, TurnResult
from .model import AssistantModel, ModelError, ModelMessage, ToolCall, ToolSchema
from .prompts import SYSTEM_PROMPT, change_notice, draft_notice, summarize_tool_result, turn_context
from .queries import query_events, query_tasks, query_weather
from .task_proposals import TASK_WRITE_TOOLS
from .task_tools import QUERY_FLEXIBLE_TASKS
from .task_turn import plan_task_draft

MAX_CONTENT_CHARS = 4_000
MAX_CLIENT_MESSAGE_ID = 200
PAGE_SIZE = 100


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _hash(parts: Sequence[str]) -> str:
    return sha256("\x1f".join(parts).encode()).hexdigest()


def _message_json(message: ConversationMessage) -> dict[str, Any]:
    return {"message_id": message.message_id, "sequence": message.sequence, "role": message.role,
            "content": message.content, "created_at": message.created_at.isoformat(),
            "action_results": list(message.action_results), "draft_id": message.draft_id}


class AssistantService:
    def __init__(self, uow: UnitOfWorkFactory, clock: Clock, model: AssistantModel | None = None,
                 weather: WeatherService | None = None) -> None:
        self._uow = uow
        self._clock = clock
        self._model = model
        self._weather = weather

    # ------------------------------------------------------------------ reading

    def start(self, owner_id: str) -> dict[str, Any]:
        """A new conversation. Nothing carries over from the previous one."""
        now = self._clock.now()
        conversation = Conversation(_id("cnv"), owner_id, 0, now, now)
        with self._uow(write=True) as uow:
            uow.conversations.create(conversation)
            uow.audit.record(owner_id, "conversation_started", conversation.conversation_id, now)
            uow.commit()
        return {"conversation_id": conversation.conversation_id, "revision": conversation.revision}

    def history(self, owner_id: str, conversation_id: str, cursor: int = -1) -> MessagePage:
        """Read-only: restores the transcript, the unfinished turn and the current draft.

        `cursor` is the last sequence the client already has; -1 means from the start.
        """
        now = self._clock.now()
        with self._uow(write=False) as uow:
            conversation = self._require(uow, owner_id, conversation_id)
            page = uow.messages.after(owner_id, conversation_id, cursor, PAGE_SIZE + 1)
            more = len(page) > PAGE_SIZE
            items = tuple(_message_json(item) for item in page[:PAGE_SIZE])
            pending = uow.turns.pending_client_message_id(owner_id, conversation_id)
            draft = uow.drafts.newest(owner_id, conversation_id)
            draft_json = self._draft_json(draft, now) if draft else None
        return MessagePage(conversation_id, conversation.revision, items,
                           page[PAGE_SIZE - 1].sequence if more else None, pending, draft_json)

    def draft_view(self, owner_id: str, draft_id: str) -> dict[str, Any]:
        """The authority on a draft's state. A confirmation must read this, not old conversation text."""
        now = self._clock.now()
        with self._uow(write=False) as uow:
            draft = uow.drafts.get(owner_id, draft_id)
            if draft is None:
                raise NotFound("draft not found")
            return self._draft_json(draft, now)

    # ------------------------------------------------------------------ a turn

    def send(self, owner_id: str, conversation_id: str, client_message_id: str, content: str,
             timezone: str, expected_revision: int) -> TurnResult:
        content = content.strip()
        if not content or len(content) > MAX_CONTENT_CHARS:
            raise ConversationConflict(f"内容长度必须是 1..{MAX_CONTENT_CHARS} 字")
        if not client_message_id or len(client_message_id) > MAX_CLIENT_MESSAGE_ID:
            raise ConversationConflict(f"client_message_id 长度必须是 1..{MAX_CLIENT_MESSAGE_ID}")
        if self._model is None:
            raise AssistantUnavailable("no model is configured")
        request_hash = _hash((content, timezone, str(expected_revision)))
        replay, turn = self._reserve(owner_id, conversation_id, client_message_id, content, request_hash,
                                     timezone, expected_revision)
        if replay is not None:
            return replay
        assert turn is not None
        try:
            return self._run_turn(owner_id, conversation_id, turn)
        except ModelError as error:
            # The turn stays pending on purpose: the same client message ID can retry it.
            raise AssistantUnavailable(str(error)) from error

    def _reserve(self, owner_id: str, conversation_id: str, client_message_id: str, content: str,
                 request_hash: str, timezone: str, expected_revision: int
                 ) -> tuple[TurnResult | None, ConversationTurn | None]:
        now = self._clock.now()
        with self._uow(write=True) as uow:
            conversation = self._require(uow, owner_id, conversation_id)
            stored = uow.turns.find(owner_id, conversation_id, client_message_id)
            if stored is not None:
                if stored.request_hash != request_hash:
                    raise ConversationConflict("这个 client message ID 已经用在别的内容上了")
                if stored.status == "completed":
                    if stored.response is None:
                        raise ConversationConflict("这一轮没有存下结果")
                    return TurnResult.from_json(stored.response), None
                # Pending: resume the same turn. Its user message is already stored.
                return None, stored
            if conversation.revision != expected_revision:
                raise VersionConflict("对话进度已经变化，请先刷新")
            turn = ConversationTurn(
                owner_id=owner_id, conversation_id=conversation_id, client_message_id=client_message_id,
                user_message_id=_id("msg"), request_hash=request_hash, content=content, timezone=timezone,
                expected_revision=expected_revision, status="pending", created_at=now)
            if uow.turns.pending_client_message_id(owner_id, conversation_id) is not None:
                raise ConversationConflict("上一条消息还没有处理完，请用同一个 client_message_id 重试")
            # The turn row references the user message, so the message goes in first.
            uow.messages.append(ConversationMessage(
                message_id=turn.user_message_id, owner_id=owner_id, conversation_id=conversation_id,
                sequence=self._next_sequence(uow, owner_id, conversation_id), role="user", content=content,
                created_at=now))
            try:
                uow.turns.reserve(turn)
            except PendingTurnError as error:
                raise ConversationConflict(str(error)) from error
            uow.conversations.bump(conversation_id, conversation.revision, now)
            uow.commit()
            return None, turn

    def _run_turn(self, owner_id: str, conversation_id: str, turn: ConversationTurn) -> TurnResult:
        assert self._model is not None
        now = self._clock.now()
        with self._uow(write=False) as uow:
            history = uow.messages.tail(owner_id, conversation_id, MAX_CONTEXT_MESSAGES * 2)
        # Anchored to when the user spoke, so a resumed turn reads「明天」the same way.
        context: list[ModelMessage] = [ModelMessage("system", SYSTEM_PROMPT),
                                       ModelMessage("system", turn_context(turn.created_at, turn.timezone))]
        context.extend(ModelMessage("user" if item.role == "user" else "assistant", item.content)
                       for item in build_context(history))
        user_texts = [item.content for item in context if item.role == "user"]

        outcomes: list[ToolOutcome] = []
        draft: Draft | None = None
        answer = ""
        used = 0
        tools: Sequence[ToolSchema] = whitelist.SCHEMAS
        # Looked up this turn; only these may be changed. Events key on occurrence → (event, slot),
        # tasks on task_id → version, kept apart so the two cannot be confused.
        queried: dict[str, tuple[str, str]] = {}
        queried_tasks: dict[str, int] = {}
        for _round in range(whitelist.MAX_MODEL_ROUNDS):
            model_turn = self._model.complete(context, tools)
            if model_turn.text.strip():
                answer = model_turn.text.strip()
            if not model_turn.tool_calls:
                break
            context.append(ModelMessage("assistant", model_turn.text, model_turn.tool_calls))
            for call in model_turn.tool_calls:
                if used >= whitelist.MAX_TURN_TOOL_CALLS:
                    outcomes.append(ToolOutcome(call.name, "rejected", "一轮里工具调用太多"))
                    continue
                used += 1
                if draft is not None and call.name in whitelist.WRITE_TOOLS:
                    outcomes.append(ToolOutcome(call.name, "rejected", "这一轮已经生成了一份待确认草稿"))
                    continue
                outcome, created = self._execute(owner_id, conversation_id, turn, call, user_texts,
                                                 queried, queried_tasks, now)
                outcomes.append(outcome)
                if created is not None:
                    draft = created
                context.append(ModelMessage("tool", json.dumps(outcome.to_json(), ensure_ascii=False),
                                            tool_call_id=call.call_id))
        if not answer:
            answer = self._fallback_answer(outcomes)
        return self._complete(owner_id, conversation_id, turn, answer, outcomes, draft, now)

    def _execute(self, owner_id: str, conversation_id: str, turn: ConversationTurn, call: ToolCall,
                 user_texts: Sequence[str], queried: dict[str, tuple[str, str]],
                 queried_tasks: dict[str, int], now: datetime) -> tuple[ToolOutcome, Draft | None]:
        if call.name not in whitelist.KNOWN_TOOLS:
            return ToolOutcome(call.name, "rejected", "不在允许的工具清单里"), None
        args, problem = whitelist.decode_arguments(call)
        if args is None:
            return ToolOutcome(call.name, "rejected", problem or "参数无法解析"), None
        if call.name in whitelist.WRITE_TOOLS:
            fragments, problem = whitelist.basis_fragments(args)
            if fragments is None:
                return ToolOutcome(call.name, "rejected", problem or "缺少依据"), None
            missing = whitelist.fragments_problem(fragments, user_texts)
            if missing is not None:
                return ToolOutcome(call.name, "rejected", missing), None
            changing = call.name in whitelist.CHANGE_TOOLS
            reason = changes.veto_reason(turn.content) if changing else whitelist.veto_reason(turn.content)
            if reason is not None:
                return ToolOutcome(call.name, "rejected", reason), None
            if call.name in TASK_WRITE_TOOLS:
                return self._create_task_draft(owner_id, conversation_id, turn, call.name, args, fragments,
                                               queried_tasks, now)
            if changing:
                return self._propose_change(owner_id, conversation_id, turn, call.name, args, fragments,
                                            queried, now)
            return self._create_draft(owner_id, conversation_id, turn, args, fragments, now)
        # Every read tool must quote a basis, same as a write; a query is not exempt from provenance.
        phrase = args.get("basis_phrase")
        if not isinstance(phrase, str):
            return ToolOutcome(call.name, "rejected", "缺少 basis_phrase，无法核对依据"), None
        missing = whitelist.basis_problem(phrase, user_texts)
        if missing is not None:
            return ToolOutcome(call.name, "rejected", missing), None
        if call.name == QUERY_FLEXIBLE_TASKS:
            with self._uow(write=False) as uow:
                outcome, seen_tasks = query_tasks(uow, owner_id, now)
            queried_tasks.update(seen_tasks)
            return outcome, None
        if call.name == whitelist.QUERY_RIGID_EVENTS:
            with self._uow(write=False) as uow:
                outcome, seen = query_events(uow, owner_id, args, now)
            queried.update(seen)
            return outcome, None
        return query_weather(self._weather, args), None

    def _create_task_draft(self, owner_id: str, conversation_id: str, turn: ConversationTurn, tool: str,
                           args: dict[str, Any], fragments: Sequence[str], queried_tasks: dict[str, int],
                           now: datetime) -> tuple[ToolOutcome, Draft | None]:
        with self._uow(write=False) as uow:
            plan, problem = plan_task_draft(uow, owner_id, tool, args, fragments, queried_tasks)
        if plan is None:
            return ToolOutcome(tool, "rejected", problem or "无法生成任务草稿"), None
        draft = self._store_draft(owner_id, conversation_id, turn, plan.fields, fragments, plan.status, now,
                                  plan.kind, plan.target)
        return ToolOutcome(tool, "ok", plan.notice, draft_id=draft.draft_id), draft

    def _create_draft(self, owner_id: str, conversation_id: str, turn: ConversationTurn, args: dict[str, Any],
                      fragments: Sequence[str], now: datetime) -> tuple[ToolOutcome, Draft | None]:
        # Anything that failed to parse is left unset, so the draft asks instead of guessing.
        fields, problems = parse_fields(args)
        unbacked = whitelist.time_basis_problem(fields, fragments)
        if unbacked is not None:
            return ToolOutcome(whitelist.CREATE_RIGID_EVENT_DRAFT, "rejected", unbacked), None
        status = initial_status(fields)
        draft = self._store_draft(owner_id, conversation_id, turn, fields, fragments, status, now)
        notice = draft_notice(status, fields.missing())
        if problems:
            notice = f"{notice}（{'；'.join(problems)}）"
        return ToolOutcome(whitelist.CREATE_RIGID_EVENT_DRAFT, "ok", notice, draft_id=draft.draft_id), draft

    def _propose_change(self, owner_id: str, conversation_id: str, turn: ConversationTurn, tool: str,
                        args: dict[str, Any], fragments: Sequence[str], queried: dict[str, tuple[str, str]],
                        now: datetime) -> tuple[ToolOutcome, Draft | None]:
        with self._uow(write=False) as uow:
            proposal, problem = changes.propose(uow, owner_id, tool, args, fragments, queried)
        if proposal is None:
            return ToolOutcome(tool, "rejected", problem or "无法生成改动草稿"), None
        draft = self._store_draft(owner_id, conversation_id, turn, proposal.fields, fragments, "ready", now,
                                  proposal.kind, proposal.target)
        return ToolOutcome(tool, "ok", change_notice(proposal.kind), draft_id=draft.draft_id), draft

    def _store_draft(self, owner_id: str, conversation_id: str, turn: ConversationTurn, fields: DraftFields,
                     fragments: Sequence[str], status: DraftStatus, now: datetime, kind: DraftKind = "create",
                     target: Target | None = None) -> Draft:
        phrase = whitelist.BASIS_JOINER.join(fragments)
        draft_id = _id("drf")
        draft = Draft(draft_id=draft_id, owner_id=owner_id, conversation_id=conversation_id,
                      source_message_id=turn.user_message_id, status=status,
                      digest=compute_digest(draft_id, fields, phrase, kind, target), anchor_at=turn.created_at,
                      expires_at=now + DRAFT_TTL, basis_phrase=phrase, fields=fields, created_at=now,
                      updated_at=now, kind=kind, target=target)
        with self._uow(write=True) as uow:
            previous = uow.drafts.live(owner_id, conversation_id)
            if previous is not None:
                uow.drafts.supersede(owner_id, previous.draft_id, draft_id, now)
            uow.drafts.add(draft)
            uow.audit.record(owner_id, "draft_created", draft_id, now)
            uow.commit()
        return draft

    def _complete(self, owner_id: str, conversation_id: str, turn: ConversationTurn, answer: str,
                  outcomes: Sequence[ToolOutcome], draft: Draft | None, now: datetime) -> TurnResult:
        with self._uow(write=True) as uow:
            conversation = self._require(uow, owner_id, conversation_id)
            assistant = ConversationMessage(
                message_id=_id("msg"), owner_id=owner_id, conversation_id=conversation_id,
                sequence=self._next_sequence(uow, owner_id, conversation_id), role="assistant",
                content=answer, created_at=now,
                action_results=tuple(item.to_json() for item in outcomes),
                draft_id=draft.draft_id if draft else None)
            uow.messages.append(assistant)
            revision = conversation.revision + 1
            result = TurnResult(conversation_id=conversation_id, revision=revision,
                                user_message_id=turn.user_message_id,
                                assistant_message_id=assistant.message_id, answer=answer,
                                tool_results=tuple(outcomes),
                                draft=self._draft_json(draft, now) if draft else None)
            uow.turns.complete(turn, assistant, result.to_json())
            uow.conversations.bump(conversation_id, conversation.revision, now)
            uow.commit()
        return result

    @staticmethod
    def _next_sequence(uow: UnitOfWork, owner_id: str, conversation_id: str) -> int:
        latest = uow.messages.latest(owner_id, conversation_id)
        return 0 if latest is None else latest.sequence + 1

    @staticmethod
    def _fallback_answer(outcomes: Sequence[ToolOutcome]) -> str:
        if not outcomes:
            return "我在听。你可以直接说要安排什么，或者问你这周的固定日程、某个城市的天气。"
        last = outcomes[-1]
        if last.status == "ok":
            return summarize_tool_result(last.name, last.status, last.data)
        return f"这次没有做成：{last.data}"

    @staticmethod
    def _require(uow: UnitOfWork, owner_id: str, conversation_id: str) -> Conversation:
        conversation = uow.conversations.get(owner_id, conversation_id)
        if conversation is None:
            raise NotFound("conversation not found")
        return conversation

    @staticmethod
    def _draft_json(draft: Draft, now: datetime) -> dict[str, Any]:
        payload = draft.to_json()
        payload["expired"] = draft.expired(now)
        payload["confirmable"] = draft.confirmable(now)
        return payload


__all__ = ["AssistantService", "MessagePage", "ToolOutcome", "TurnResult", "build_context"]
