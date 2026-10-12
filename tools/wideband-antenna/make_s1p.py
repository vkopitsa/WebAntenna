"""Touchstone .s1p from a final_report sweep CSV: python make_s1p.py <sweep.csv> <out.s1p> [name]"""
import sys
import numpy as np

d = np.genfromtxt(sys.argv[1], delimiter=",", names=True)
name = sys.argv[3] if len(sys.argv) > 3 else sys.argv[1]
z = d["R_ohm"] + 1j * d["X_ohm"]
g = (z - 50) / (z + 50)
with open(sys.argv[2], "w") as fh:
    fh.write(f"! {name}: simulated S11 (BoR MoM, no cable), tools/wideband-antenna\n# HZ S RI R 50\n")
    for f, s in zip(d["f_MHz"] * 1e6, g):
        fh.write(f"{f:.0f} {s.real:.6f} {s.imag:.6f}\n")
