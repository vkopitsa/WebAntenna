#!/bin/bash
# Cable-robust antenna A at 55 mm (no ferrite): bare coax 15 / 25 / 35 cm in the cost (CABLES), from the a55e winner,
# profile + both capacitors + shunt coil free. ~35 s per evaluation.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 CABLES=0.15,0.25,0.35 TIMEOUT=600
SIZE=0.055 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=12 WORKERS=2 SIGMA=0.08 FREE=$PROF,cser,csh,ts,cs X0=best_a55e.json \
  $VENV/bin/python ../opt_cma.py a55x 40 1 > a55x.log 2>&1
echo done > runX2.done
