"""
Ensure the plugin root is importable so tests can do `from reader import ...`
regardless of which directory pytest was invoked from.
"""
import sys
from pathlib import Path

import pytest
import respx

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


@pytest.fixture
def respx_mock():
    with respx.mock(assert_all_called=False) as router:
        yield router
