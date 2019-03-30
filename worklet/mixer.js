const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;
const lerp = function(a,b,amt=0.5){return a*(1-amt) + b*amt};
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const panR =function(x){return sin(quarterPI*(1+x));}, panL =function(x){return cos(quarterPI*(1+x));}

class XorShift{
    constructor(s = 0x87654321){this.u = new Uint32Array([s]);}
    random(){
        this.u[0] ^= this.u[0] <<  13;
        this.u[0] ^= this.u[0] >>> 17;
        this.u[0] ^= this.u[0] <<   5;
        return this.u[0]/4294967296;
    }
}
class PrimeNumber{
    constructor(maxVal=10000){
        let list = this.list = [2], binaryArray = this.binaryArray = [0,0,1];
        for(let i=3;i<maxVal;i++){
            let bin = 1, sqrtI = sqrt(i);
            for(let j=0; list[j]<=sqrtI; j++){
                let n = i/list[j];
                if( floor(n) == n ){ bin=0; break;}
            }
            if(bin)list.push(i);
            binaryArray.push(bin);
        }
    }
    isPrime(n){
        return this.binaryArray[n];
    }
    getNearPrime(n){
        n = floor(n);
        if(n>this.list[this.list.length-1])throw new Error("PrimeNumber");
        while(!this.binaryArray[n])n++;
        return n;
    }
}


class Mixer{
    constructor(numTracks=16, numAux=0){
        this.tracks = [];
        this.aux = [];
        this.numTracks = numTracks;
        for(let i=0;i<numTracks;i++)this.tracks.push(new Track(numAux));
        this.numAux = numAux;
        for(let i=0;i<numAux;i++)this.aux.push(new Track(0));
        this.tracksAll = this.tracks.concat(this.aux);
        this.numTracksAll = this.tracksAll.length;
    }
    output(L,R,bufferI){
        for(let i=0; i<this.numTracks; i++){
            const trk = this.tracks[i];
            if(trk.effect)trk.execEffect();
            for(let j=0; j<this.numAux; j++)trk.send(j,this.aux[j]);
        }
        for(let i=0; i<this.numAux; i++)this.aux[i].execEffect();
        for(let i=0; i<this.numTracksAll; i++)this.tracksAll[i].output(L,R,bufferI);
    }
}

class Track{
    constructor(numSends=0){
        this.amp = 1;
        this.pan = 0;
        this.lAmp = panL(0);
        this.rAmp = panL(0);
        this.sends = [];
        this.bufferL = 0;
        this.bufferR = 0;
        this.bufferAfterEffect = [[0,0]];
        this.numSends = numSends;
        this.effect = null;
        for(let i=0; i<numSends; i++){
            this.sends[i] = {amp:1}
        }
    }
    setup(pan=0,amp=1,effectFunc=null, ...auxAmp){
        this.pan = pan;
        this.amp = amp;
        this.effect = effectFunc;
        this.lAmp = panL(pan) *amp;
        this.rAmp = panR(pan) *amp;
        for(let i=0, l=auxAmp.length;i<l;i++){
            this.sends[i].amp = auxAmp[i];
        }
    }
    input1ch(s){
        this.bufferL += s;
        this.bufferR += s;
    }
    input1to2ch(s, pan=0, amp=1){
        this.bufferL += s*panL(pan) *amp;
        this.bufferR += s*panR(pan) *amp;
    }
    input2ch(l,r){
        this.bufferL += l;
        this.bufferR += r;
    }
    send(n, target){
        target.bufferL += this.bufferL *this.sends[n].amp;
        target.bufferR += this.bufferR *this.sends[n].amp;
    }
    execEffect(){
        this.effect(this.bufferL, this.bufferR, this.bufferAfterEffect);
        this.bufferL = this.bufferAfterEffect[0];
        this.bufferR = this.bufferAfterEffect[1];
    }
    output(L,R,i){
        this.bufferL *= this.lAmp;
        this.bufferR *= this.rAmp;
        L[i] += this.bufferL;
        R[i] += this.bufferR;
        this.bufferL = this.bufferR = 0;
    }
}

class SetTarget {
    constructor(iniValue = 0, tc = 0.01, iniTargetValue = iniValue) {
        this.v0 = this.gain = iniValue;
        this.v1 = iniTargetValue;
        this.t = 0;
        this.setTC(tc);
    }
    setTC(v) { this.TC = v * Fs; }
    setValue(targetValue) {
        this.v0 = this.gain;
        this.v1 = targetValue;
        this.t = 0;
    }
    exec() {
        this.gain = this.v1 + (this.v0 - this.v1) * exp(-(this.t++ / this.TC));
        return this.gain;
    }
}

export{XorShift, PrimeNumber, Mixer, SetTarget, }