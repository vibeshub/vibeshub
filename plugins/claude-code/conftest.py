"""
Ensure the plugin root is importable so tests can do `from reader import ...`
regardless of which directory pytest was invoked from.
"""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
