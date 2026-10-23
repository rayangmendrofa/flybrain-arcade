import pytest

from flybrain import upstream


def pytest_collection_modifyitems(config, items):
    if upstream.check_upstream().available:
        return
    skip = pytest.mark.skip(reason="upstream repository / FlyWire v630 data unavailable")
    for item in items:
        if "upstream" in item.keywords:
            item.add_marker(skip)
