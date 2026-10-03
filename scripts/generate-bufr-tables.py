"""
Writes src/services/cyclones/bufrTables.ts: the WMO BUFR table B elements
and table D sequences DooFah's BUFR reader knows, read from ecCodes.

Only the classes a tropical cyclone track can use are kept (identification,
time, position, meteorological attributes, pressure, wind, temperature,
replication, quality); anything else makes the reader stop with an error
rather than misread the data.

Run with: python3 -m pip install eccodes && python3 scripts/generate-bufr-tables.py
"""

import pathlib

import eccodes as ec

MASTER = 46
CLASSES = [1, 4, 5, 6, 7, 8, 10, 11, 12, 19, 31, 33]
OUT = pathlib.Path(__file__).resolve().parent.parent / "src/services/cyclones/bufrTables.ts"


def new_message(descriptors):
    h = ec.codes_bufr_new_from_samples("BUFR4")
    ec.codes_set(h, "masterTablesVersionNumber", MASTER)
    ec.codes_set(h, "compressedData", 0)
    ec.codes_set(h, "numberOfSubsets", 1)
    ec.codes_set_array(h, "unexpandedDescriptors", descriptors)
    return h


def element(code):
    try:
        h = new_message([code])
    except ec.CodesInternalError:
        return None
    try:
        it = ec.codes_bufr_keys_iterator_new(h)
        names = []
        while ec.codes_bufr_keys_iterator_next(it):
            names.append(ec.codes_bufr_keys_iterator_get_name(it))
        ec.codes_bufr_keys_iterator_delete(it)
        keys = [n for n in names if n.startswith("#1#") and "->" not in n]
        if not keys:
            return None
        get = lambda attr: ec.codes_get(h, keys[0] + "->" + attr)
        if int(get("code")) != code:
            return None
        units = get("units")
        kind = "s" if units == "CCITT IA5" else "c" if "CODE TABLE" in units or "FLAG TABLE" in units else "n"
        return f"{code:06d} {get('width')} {get('scale')} {get('reference')} {kind}"
    except ec.CodesInternalError:
        return None
    finally:
        ec.codes_release(h)


def sequence(code):
    try:
        h = new_message([code])
    except ec.CodesInternalError:
        return None
    try:
        expanded = [int(d) for d in ec.codes_get_array(h, "expandedDescriptors")]
        # Only flat sequences: replication counts in ecCodes' expansion are already adjusted.
        if not expanded or any(d >= 100000 for d in expanded):
            return None
        return f"{code:06d} " + " ".join(f"{d:06d}" for d in expanded)
    except ec.CodesInternalError:
        return None
    finally:
        ec.codes_release(h)


elements = [e for x in CLASSES for y in range(256) if (e := element(x * 1000 + y))]
sequences = [s for y in range(256) if (s := sequence(301000 + y))]

OUT.write_text(
    f"""/**
 * WMO BUFR tables (master table version {MASTER}), the classes a tropical
 * cyclone track can use: table B elements as "FXXYYY width scale reference
 * kind" (s = text, c = code or flag table, n = a number) and flat table D
 * sequences as "FXXYYY then its elements". Written by
 * scripts/generate-bufr-tables.py from ecCodes (Apache 2.0); do not edit
 * by hand.
 */

export const BUFR_MASTER_VERSION = {MASTER};

export const TABLE_B = `
{chr(10).join(elements)}
`;

export const TABLE_D = `
{chr(10).join(sequences)}
`;
"""
)
print(f"{len(elements)} elements, {len(sequences)} sequences -> {OUT}")
