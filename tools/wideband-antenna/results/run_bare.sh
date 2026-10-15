#!/bin/sh
# Bare-coax tables for the app's "no ferrite" option (export_bare_table.py), one design after another.
PY=${PY:-python}
cd "$(dirname "$0")/.."
$PY export_bare_table.py solid family8 designs/S73.json 960e6 6.4e9 64 bare_S73.json > results/bare_S73.log 2>&1
$PY export_bare_table.py solid family6 designs/B_simple.json 800e6 6.4e9 64 bare_B.json > results/bare_B.log 2>&1
$PY export_bare_table.py solid family4 designs/A.json 300e6 6.4e9 90 bare_A.json > results/bare_A.log 2>&1
$PY export_bare_table.py cage - designs/W16.json 960e6 6.4e9 64 bare_W16.json > results/bare_W16.log 2>&1
$PY export_bare_table.py cage - designs/W65.json 960e6 6.4e9 64 bare_W65.json > results/bare_W65.log 2>&1
SIZE=0.040 $PY export_bare_table.py cage - designs/W40.json 1.4e9 6.4e9 64 bare_W40.json > results/bare_W40.log 2>&1
SIZE=0.044 $PY export_bare_table.py cage - designs/B44f.json 1.36e9 7.0e9 64 bare_B44f.json > results/bare_B44f.log 2>&1
SIZE=0.055 $PY export_bare_table.py cage - designs/A55.json 0.96e9 1.36e9 64 bare_A55.json > results/bare_A55.log 2>&1
echo done > results/bare_done
