#!/bin/bash
# Resume runZ.sh (killed by a full disk): A double-tuned at 52 mm from best_a52e.json (1.99 after 14 generations),
# B at 43 mm from best_b43p.json (1.97 after 8), smaller steps.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16
FEXTRA=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
SIZE=0.052 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=16 WORKERS=4 SIGMA=0.05 FREE=$PROF,cser,csh,ts,cs X0=best_a52e.json \
  $VENV/bin/python ../opt_cma.py a52f 40 2 > a52f.log 2>&1 &
FEXTRA=$FEXTRA SIZE=0.043 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=4 SIGMA=0.05 FREE=$PROF X0=best_b43p.json \
  $VENV/bin/python ../opt_cma.py b43q 25 2 > b43q.log 2>&1 &
wait
echo done > runZ2.done
