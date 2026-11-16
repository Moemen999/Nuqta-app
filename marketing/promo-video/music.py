import math, wave, array, random
SR=44100; DUR=32.6; N=int(SR*DUR)
def f(m): return 440*2**((m-69)/12)
# Am F C G (x2) — 4ث لكل كورد
chords=[[57,60,64],[53,57,60],[48,52,55],[55,59,62]]
CH=4.0
out=[0.0]*N
# pad
for ci in range(9):
    notes=chords[ci%4]; t0=ci*CH-0.6; t1=t0+CH+1.2
    for m in notes+[notes[0]-12]:
        fr=f(m); amp=0.06 if m>=notes[0] else 0.08
        s0=max(0,int(t0*SR)); s1=min(N,int(t1*SR))
        for i in range(s0,s1):
            t=i/SR; x=(t-t0)/(t1-t0)
            env=abs(math.sin(math.pi*x))**1.5
            ph=2*math.pi*fr*t
            out[i]+=amp*env*(math.sin(ph)+0.25*math.sin(2*ph+0.3)+0.08*math.sin(3*ph))*(1+0.15*math.sin(2*math.pi*0.25*t))
# arpeggio (bell) every 0.5s
step=0.5; k=0
t=0.5
while t<DUR-1.0:
    ci=int(t//CH)%4; notes=chords[ci]; pat=[0,1,2,1,0,2,1,2]
    m=notes[pat[k%8]]+12
    fr=f(m); s0=int(t*SR); L=int(1.2*SR)
    for j in range(L):
        i=s0+j
        if i>=N: break
        tt=j/SR; env=math.exp(-tt*4.5)*min(1,tt*200)
        out[i]+=0.045*env*(math.sin(2*math.pi*fr*tt)+0.3*math.sin(2*math.pi*fr*2.01*tt)*math.exp(-tt*6))
    t+=step; k+=1
# lowpass + fades
y=0; a=0.18
for i in range(N):
    y+=a*(out[i]-y); out[i]=y
fi=int(1.0*SR); fo=int(2.0*SR)
for i in range(fi): out[i]*=i/fi
for i in range(fo): out[N-1-i]*=i/fo
pk=max(abs(v) for v in out); g=0.5/pk
data=array.array('h',[int(max(-1,min(1,v*g))*32767) for v in out])
w=wave.open('out/music.wav','wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes()); w.close()
print('ok', pk)
