"""A scripted stand-in for the language model. Counts calls so tests can prove 'no model was used'."""

from collections.abc import Sequence
from typing import Any

from kairos.application.assistant.model import ModelError, ModelMessage, ModelTurn, ToolCall, ToolSchema


def call(name: str, **arguments: Any) -> ToolCall:
    return ToolCall(f"call_{name}", name, arguments)


class FakeModel:
    def __init__(self) -> None:
        self.script: list[ModelTurn] = []
        self.calls = 0
        self.seen: list[list[ModelMessage]] = []
        self.fail = False

    def then(self, text: str = "", *calls: ToolCall) -> "FakeModel":
        self.script.append(ModelTurn(text, tuple(calls)))
        return self

    def complete(self, messages: Sequence[ModelMessage], tools: Sequence[ToolSchema]) -> ModelTurn:
        self.calls += 1
        self.seen.append(list(messages))
        if self.fail:
            raise ModelError("模型服务暂时繁忙，请稍后再试")
        if not self.script:
            return ModelTurn("好的。")
        return self.script.pop(0)
