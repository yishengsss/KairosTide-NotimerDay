"""Developer commands. `seed` goes through the application layer, never raw SQL."""

import argparse
import json
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from kairos.adapters.clock import SystemClock
from kairos.adapters.sqlite.database import migrate
from kairos.adapters.sqlite.unit_of_work import SqliteUnitOfWorkFactory
from kairos.application.events import EventService
from kairos.settings import Settings


def _offset(text: str) -> timedelta:
    match = re.fullmatch(r"(-?\d+)([smh])", text)
    if not match:
        raise argparse.ArgumentTypeError("use e.g. 6m, 30s, 1h, -2m")
    value, unit = int(match.group(1)), match.group(2)
    return timedelta(seconds=value * {"s": 1, "m": 60, "h": 3600}[unit])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kairos-dev")
    sub = parser.add_subparsers(dest="command", required=True)
    seed = sub.add_parser("seed", help="create a one-off rigid event relative to now")
    seed.add_argument("--in", dest="start_in", type=_offset, default=timedelta(minutes=6),
                      help="offset from now, e.g. 6m; write negative offsets as --in=-2m")
    seed.add_argument("--minutes", type=int, default=20)
    seed.add_argument("--title", default="高数课")
    seed.add_argument("--location", default="教三 204")
    seed.add_argument("--timezone", default="Asia/Shanghai")
    export = sub.add_parser("openapi", help="write the OpenAPI document")
    export.add_argument("output", type=Path)
    args = parser.parse_args(argv)

    if args.command == "openapi":
        from kairos.bootstrap import create_app

        settings = Settings(Path(":memory:"), "local", "127.0.0.1", 0)
        document = create_app(settings).openapi()
        args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                               encoding="utf-8")
        return 0

    settings = Settings.from_env()
    migrate(settings.database_path)
    start = (datetime.now(UTC) + args.start_in).replace(microsecond=0)
    series = EventService(SqliteUnitOfWorkFactory(settings.database_path), SystemClock()).create(
        settings.owner_id, args.title, args.location, args.timezone, start, start + timedelta(minutes=args.minutes))
    print(f"{series.event_id} {series.title} {series.start_at.isoformat()} → {series.end_at.isoformat()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
