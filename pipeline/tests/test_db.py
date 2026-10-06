import numpy as np

from doofah_pipeline.db import array_literals


def test_array_literals_round_and_mark_gaps():
    values = np.array([[np.nan, 0.104, 29.799999], [1, -0.001, 2.555]], dtype=np.float32)
    assert array_literals(values, 2) == ["{NULL,0.1,29.8}", "{1.0,-0.0,2.56}"]


def test_array_literals_for_whole_numbers():
    values = np.array([[216.87, np.nan, 0.4], [359.5, 12, np.inf]], dtype=np.float32)
    assert array_literals(values, None) == ["{217,NULL,0}", "{360,12,NULL}"]
