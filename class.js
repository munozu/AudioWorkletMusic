const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;
const lerp = function(a,b,amt=0.5){return a*(1-amt) + b*amt};
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const panR =function(x){return sin(quarterPI*(1+x));}, panL =function(x){return cos(quarterPI*(1+x));}

class ParameterHandler{
    constructor(){
        this.descriptors = {};
    }
    setup(parameters) {
        for (let p of parameters) {
            if (p.ramp) {
                parameterDescriptors.push(p);
                continue;
            }
            this.descriptors[p.name] = p;
            this[p.name] = p.defaultValue;
        }
    }
    change(id, value) {
        let p = this.descriptors[id];
        if(!p)return;
        let clampedValue = clamp(parseFloat(value), p.minValue, p.maxValue);
        this[id] = clampedValue;
        if(p.callback) p.callback(clampedValue);
        if (value == clampedValue) return id + " " + value;
        else return id + " clamped " + clampedValue;
    }
}

class Mixer{
    constructor(numTracks=64){
        this.tracks = [];
        for(let i=0;i<numTracks;i++)this.tracks.push({amp:1, pan:0, l:panL(0), r:panR(0)});
    }
    setTrack(n,pan=0,amp=1){
        this.tracks[n].pan = pan;
        this.tracks[n].amp = amp;
        this.tracks[n].l = panL(pan) *amp;
        this.tracks[n].r = panR(pan) *amp;
    }
    track(n,s,l,r,i){
        l[i] += s * this.tracks[n].l;
        r[i] += s * this.tracks[n].r;
    }
}

class MasterAmp{
    constructor(iniTarget){
        this.setTarget = new SetTarget(0, 0.1, iniTarget);
        this.gain = 0;
        this.preTarget = iniTarget;
        this.preMax = 0;
        this.prePeakL = this.prePeakR = 0;
        this.peakCount = 0;
        this.analyserInterval = round(0.5*Fs);
        this.sqSumL = this.sqSumR = 0;
    }
    change(v){
        this.setTarget.setValue(v);
        this.preTarget = v;
    }
    analyse(l,r,i,fi,processor){
        this.sqSumL += l[i] * l[i];
        this.sqSumR += r[i] * r[i];
        this.prePeakL = max( this.prePeakL, abs(l[i]) );
        this.prePeakR = max( this.prePeakR, abs(r[i]) );
        if(this.peakCount++<this.analyserInterval)return;
        let pl = this.prePeakL;
        let pr = this.prePeakR;
        this.preMax = max(pl, pr, this.preMax);
        let rmsLVal = sqrt(this.sqSumL/this.analyserInterval);
        let rmsRVal = sqrt(this.sqSumR/this.analyserInterval);
        processor.port.postMessage({id:"vu",value:{l:pl,r:pr,max:this.preMax,time:fi/Fs,rmsLVal,rmsRVal}});
        this.sqSumL = this.sqSumR = 0;
        this.prePeakL = this.prePeakR = this.peakCount = 0;
    }
    exec(l,r,i,fi,processor){
        this.analyse(l,r,i,fi, processor);
        let preMax = max( abs(l[i]), abs(r[i]) ), ma = preMax*this.gain;

        if (ma> 1){
            let target = this.gain/ma;
            if(this.preTarget<target)return;
            this.preTarget = target;
            this.setTarget.setValue(target);

            constParams.change("masterAmp",target);
            processor.port.postMessage(`masterAmp ${target}`);
            processor.port.postMessage({ id: "masterAmp", value: target });
        }

        this.gain = this.setTarget.exec();
        l[i] *= this.gain;
        r[i] *= this.gain;
    }
};

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

export {ParameterHandler, Mixer, MasterAmp, SetTarget}