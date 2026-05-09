import pytest
import respx
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture
def respx_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router
