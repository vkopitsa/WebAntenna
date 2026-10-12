import math, numpy as np, bor
from scipy.integrate import quad
def brute(rho,z,rp,zp,k):
    def G(ph):
        R=math.sqrt(rho*rho+rp*rp-2*rho*rp*math.cos(ph)+(z-zp)**2); return np.exp(-1j*k*R)/(4*math.pi*R)
    f=lambda ph,part,w: (w(ph)*G(ph)).real if part==0 else (w(ph)*G(ph)).imag
    one=lambda ph:1.0; omc=lambda ph:1-math.cos(ph)
    I0=sum((1j if p else 1)*quad(f,0,math.pi,args=(p,one),limit=400,points=[0])[0] for p in (0,1))/math.pi
    D=sum((1j if p else 1)*quad(f,0,math.pi,args=(p,omc),limit=400)[0] for p in (0,1))/math.pi
    return I0,D
for (rho,z,rp,zp,k) in [(0.05,0,0.06,0.01,6.3),(0.1,0,0.1,0.002,6.3),(0.1,0,0.12,-0.05,134),(0.001,0,0.001,0.003,20),(0.08,0.005,0.02,-0.03,60),(0.1,0,0.1,0.0003,134)]:
    a=bor._kern(rho,z,rp,zp,k,-1.0); b=brute(rho,z,rp,zp,k)
    print(f"I0 {a[0]:.6g} vs {b[0]:.6g} | D01 {a[1]:.6g} vs {b[1]:.6g}")
# analytic log integrals
L=0.01
for x in [0.001,0.005,0.0093]:
    F0=quad(lambda t: math.log(abs(t-x)),0,L,points=[x])[0]; F1=quad(lambda t: t*math.log(abs(t-x)),0,L,points=[x])[0]
    print(x, bor._F0(x,L), F0, bor._F1(x,L), F1)
