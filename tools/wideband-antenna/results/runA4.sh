#!/bin/bash
# Antenna A at 55 mm: the plain profile + one shunt (wire only, a55p) and the double-tuned ladder (m55 then a55e),
# for the size / SWR trade table next to 40 / 45 / 50 mm.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
MATCH=shr,cser,csh,ts,cs
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=16 WORKERS=2
cma() { SIZE=$2 FREE=$3 X0=$4 SIGMA=$5 $VENV/bin/python ../opt_cma.py $1 $6 1 > $1.log 2>&1; }
cma a55p 0.055 $PROF best_a45p.json 0.15 50 &
( cma m55 0.055 $MATCH seed_a45d.json 0.3 30; cma a55e 0.055 $PROF,cser,csh,ts,cs best_m55.json 0.1 60 ) &
wait
echo done > runA4.done
