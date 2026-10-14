#!/bin/bash
# Antenna B one size down: 42 mm (the Chu / Bode-Fano floor puts SWR 2 at 1.36 GHz right at 42 mm), from the 44 mm
# winner. Starts when runAB.sh's phase-2 screening has finished (100 samples each) to keep 8 workers on 8 cores.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
until [ "$(cat rand_ras40.jsonl rand_ral40.jsonl rand_raz40.jsonl 2>/dev/null | wc -l)" -ge 300 ]; do sleep 60; done
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 FLO=1.36e9 FHI=7.0e9 NFREQ=18 POP=12 WORKERS=2 SIGMA=0.10
FEXTRA=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
FEXTRA=$FEXTRA SIZE=0.042 FREE=$PROF X0=best_b44p.json $VENV/bin/python ../opt_cma.py b42p 40 1 > b42p.log 2>&1
echo done > runB2.done
