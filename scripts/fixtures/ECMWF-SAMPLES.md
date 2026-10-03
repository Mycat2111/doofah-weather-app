# ECMWF sample files

`ecmwf-tc-tracks-2015-11-18.bufr` (ECMWF's ensemble tropical cyclone tracks
from the run of 18 November 2015 00 UTC) and `ecmwf-ens-uncompressed.bufr`
come from the test data of ECMWF's
[pdbufr](https://github.com/ecmwf/pdbufr) (`tests/sample_data`), © ECMWF,
Apache License 2.0. `npm run verify:cyclones` reads them to check DooFah's
BUFR reader against values ecCodes reads from the same files.

`ecmwf-tc-tracks-2026-10-03-33W.bufr` is one message (typhoon 33W CHOI-WAN)
of ECMWF's ensemble tropical cyclone track file for the run of 3 October 2026
00 UTC (`20261003000000-360h-enfo-tf.bufr`), from
[ECMWF open data](https://www.ecmwf.int/en/forecasts/datasets/open-data),
© ECMWF, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It
shows the layout ECMWF writes today (sequence 3-16-082, with wind radii).
