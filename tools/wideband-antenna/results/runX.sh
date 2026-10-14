#!/bin/bash
# Cable-robust variants (no ferrite): the bare coax jacket (15 / 25 / 35 cm down the axis) joins the cost (CABLES,
# family10.evaluate: the worst SWR over NCABLE=8 log points between FLO and 2.4 FLO, with every cable length), from
# the cage-only winners. B at 44 mm first (designs/B44.json bare: 3.25 / 2.77 / 2.39 at 15 / 25 / 35 cm); A at 55 mm
# (a55x) after a55e. ~60-75 s per evaluation.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 CABLES=0.15,0.25,0.35 TIMEOUT=600
FEXTRA=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
FEXTRA=$FEXTRA SIZE=0.044 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=${WB:-3} SIGMA=0.10 FREE=$PROF X0=best_b44p.json \
  $VENV/bin/python ../opt_cma.py b44x 30 1 > b44x.log 2>&1
echo done > runX.done
# --- appended after a55e finished: the cable-robust A at 55 mm (started by hand: `nohup ./runX2.sh`)
