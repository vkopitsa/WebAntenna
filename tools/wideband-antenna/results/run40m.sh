#!/bin/bash
# After run40.sh: re-optimise the 40 mm winners for the mean mismatch loss over the band (COST=loss) instead of the
# worst SWR. At 40 mm the worst SWR sits at the bottom of the band whatever the shape, and the minimax cost then
# lets the rest of the band drift (the coiled cage scored 11.6 with SWR 5-9 across the whole band).
cd "$(dirname "$0")"
while [ ! -f run40.done ]; do sleep 60; done
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 COST=loss SIZE=0.040 FLO=960e6 POP=16 SIGMA=0.08
NCAGE=16 NFREQ=18 WORKERS=3 X0=best_c40.json FREE=$PROF,cser $VENV/bin/python ../opt_cma.py c40m 40 1 > c40m.log 2>&1 &
NCAGE=16 NFREQ=18 WORKERS=3 X0=seed_p40.json FREE=$PROF $VENV/bin/python ../opt_cma.py p40m 40 1 > p40m.log 2>&1 &
NCAGE=12 NFREQ=12 WORKERS=2 X0=seed_p40.json FREE=$PROF,th,ch,ah0,ah1,tg,cg,ag0,ag1,ts,cs $VENV/bin/python ../opt_cma.py s40m 40 1 > s40m.log 2>&1 &
wait
echo done > run40m.done
