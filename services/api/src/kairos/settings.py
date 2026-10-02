"""Runtime settings from the environment (services/api/.env is loaded by the launcher, never committed).

The MiMo key is read here and nowhere else. It stays inside the process: it is never sent to the
browser, never logged, and never part of an error message.
"""

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MIMO_BASE_URL = "https://api.xiaomimimo.com/v1"
DEFAULT_MIMO_MODEL = "mimo-v2.6-pro"


@dataclass(frozen=True)
class Settings:
    database_path: Path
    owner_id: str
    host: str
    port: int
    mimo_api_key: str = ""
    mimo_base_url: str = DEFAULT_MIMO_BASE_URL
    mimo_model: str = DEFAULT_MIMO_MODEL

    @property
    def assistant_configured(self) -> bool:
        """No key means no assistant. The rest of the app is unaffected and still serves."""
        return bool(self.mimo_api_key.strip())

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(__file__).resolve().parents[2]
        return cls(
            database_path=Path(os.environ.get("KAIROS_DB", root / "var" / "kairos.sqlite3")),
            owner_id=os.environ.get("KAIROS_OWNER", "local"),
            host=os.environ.get("KAIROS_HOST", "127.0.0.1"),
            port=int(os.environ.get("KAIROS_PORT", "8000")),
            mimo_api_key=os.environ.get("MIMO_API_KEY", ""),
            mimo_base_url=os.environ.get("MIMO_BASE_URL", DEFAULT_MIMO_BASE_URL),
            mimo_model=os.environ.get("MIMO_MODEL", DEFAULT_MIMO_MODEL),
        )
