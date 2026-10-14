#!/bin/bash
# The last squeeze: A double-tuned at 51 mm (from the 52 mm winner), B at 43 mm with the 50 mm sleeve and the three
# cables in the cost (from the 43 mm winner), and B at 44 mm with the cost floor lowered to 1.5 (SWRFLOOR) to see
# whether a worst SWR below 1.8 exists at that size.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16
FEXTRA=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
SIZE=0.051 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=16 WORKERS=3 SIGMA=0.05 FREE=$PROF,cser,csh,ts,cs X0=best_a52f.json \
  $VENV/bin/python ../opt_cma.py a51f 40 1 > a51f.log 2>&1 &
FEXTRA=$FEXTRA SIZE=0.043 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=3 SIGMA=0.05 CABLES=0.15,0.25,0.35 SLEEVE=0.05,0.005 TIMEOUT=900 FREE=$PROF X0=best_b43q.json \
  $VENV/bin/python ../opt_cma.py b43s 20 1 > b43s.log 2>&1 &
FEXTRA=$FEXTRA SIZE=0.044 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=2 SIGMA=0.05 SWRFLOOR=1.5 FREE=$PROF X0=best_b44p.json \
  $VENV/bin/python ../opt_cma.py b44f 30 1 > b44f.log 2>&1 &
wait
echo done > runZ3.done
