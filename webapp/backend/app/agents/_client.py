"""Shared OpenAI client for the agents subsystem.

Mirrors the pattern in polybot/storybot/twitter_pipeline.py:1928 — a
single OpenAI Python SDK client pointed at the configured endpoint.
The endpoint is Azure-shaped today (responses.parse with Structured
Outputs / a json_schema derived from the Digest model).

`get_client()` reads env vars at call time (not import time) so that
test fixtures can patch them with monkeypatch.setenv. Returns None when
any of the three env vars are unset; callers must check.
"""
from __future__ import annotations

import os

from openai import OpenAI


_ENV_API_KEY = "VIBESHUB_OPENAI_API_KEY"
_ENV_ENDPOINT = "VIBESHUB_OPENAI_ENDPOINT"
_ENV_MODEL = "VIBESHUB_OPENAI_MODEL"
_TIMEOUT_SECONDS = 120.0
_MAX_RETRIES = 1


def get_client() -> OpenAI | None:
    api_key = os.environ.get(_ENV_API_KEY, "")
    endpoint = os.environ.get(_ENV_ENDPOINT, "")
    model = os.environ.get(_ENV_MODEL, "")
    if not (api_key and endpoint and model):
        return None
    # Bound the call: the SDK default is a 600s timeout with 2 retries,
    # which could pin a request for 30 minutes on a hung endpoint.
    return OpenAI(
        base_url=endpoint, api_key=api_key,
        timeout=_TIMEOUT_SECONDS, max_retries=_MAX_RETRIES,
    )


def get_model() -> str:
    return os.environ.get(_ENV_MODEL, "")
