from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path


class TranscriptReader(ABC):
    """
    Platform-specific glue for finding the transcript file produced by an AI
    coding platform (Claude Code, Cursor, Codex, ...) and identifying the
    platform in uploaded metadata.

    Hook scripts construct a concrete reader, then hand it to the pipeline.
    """

    @abstractmethod
    def find_session(self, hook_input: dict) -> Path:
        """Return the absolute path to the JSONL transcript for the active session."""

    @abstractmethod
    def platform_id(self) -> str:
        """Stable string used as the `platform` field on uploaded traces."""
