#!/bin/bash
# The split study: two antennas instead of one, each as small as it can be at SWR <= 2, no ferrite, same sky-tilted
# pattern cost as the cage (family 13, 15-50 deg elevation).
#   A: 960 MHz - 1.36 GHz (band-pass: a small multi-resonant cage, FHI caps the scored grid at 1.36 GHz)
#   B: 1.36 - 7.0 GHz (high-pass, like W40 one size up; FEXTRA every 100 MHz over 5.8-7.2 GHz against narrow features)
# Phase 1 (8 cores): A at 40 / 45 mm with the plain profile + shunt, A at 40 mm with coils, B at 44 mm.
# Phase 2: random screening of the bend groups for A at 40 mm (seeds for CMA), B at 46 mm.
cd "$(dirname "$0")"
VENV=${VENV:-/tmp/claude-1000/-home-vkopytsia-Projects-antenna-generator/5ef02d81-4f02-4d42-a761-e7e65e0dd628/scratchpad/venv}
PROF=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr
SPR=th,ch,ah0,ah1,tg,cg,ag0,ag1,ts,cs
export OMP_NUM_THREADS=1 FAMILY=family13 SEG=2e-3 ABORT=50
FEX_B=$(python3 -c "print(','.join(str(f) for f in range(5800,7201,100)))" | sed 's/\([0-9]*\)/\1e6/g')
cma() { # tag ncage size flo fhi nfreq pop workers sigma iters free [x0]
  NCAGE=$2 SIZE=$3 FLO=$4 FHI=$5 NFREQ=$6 POP=$7 WORKERS=$8 SIGMA=$9 FREE=${11} X0=${12:-seed_p40.json} \
    $VENV/bin/python ../opt_cma.py $1 ${10} 1 > $1.log 2>&1
}
rnd() { # tag free n
  NCAGE=12 SIZE=0.040 FLO=960e6 FHI=1.36e9 NFREQ=10 WORKERS=2 FREE=$2 X0=seed_p40.json \
    $VENV/bin/python ../random13.py $1 $3 1 > $1.log 2>&1
}
# phase 1
cma a40p 16 0.040 960e6 1.36e9 10 16 2 0.20 60 $PROF &
cma a45p 16 0.045 960e6 1.36e9 10 16 2 0.20 60 $PROF &
cma a40s 12 0.040 960e6 1.36e9 10 16 2 0.20 60 $PROF,$SPR &
FEXTRA=$FEX_B cma b44p 16 0.044 1.36e9 7.0e9 18 12 2 0.12 40 $PROF best_f40c.json &
wait
# phase 2
rnd ras40 $PROF,$SPR 100 &
rnd ral40 $PROF,hf,ah,leg,tw_l 100 &
rnd raz40 $PROF,mh,nh,mhs,mg,ng,mgs 100 &
FEXTRA=$FEX_B cma b46p 16 0.046 1.36e9 7.0e9 18 12 2 0.12 40 $PROF best_f40c.json &
wait
echo done > runAB.done
