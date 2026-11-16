"""Reusable clients and model state isolation for the AI regression suites."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ai.sessions import SessionStore
from support.provider_fakes import teaching, wire


@pytest.fixture
def clean_state(monkeypatch):
    monkeypatch.setitem(app.state._state, 'sessions', SessionStore())
    monkeypatch.setitem(app.state._state, 'ai_transport', httpx.MockTransport(
        lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(teaching())))))


@pytest.fixture
def client(clean_state):
    with TestClient(app) as connection:
        yield connection
