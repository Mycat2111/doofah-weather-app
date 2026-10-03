# ECMWF sample files

`ecmwf-tc-tracks-2015-11-18.bufr` (ECMWF's ensemble tropical cyclone tracks
from the run of 18 November 2015 00 UTC) and `ecmwf-ens-uncompressed.bufr`
come from the test data of ECMWF's
[pdbufr](https://github.com/ecmwf/pdbufr) (`tests/sample_data`), © ECMWF,
Apache License 2.0. `npm run verify:cyclones` reads them to check DooFah's
BUFR reader against values ecCodes reads from the same files.
