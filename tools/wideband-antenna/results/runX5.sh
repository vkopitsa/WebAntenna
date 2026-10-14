#!/bin/bash
# Antenna A at 55 mm re-optimised with the fat choke sleeve (Ø20 x 75 mm, SLEEVE) and the three bare cables in the
# cost, from the a55e winner: the cage + sleeve as found gives 2.16 / 1.62 / 1.80 (15 / 25 / 35 cm), the 15 cm case
# at 960 MHz is what is left above SWR 2. (runX3.sh did the same with the thin Ø10 x 70 mm sleeve and stalled.)
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 CABLES=0.15,0.25,0.35 SLEEVE=0.075,0.010 TIMEOUT=900
SIZE=0.055 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=12 WORKERS=6 SIGMA=0.06 FREE=$PROF,cser,csh,ts,cs X0=best_a55e.json \
  $VENV/bin/python ../opt_cma.py a55t 25 1 > a55t.log 2>&1
echo done > runX5.done
