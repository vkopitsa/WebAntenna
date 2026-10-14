#!/bin/bash
# Phase 2b of the split study (after runAB.sh's phase 1): antenna A (960 MHz - 1.36 GHz) with a second matching
# element. matchbound.py on the unmatched seed cage (results/sweepA_seed*_nosh.json) says one element (the shunt
# wire) cannot reach SWR 2 below 50 mm, two (shunt L + series 2-6 pF) get 6.4 / 4.0 / 2.8 at 40 / 45 / 50 mm with
# the seed's shape, so: profile + shunt + series capacitor in the pin (cser), from each size's phase-1 winner,
# and the plain profile at 50 mm.
cd "$(dirname "$0")"   # started by hand once phase 1 was over (a pgrep guard matched its own launcher shell)
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 NCAGE=16 FLO=960e6 FHI=1.36e9 NFREQ=10 POP=16 WORKERS=2
cma() { # tag size sigma iters free x0
  SIZE=$2 SIGMA=$3 FREE=$5 X0=$6 $VENV/bin/python ../opt_cma.py $1 $4 1 > $1.log 2>&1
}
cma a40c 0.040 0.15 60 $PROF,cser best_a40p.json &
cma a45c 0.045 0.15 60 $PROF,cser best_a45p.json &
( cma a50p 0.050 0.15 50 $PROF best_a45p.json
  cma a50c 0.050 0.12 50 $PROF,cser best_a50p.json ) &
wait
echo done > runA2.done
