"""Which part of the transcript the model may see."""

from collections.abc import Sequence

from kairos.domain.conversation import ConversationMessage

from ..errors import ContextTooLarge

MAX_CONTEXT_MESSAGES = 24
MAX_CONTEXT_CHARS = 32_000


def build_context(messages: Sequence[ConversationMessage]) -> list[ConversationMessage]:
    """The tail of the transcript the model may see.

    Newest-first walk bounded by both limits, then snapped forward to a user message so the model
    never sees a reply whose question was cut off. The most recent user message is kept regardless,
    because dropping the sentence the user just typed would answer the wrong question.
    """
    kept: list[ConversationMessage] = []
    total = 0
    for message in reversed(messages):
        size = len(message.content)
        if kept and (len(kept) >= MAX_CONTEXT_MESSAGES or total + size > MAX_CONTEXT_CHARS):
            break
        kept.append(message)
        total += size
    kept.reverse()
    while kept and kept[0].role != "user":
        kept.pop(0)
    latest_user = next((item for item in reversed(messages) if item.role == "user"), None)
    if latest_user is not None:
        if len(latest_user.content) > MAX_CONTEXT_CHARS:
            raise ContextTooLarge("这条消息太长，请分成几次说")
        if all(item.message_id != latest_user.message_id for item in kept):
            kept = [latest_user]
    return kept
