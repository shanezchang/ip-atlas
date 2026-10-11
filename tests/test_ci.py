"""Keep the existing release check immutable and read-only."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_ci_actions_are_pinned_and_checkout_does_not_keep_credentials():
    workflow = (ROOT / ".github/workflows/check.yml").read_text()
    uses = re.findall(r"uses:\s*([^\s#]+)", workflow)
    assert len(uses) == 3
    assert all(re.fullmatch(r"[\w-]+/[\w-]+@[0-9a-f]{40}", action) for action in uses)
    assert "persist-credentials: false" in workflow
    assert "permissions:\n  contents: read\n" in workflow
    assert not re.search(r"\b(?:write|write-all)\b", workflow)
    # The cloud deployment gate refers to this exact check-run name.
    assert "jobs:\n  check:\n" in workflow


def test_ci_uses_locked_installs_and_checks_the_production_browser_build():
    workflow = (ROOT / ".github/workflows/check.yml").read_text()
    for command in (
        "uv sync --locked",
        "uv run --locked ruff check .",
        "uv run --locked pytest",
        "npm ci",
        "npm run lint",
        "npm run typecheck",
        "npm run build",
        "npm run test:e2e",
    ):
        assert command in workflow
    config = (ROOT / "playwright.config.ts").read_text()
    assert "npm run build && uv run --locked uvicorn" in config
    assert "reuseExistingServer: false" in config
