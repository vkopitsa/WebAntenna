#!/bin/bash
# Antenna B at 44 mm with a 50 mm x Ø10 mm choke sleeve on the coax (no ferrite): cage_sleeve.py on B44 as found gives
# 1.86 / 1.90 / 2.00 with 15 / 25 / 35 cm of bare cable (bare: 3.25 / 2.77 / 2.39). Re-optimised with the sleeve and
# the three cables in the cost, from the B44 winner; starts when b44x (runX.sh) is done.
cd "$(dirname "$0")"
until [ -f runX.done ]; do sleep 60; done
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 CABLES=0.15,0.25,0.35 SLEEVE=0.05,0.005 TIMEOUT=600
FEXTRA=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
FEXTRA=$FEXTRA SIZE=0.044 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=3 SIGMA=0.08 FREE=$PROF X0=best_b44p.json \
  $VENV/bin/python ../opt_cma.py b44s 25 1 > b44s.log 2>&1
echo done > runX4.done
