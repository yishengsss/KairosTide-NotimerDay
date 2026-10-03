"""M4 Wave 1: an image reaches the model for one turn, is the basis there, and never reaches SQLite."""

import base64
import sqlite3
from io import BytesIO
from typing import Any

from PIL import Image

from tests.conftest import Harness
from tests.fake_model import call
from tests.integration.test_assistant_api import API, start

CREATE = "create_flexible_task_draft"
ZONE = "Asia/Shanghai"


def _png() -> str:
    out = BytesIO()
    Image.new("RGB", (32, 16), (10, 120, 200)).save(out, format="PNG")
    return base64.b64encode(out.getvalue()).decode()


def post(h: Harness, text: str, image: dict[str, str] | None = None) -> Any:
    conversation_id = start(h)
    body: dict[str, Any] = {"client_message_id": "m1", "content": text, "timezone": ZONE, "expected_revision": 0}
    if image is not None:
        body["image"] = image
    return h.client.post(f"{API}/conversations/{conversation_id}/messages", json=body)


def png_image() -> dict[str, str]:
    return {"mime_type": "image/png", "data_base64": _png()}


def test_the_image_reaches_the_model_and_not_storage(harness: Harness) -> None:
    image = png_image()
    response = post(harness, "这张图里有什么", image)
    assert response.status_code == 200, response.text
    last = harness.model.seen[0][-1]
    part = last.to_json()["content"][0]
    assert part["type"] == "image_url" and part["image_url"]["url"].startswith("data:image/png;base64,")
    assert "redacted" in repr(last) and "base64" not in repr(last)
    with sqlite3.connect(harness.path) as db:
        dump = "\n".join(db.iterdump())
    assert "data:image" not in dump and image["data_base64"][:40] not in dump


def test_an_invalid_image_is_rejected_before_the_model(harness: Harness) -> None:
    response = post(harness, "看看", {"mime_type": "image/png", "data_base64": "bm90IGFuIGltYWdl"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert harness.model.calls == 0


def test_the_image_is_the_basis_on_an_image_turn(harness: Harness) -> None:
    harness.model.then("", call(CREATE, title="交实验报告", timezone=ZONE, basis_phrases=["实验报告 周五交"]))
    draft = post(harness, "帮我导入", png_image()).json()["draft"]
    assert draft is not None and draft["kind"] == "task_create"
    assert draft["basis_phrase"].startswith("来自图片：")


def test_without_an_image_the_quote_must_be_the_users(harness: Harness) -> None:
    harness.model.then("", call(CREATE, title="交实验报告", timezone=ZONE, basis_phrases=["实验报告 周五交"]))
    assert post(harness, "帮我导入").json()["draft"] is None


IMPORT = "import_from_image"
ITEMS = [
    {"kind": "event", "title": "组会", "start_at": "2026-10-13T14:30:00+08:00",
     "end_at": "2026-10-13T15:30:00+08:00", "basis": "周二 14:30 组会"},
    {"kind": "task", "title": "交实验报告", "deadline": "2026-10-16T23:59:59+08:00", "precision": "date",
     "basis": "周五前交实验报告"},
    {"kind": "event", "title": "讲座", "basis": "讲座（时间待定）"},
]


def batch(h: Harness, text: str = "帮我导入") -> Any:
    h.model.then("", call(IMPORT, timezone=ZONE, items=ITEMS))
    return post(h, text, png_image()).json()


def commit_batch(h: Harness, draft: dict[str, Any], selected: list[int], key: str = "c1",
                 token: str | None = None) -> Any:
    body: dict[str, Any] = {"digest": draft["digest"], "selected": selected}
    if token:
        body["conflict_acceptance"] = token
    return h.client.post(f"{API}/drafts/{draft['draft_id']}/commit", json=body, headers={"Idempotency-Key": key})


def test_an_import_is_one_batch_card_and_writes_nothing_yet(harness: Harness) -> None:
    draft = batch(harness)["draft"]
    assert draft["kind"] == "batch" and len(draft["items"]) == 3
    assert draft["items"][2]["missing"] == ["start_at", "end_at"]
    assert harness.client.get(f"{API}/tasks").json()["items"] == []


def test_a_bare_question_about_an_image_cannot_import(harness: Harness) -> None:
    body = batch(harness, "这张图里写了什么")
    assert body["draft"] is None and body["tool_results"][0]["status"] == "rejected"


def test_only_ticked_complete_items_are_saved(harness: Harness) -> None:
    draft = batch(harness)["draft"]
    assert commit_batch(harness, draft, [0, 2]).status_code == 409
    response = commit_batch(harness, draft, [1], key="c2")
    assert response.status_code == 200, response.text
    assert len(response.json()["saved_ids"]) == 1
    [task] = harness.client.get(f"{API}/tasks").json()["items"]
    assert task["title"] == "交实验报告"


def test_conflicts_are_previewed_and_reviewed_before_saving(harness: Harness) -> None:
    from tests.integration.test_assistant_changes import seed_single
    seed_single(harness)
    body = batch(harness)
    assert body["tool_results"][0]["data"]["conflicts"][0]["overlaps"] == "组会"
    draft = body["draft"]
    first = commit_batch(harness, draft, [0, 1])
    assert first.status_code == 409
    token = first.json()["error"]["acceptance_token"]
    assert commit_batch(harness, draft, [0], key="c2", token=token).status_code == 409
    saved = commit_batch(harness, draft, [0, 1], key="c3", token=token)
    assert saved.status_code == 200, saved.text
    assert len(saved.json()["saved_ids"]) == 2
