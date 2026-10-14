#!/bin/bash
# Phase 3 of the split study: antenna A double-tuned, in two stages per size. Two shunt wires (sh = 2 fixed), every
# second one with a series capacitor (csh), a series capacitor in the pin (cser), the shunt coil (ts, cs): the
# "shunt L, series C, shunt L-C" ladder that the ideal-match check (scratch dtune.py, from matchbound.py) put at
# SWR 1.94 on the unmatched 50 mm seed and 2.8 at 45 mm. Stage 1 (m45/m50): only the five matching knobs, the
# profile frozen at the 45 mm phase-1 winner (a first try with everything free stalled at 9.6 / 4.7 for 14
# generations). Stage 2 (a45e/a50e): everything free from the stage-1 winner.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
MATCH=shr,cser,csh,ts,cs
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=16 WORKERS=2
cma() { SIZE=$2 FREE=$3 X0=$4 SIGMA=$5 $VENV/bin/python ../opt_cma.py $1 $6 1 > $1.log 2>&1; }
( cma m45 0.045 $MATCH seed_a45d.json 0.3 30; cma a45e 0.045 $PROF,cser,csh,ts,cs best_m45.json 0.1 60 ) &
( cma m50 0.050 $MATCH seed_a45d.json 0.3 30; cma a50e 0.050 $PROF,cser,csh,ts,cs best_m50.json 0.1 60 ) &
wait
( cma m40 0.040 $MATCH seed_a45d.json 0.3 30; cma a40e 0.040 $PROF,cser,csh,ts,cs best_m40.json 0.1 60 )
echo done > runA3.done
