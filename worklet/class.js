import{PrimeNumber} from "/worklet/mixer.js";
const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;
const lerp = function(a,b,amt=0.5){return a*(1-amt) + b*amt};
const clamp = (n, mi, ma) => max(mi, min(ma, n));
function cosI(x){return (1-cos(x*PI))/2;}// 偶関数
function noise( ){return random()*2-1};
const panR =function(x){return sin(quarterPI*(1+x));}, panL =function(x){return cos(quarterPI*(1+x));}
function doNothing(arg){return arg}
function cLog(obj){console.log(JSON.stringify(obj))} 
let primeNumber;


class EnvelopeQuadratic{
    constructor(sec=2){
        this.a = 4/sec/sec;
        this.halfT =sec/2;
        this.t = 0;
    }
    exec(t){  return max(0, 1-this.a*pow(t-this.halfT, 2));  }
    oneUseFunc(){ this.t+=Ts; return max(0, 1-this.a*pow(this.t-this.halfT, 2)); }
    static createOneUseInstance(sec){let c=new EnvelopeQuadratic(...arguments); return c.oneUseFunc.bind(c);}
}

class ADSR {// multi trigger, linear
    constructor(a = 0.01, d = 0.1, s = 0.3, r = 0.1) {
        this.inc = this.dDec = this.rDec = this.gain = this.index = 0;
        [this.ai, this.di, this.ri, this.s] = [a * Fs, d * Fs, r * Fs, s];
        this.aTarget = this.dTarget = 0;
        this.isDecaying = false;
        this.isOn = false;
        this.vel = 1;
        this.gate = 0;
    }
    setA(arg) { this.ai = arg * Fs; }
    setD(arg) { this.di = arg * Fs; }
    setR(arg) { this.ri = arg * Fs; }
    setS(arg) { this.s = arg; }
    exec() {
        if (this.isOn) {
            if (!this.isDecaying) {
                if (this.gain < this.aTarget) this.gain = min(this.aTarget, this.gain + this.inc);
                else this.isDecaying = true;
            }
            else this.gain = max(this.dTarget, this.gain - this.dDec);
        }
        else this.gain = max(0, this.gain - this.rDec);
        return this.gain;
    }
    noteOn(amp = 1) {
        this.index = 0;
        this.vel = amp;
        this.inc = amp / this.ai;
        this.dDec = amp * (1 - this.s) / this.di;
        this.rDec = amp * this.s / this.ri;
        this.aTarget = amp;
        this.dTarget = amp * this.s;
        this.isDecaying = false;
        this.isOn = true;
    }
    noteOff() {
        this.isOn = false;
        this.rDec = this.gain * this.gain / this.ri;
    }
    input(gate, amp = 1) {
        if (gate == this.gate) return;
        if (gate) this.noteOn(amp);
        else this.noteOff();
        this.gate = gate;
    }
}

class NoiseLFO{
    constructor(hz=5,curve=cosI,targetFunc=noise){
        [this.hz,this.curve,this.targetFunc] = [hz,curve,targetFunc];
        this.x = this.x1 = 0;
        this.y1 = targetFunc();
        if(typeof hz == "function")this.shift = this.shiftF;
        this.shift(hz);
    }
    shift(hz){
        this.y0 = this.y1;
        this.y1 = this.targetFunc();
        this.x0 = this.x1;
        this.x1 += Fs/hz;
    }
    shiftF(){
        this.y0 = this.y1;
        this.y1 = this.targetFunc();
        this.x0 = this.x1;
        this.x1 += Fs/this.hz();
    }
    exec(hz=this.hz){
        if(this.x++>this.x1)this.shift(hz);
        let ratio = this.curve( (this.x-this.x0)/(this.x1-this.x0) );
        return this.y0 * (1-ratio) + this.y1*ratio;
    }
    static create(hz,curveFunc,targetFunc){let c=new NoiseLFO(...arguments);return c.exec.bind(c);}
}


function getInterpolatedValue(array, decimalIndex) {
    let x1 = floor(decimalIndex);
    let x2 = x1 + 1;
    let amt = decimalIndex - x1;
    return lerp(array[x1], array[x2], amt);
} // 配列最後の要素と最初の要素の補間はしていない

