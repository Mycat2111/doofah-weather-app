"""
Writes src/services/cyclones/bufrTables.ts: the WMO BUFR table B elements
and table D sequences DooFah's BUFR reader knows, from ecCodes.

Only the classes a tropical cyclone track can use are kept (identification,
time, position, meteorological attributes, pressure, wind, temperature,
replication, quality), with the common sequences (3-01) and the tropical
cyclone ones (3-16, e.g. 3-16-082 in ECMWF's track files). Anything else makes
the reader stop with an error rather than misread the data.

Table B comes from the installed ecCodes library. Table D comes from the
same ecCodes release's definition files on GitHub, as WMO writes each
sequence (nested sequences, replications and operators such as 2-01-131
"3 bits wider" left in place), which the library doesn't expose.

Run with: python3 -m pip install eccodes && python3 scripts/generate-bufr-tables.py
"""

import pathlib
import re
import urllib.request

import eccodes as ec

MASTER = 46
CLASSES = [1, 4, 5, 6, 7, 8, 10, 11, 12, 19, 31, 33]
SEQUENCE_CLASSES = [301, 316]
SEQUENCES_URL = (
    f"https://raw.githubusercontent.com/ecmwf/eccodes/{ec.codes_get_api_version()}"
    f"/definitions/bufr/tables/0/wmo/{MASTER}/sequence.def"
)
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


def table_d():
    """Every sequence in ecCodes' sequence.def: code -> its descriptors."""
    with urllib.request.urlopen(SEQUENCES_URL, timeout=60) as res:
        text = res.read().decode()
    return {
        int(code): [int(d) for d in re.findall(r"\d{6}", body)]
        for code, body in re.findall(r'"(\d{6})"\s*=\s*\[([^\]]*)\]', text)
    }


def sequences_kept(table):
    """The sequences of SEQUENCE_CLASSES whose nested sequences are kept too."""
    kept = {code for code in table if code // 1000 in SEQUENCE_CLASSES}
    while True:
        dropped = {code for code in kept if any(d >= 300000 and d not in kept for d in table[code])}
        if not dropped:
            return sorted(kept)
        kept -= dropped


elements = [e for x in CLASSES for y in range(256) if (e := element(x * 1000 + y))]
table = table_d()
sequences = [f"{code:06d} " + " ".join(f"{d:06d}" for d in table[code]) for code in sequences_kept(table)]

OUT.write_text(
    f"""/**
 * WMO BUFR tables (master table version {MASTER}), the classes a tropical
 * cyclone track can use: table B elements as "FXXYYY width scale reference
 * kind" (s = text, c = code or flag table, n = a number) and table D
 * sequences as "FXXYYY then its descriptors", as WMO defines them. Written
 * by scripts/generate-bufr-tables.py from ecCodes (Apache 2.0); do not
 * edit by hand.
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
