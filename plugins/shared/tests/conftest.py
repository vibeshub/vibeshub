import pytest
import respx


@pytest.fixture
def respx_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router
