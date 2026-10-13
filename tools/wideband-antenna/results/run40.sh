#!/bin/bash
# The 40 mm study (family 13), reproducible in one go. Phase 1, in parallel: the plain profile + shunt at 40 mm with
# 16 frames and 18 frequencies (the reference), the random screening of each shape group (12 frames, 150 buildable
# shapes each), and CMA-ES over each shape group from the wideband seed (12 frames, 12 frequencies, verified later
# with 16 frames at 96 points). Phase 2: the plain profile at 45 and 50 mm (the size trade), and the 40 mm cage
# scored from 1.2 and 1.4 GHz (the band it covers at SWR <= 2).
# ABORT=50: only a shape with SWR > 50 at the two lowest frequencies is cut short. The 60 mm setting (ABORT=4) cut
# every 40 mm candidate off after two frequencies, and a first round of runs optimised the low band alone: the cage
# became a narrow-band top-loaded dipole (SWR 4-9 across 1.5-4.5 GHz). Those runs are kept in lowband_only/.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50 X0=seed_p40.json
cma() { # tag ncage size flo nfreq pop workers sigma iters free
  NCAGE=$2 SIZE=$3 FLO=$4 NFREQ=$5 POP=$6 WORKERS=$7 SIGMA=$8 FREE=${10} $VENV/bin/python ../opt_cma.py $1 $9 1 > $1.log 2>&1
}
rnd() { # tag free
  NCAGE=12 SIZE=0.040 FLO=960e6 NFREQ=12 WORKERS=3 FREE=$2 $VENV/bin/python ../random13.py $1 150 1 > $1.log 2>&1
}
cma p40 16 0.040 960e6 18 16 5 0.15 50 $PROF &
X0=seed_c40.json cma c40 16 0.040 960e6 18 16 4 0.15 50 $PROF,cser &     # + a series capacitor in the pin
( rnd rp40 $PROF
  rnd rz40 $PROF,mh,nh,mhs,mg,ng,mgs
  rnd rl40 $PROF,hf,ah,leg,tw_l
  rnd rs40 $PROF,th,ch,ah0,ah1,tg,cg,ag0,ag1,ts,cs
  rnd rt40 $PROF,hf,ah,tw_h,tws_h,tw_f,tw_g,tws_g,tw_k ) &
( cma t40 12 0.040 960e6 12 12 3 0.10 30 $PROF,hf,ah,tw_h,tws_h,tw_f,tw_g,tws_g,tw_k
  cma s40 12 0.040 960e6 12 12 3 0.10 30 $PROF,th,ch,ah0,ah1,tg,cg,ag0,ag1,ts,cs ) &
( cma z40 12 0.040 960e6 12 12 3 0.10 30 $PROF,mh,nh,mhs,mg,ng,mgs
  cma l40 12 0.040 960e6 12 12 3 0.10 30 $PROF,hf,ah,leg,tw_l,sh ) &
wait
( cma p45 16 0.045 960e6 12 12 4 0.10 30 $PROF
  cma f40b 16 0.040 1.2e9 12 12 4 0.10 30 $PROF ) &
( cma p50 16 0.050 960e6 12 12 4 0.10 30 $PROF
  cma f40a 16 0.040 1.4e9 12 12 4 0.10 30 $PROF ) &
wait
echo done > run40.done
