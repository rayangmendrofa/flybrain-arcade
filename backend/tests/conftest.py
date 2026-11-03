# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import pytest

from flybrain import upstream


def pytest_collection_modifyitems(config, items):
    if upstream.check_upstream().available:
        return
    skip = pytest.mark.skip(reason="upstream repository / FlyWire v630 data unavailable")
    for item in items:
        if "upstream" in item.keywords:
            item.add_marker(skip)
