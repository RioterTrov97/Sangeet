import os
import secrets
from pathlib import Path


def load_or_create_token(data_dir: Path) -> tuple[str, bool]:
    """Returns (token, created). Order: SANGEET_TOKEN env, data/token file, else generate and save (mode 0600)."""
    env = os.environ.get("SANGEET_TOKEN", "").strip()
    if env:
        return env, False
    f = data_dir / "token"
    if f.exists():
        return f.read_text().strip(), False
    data_dir.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    f.write_text(token)
    f.chmod(0o600)
    return token, True
