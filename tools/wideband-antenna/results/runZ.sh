#!/bin/bash
# Size pinning: A double-tuned at 52 mm (between 50 mm = 2.13 and 55 mm = 1.86) from the 55 mm winner, and B at 43 mm
# (between 42 mm = 2.04 and 44 mm = 1.81) from the 44 mm winner.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16
FEXTRA=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
SIZE=0.052 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=16 WORKERS=3 SIGMA=0.08 FREE=$PROF,cser,csh,ts,cs X0=best_a55e.json \
  $VENV/bin/python ../opt_cma.py a52e 50 1 > a52e.log 2>&1 &
FEXTRA=$FEXTRA SIZE=0.043 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=3 SIGMA=0.08 FREE=$PROF X0=best_b44p.json \
  $VENV/bin/python ../opt_cma.py b43p 30 1 > b43p.log 2>&1 &
wait
echo done > runZ.done