class WaveTableOsc{
    constructor(waveTable,fixedHarms=false){
        this.waveTable = waveTable;
        this.sampleRate = waveTable.sampleRate;
        this.maxHarms = waveTable.maxHarms;
        for(let i=1;i<=this.maxHarms;i*=2){
            waveTable[i].push(waveTable[i][0]);
        }
        this.acc = 0;
        
        if(this.maxHarms==1)fixedHarms = 1;
        if(fixedHarms) this.fixedTable = waveTable[fixedHarms];
    }
    getInterpolatedValue(array, decimalIndex) {
        let x1 = floor(decimalIndex);
        let x2 = x1 + 1;
        let amt = decimalIndex - x1;
        return lerp(array[x1], array[x2], amt);
    } // 配列最後の要素と最初の要素の補間はしていない
    exec(phase,hz){
        let num = clamp( pow(2,floor(log2(nyquistF/hz)) ), 1, this.maxHarms);
        let source = this.waveTable[num];
        let ind = (phase - floor(phase)) * this.sampleRate;
        let x1 = floor(ind), x2 = x1+1, amt = ind-x1;
        let s = lerp(source[x1],source[x2],amt);
        return s;
    }
    oneUse(hz){
        let num = clamp( pow(2,floor(log2(nyquistF/hz)) ), 1, this.maxHarms);
        let source = this.waveTable[num];
        this.acc += hz/Fs;
        let ind = (this.acc %1) * this.sampleRate;
        return this.getInterpolatedValue(source,ind);
    }
    fixed(hz){
        let source = this.fixedTable;
        this.acc += hz/Fs;
        let ind = (this.acc %1) * this.sampleRate;
        return this.getInterpolatedValue(source,ind);
    }
    static createOneUseInstance(waveTable,fixedHarms){let c=new WaveTableOsc(...arguments); return c.oneUse.bind(c);}
    static createFixedInstance(waveTable,fixedHarms){let c=new WaveTableOsc(...arguments); return c.fixed.bind(c);}
}


class PulseOsc extends WaveTableOsc{
    constructor(table){
        super(table);
    }
    exec(hz, duty=0.25, ratio=0.5){
        let num = clamp( pow(2,floor(log2(nyquistF/hz)) ), 1, this.maxHarms);
        let source = this.waveTable[num];
        this.acc += hz/Fs;
        
        let ind = ( this.acc %1 ) * this.sampleRate;
        let s = this.getInterpolatedValue(source,ind);

        let rInd = ((this.acc+duty) %1) * this.sampleRate;
        let rs = this.getInterpolatedValue(source,rInd);
        return lerp(s,rs,ratio);
        // return s*(1-ratio) -rs*ratio;
    }
    static create(table){let c=new PulseOsc(...arguments); return c.exec.bind(c);}
}


class Sampler{
    constructor(source, hz=1){
        this.source = source;
        this.sourceLen = source.length;
        this.hz = hz;
        this.i = 0;
    }
    exec(i,hz){
        i *= hz/this.hz;
        let x1 = floor(i), x2 =x1+1, amt= i-x1;
        return lerp(this.source[x1%this.sourceLen], this.source[x2%this.sourceLen],amt);
    }
    oneUse(hz){
        this.i += hz/this.hz
        let x1 = floor(this.i), x2 =x1+1, amt= this.i-x1;
        return lerp(this.source[x1%this.sourceLen], this.source[x2%this.sourceLen],amt);
    }
    static createOneUseInstance(source,hz){let c=new Sampler(...arguments);return c.oneUse.bind(c);}
}

class Filter{
    constructor(fc=1000,type="lp",init=0){
        this.b1 = exp(-twoPI*fc/Fs);
        [this.a0, this.px, this.py] = type=="hp"?[(1+this.b1)/2, init, init]:[1-this.b1, init, init];
    }
    lp(x){ this.py = (this.a0*x) + (this.b1*this.py); return this.py; }
    hp(x){ let t=this; t.py=(t.a0*x) -t.a0*t.px +(t.b1*t.py);  t.px=x; return t.py; }
    static create(fc,type="lp",init){ let f=new Filter(fc,type,init); return f[type].bind(f);}
};

class FilterBq{
    constructor(fc=1000,q=1,type="lp",ini=0){
        [this.fc,this.q,this.y1,this.y2,this.x1,this.x2] = [fc,q,ini,ini,ini,ini];
        this.tpoS = twoPI/Fs;
        this.typeFunc = this[type];
    }
    exec(x,fc=this.fc,q=this.q){
        let t=this, w0= t.tpoS*fc, alpha=sin(w0)/2*q, cosW0=cos(w0);
        t.typeFunc(t, q, alpha, cosW0);
        t.a0=1+alpha; t.a1=-2*cosW0; t.a2=1-alpha; 
        let y = (t.b0/t.a0)*x + (t.b1/t.a0)*t.x1 + (t.b2/t.a0)*t.x2 - (t.a1/t.a0)*t.y1 - (t.a2/t.a0)*t.y2;
        t.x2=t.x1; t.x1=x; t.y2=t.y1; t.y1=y;
        return y;
    }
    lp(   t, q, alpha, cosW0){ t.b0=(1-cosW0)/2; t.b1=1-cosW0;   t.b2= t.b0; }
    hp(   t, q, alpha, cosW0){ t.b0=(1+cosW0)/2; t.b1=-(1+cosW0);t.b2= t.b0; }
    bp(   t, q, alpha, cosW0){ t.b0=q*alpha;     t.b1=0;         t.b2=-t.b0; }
    notch(t, q, alpha, cosW0){ t.b0=1;           t.b1=-2*cosW0;  t.b2=1;     }
    ap(   t, q, alpha, cosW0){ t.b0=1 - alpha;   t.b1=-2*cosW0;  t.b2=1+alpha;}
    static create(fc,q,type,ini){let c=new FilterBq(...arguments); return c.exec.bind(c);}
}


