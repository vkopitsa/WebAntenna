#!/bin/bash
# Antenna A at 55 mm with a quarter-wave choke sleeve on the coax instead of ferrite: the cage re-optimised with the
# bare cable (15 / 25 / 35 cm, CABLES) and a 70 mm x Ø10 mm sleeve (SLEEVE) in the cost, from the a55e winner.
# cage_sleeve.py on A55 as found: sleeve 70 mm gives 2.24 / 1.80 / 2.33 (bare 10.4 / 7.1 / 3.9). Replaces a55x (the
# bare cable alone: stuck at 6.0, the jacket is half of the antenna at 960 MHz).
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 CABLES=0.15,0.25,0.35 SLEEVE=0.07,0.005 TIMEOUT=600
SIZE=0.055 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=12 WORKERS=3 SIGMA=0.08 FREE=$PROF,cser,csh,ts,cs X0=best_a55e.json \
  $VENV/bin/python ../opt_cma.py a55s 40 1 > a55s.log 2>&1
echo done > runX3.done