class Delay{
    constructor(sec=0.3, feedGain=0.7, wet=0.3, func=doNothing, bufSec=5){
        [this.wet,this.sec,this.feedGain,this.func] = [wet,sec,feedGain,func];
        this.buffer = new Array(floor(bufSec*Fs)).fill(0);
        this.bLen  = this.index = this.buffer.length;
    }
    exec(s,sec=this.sec, feedGain=this.feedGain, wet=this.wet){
        let t=this.index, d= sec*Fs, d1=floor(d), d2=d1+1, slope=d-d1;
        let y1 = this.buffer[(t-d1)%this.bLen];
        let y2 = this.buffer[(t-d2)%this.bLen];
        let pre = y1 + slope*(y2 - y1);
        this.buffer[t%this.bLen] = this.func(s+pre*feedGain);
        this.index++;
        return pre*wet +s*(1-wet);
    }
    static create(sec,feedGain,wet,func,bufSec){let d=new Delay(...arguments);return d.exec.bind(d);}
}

class FeedForwardDelay {
    constructor(sec = 0.3, bufSec = 5) {
        this.buffer = new Array(floor(bufSec * Fs)).fill(0);
        this.bLen = this.t = this.buffer.length;
        this.d = round(sec * Fs);
    }
    exec(s) {
        let pre = this.buffer[(this.t - this.d) % this.bLen];
        this.buffer[this.t % this.bLen] = s;
        this.t++;
        return pre;
    }
    static create(sec, bufSec) { let d = new FeedForwardDelay(...arguments); return d.exec.bind(d); }
}

class FeedbackDelay extends FeedForwardDelay{
    constructor(sec = 0.3, feedGain = 0.7, bufSec = 5) {
        super(sec,bufSec)
        this.feedGain = feedGain;
    }
    exec(s) {
        let pre = this.buffer[(this.t - this.d) % this.bLen];
        this.buffer[this.t % this.bLen] = s + pre * this.feedGain;
        this.t++;
        return pre;
    }
    static create(sec, feedGain, bufSec) { let d = new FeedbackDelay(...arguments); return d.exec.bind(d); }
}

class ReverbSchroeder{
    constructor(sec=2,randFunc=Math){
        if(!primeNumber)primeNumber = new PrimeNumber();
        let t = [], ts = [], g=[];
        while(new Set(ts).size != 4){
            for(let i=0;i<4;i++){
                t[i] = 0.03+randFunc.random()*0.01;
                g[i] = 10**(-3*t[i]/sec);
                ts[i] = primeNumber.getNearPrime(t[i]*Fs);
            }
        }
        this.logTxt = "ReverbSchroeder " + JSON.stringify({t,ts,sum:ts.reduce((acc,a)=>acc+a)})
        
        this.comb1 = this.FeedbackDelay.create(ts[0], g[0], 1, this);
        this.comb2 = this.FeedbackDelay.create(ts[1], g[1], 1, this);
        this.comb3 = this.FeedbackDelay.create(ts[2], g[2], 1, this);
        this.comb4 = this.FeedbackDelay.create(ts[3], g[3], 1, this);
        this.all1 = this.AllpassFilter.create(round(0.0050*Fs), 0.7, 1, this);
        this.all2 = this.AllpassFilter.create(round(0.0017*Fs), 0.7, 1, this);
    }
    exec(s){
        let output = this.comb1(s) + this.comb2(s) + this.comb3(s) + this.comb4(s);
        output = this.all1(output);
        output = this.all2(output);
        return  output;
    }
    static create(sec,randFunc){let c=new ReverbSchroeder(...arguments);return c.exec.bind(c);}
} // http://www.ari-web.com/service/soft/reverb-2.htm

ReverbSchroeder.prototype.FeedbackDelay = class extends FeedbackDelay {
    constructor(numSample, feedGain = 0.7, bufSec = 1){
        super(0.3,feedGain,bufSec);
        this.d = numSample;
    }
    static create(numSample, feedGain, bufSec, parent) { let d = new parent.FeedbackDelay(...arguments); return d.exec.bind(d); }
}

ReverbSchroeder.prototype.AllpassFilter = class extends ReverbSchroeder.prototype.FeedbackDelay {
    exec(s) {
        let pre = this.buffer[(this.t - this.d) % this.bLen];
        let ind = this.t % this.bLen;
        this.buffer[ind] = s + pre * this.feedGain;
        this.t++;
        return pre -this.feedGain *this.buffer[ind];
    }
    static create(sec, feedGain, bufSec, parent) { let c = new parent.AllpassFilter(...arguments); return c.exec.bind(c); }
}
export {EnvelopeQuadratic, ADSR, NoiseLFO}
export {Filter, FilterBq, Delay, FeedForwardDelay, FeedbackDelay, ReverbSchroeder, WaveTableOsc, PulseOsc, Sampler}