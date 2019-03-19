const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
//math
//Object.getOwnPropertyNames(Math).forEach(p=>self[p]=Math[p]);
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;
const lerp = function(a,b,amt=0.5){return a*(1-amt) + b*amt};
const clamp = (n, mi, ma) => max(mi, min(ma, n));

// curve
function cosI(x){return (1-cos(x*PI))/2;}// 偶関数
function sineCurve(x){ return sin(halfPI*x); }// 奇関数
function fractionCurve(x, k=-2){ return (-k+1)*x/(-k*x+1); }//  k<1. 0で直線, -2くらいで^0.5付近

//random
function coin(arg=0.5){return (random()<arg)?true:false;}
function rand(min=1,max=0){return min + random()*(max-min);}
function randChoice(l){return l[floor(random()*l.length)];}
function randInt(min=1,max=0){
    if(max<min)[min,max] = [max,min];
    return min + floor( random()*(max-min+1) );
}
function shuffle(array, m=Math) {
    for(let i=0, l=array.length-1, a=l+1, r; i<l; i++){
        r = floor(m.random() *a);
        [array[i],array[r]] = [array[r],array[i]];
    }
    return array;
}
class XorShift{
    constructor(s = 0x87654321){this.u = new Uint32Array([s]);}
    random(){
        this.u[0] ^= this.u[0] <<  13;
        this.u[0] ^= this.u[0] >>> 17;
        this.u[0] ^= this.u[0] <<   5;
        return this.u[0]/4294967296;
    }
}

//wave
const uni  =function(v){return (v+1)/2}
,   noise  =function( ){return random()*2-1}
,   siT    =function(t){return sin(twoPI*t)}
,   tri    =function(t){return abs((((t+1/4)*4)+2)%4 -2)-1}
,   saw    =function(t){return (t*2+1)%2 -1}
,   square =function(t){return ((t*2+1)%2 -1) - (((t+0.5)*2+1)%2 -1)}
,   pulse  =function(t, duty=0.5){return saw(t) - saw(t+duty)}
,   pulse1 =function(t, duty=0.5){return (t-floor(t))<duty?-1:1}

// sound
const midiHz=((y=[])=>{for(let i=0;i<128;i++)y[i]=440*2**((i-69)/12);return y;})()
,   ratioToDB=ratio=> 20*log10(ratio)
,   dBtoRatio=dB=> pow(10,(dB/20))
,   octave=function(hz,oct=0){return hz*pow(2,oct);}
,   panR =function(x){return sin(quarterPI*(1+x));}
,   panL =function(x){return cos(quarterPI*(1+x));}

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

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

class Mixer{
    constructor(numTracks=16){
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
    constructor(){
        this.setTarget = new SetTarget(0, 0.1, constParams.masterAmp);
        this.gain = 0;
        this.preTarget = 1;
        this.preMax = 0;
        this.prePeakL = 0;
        this.prePeakR = 0;
        this.peakCount = 0;
        this.analyserInterval = round(0.5*Fs);
    }
    change(v){
        this.setTarget.setValue(v);
        this.preTarget = v;
    }
    analyse(l,r,i,fi, processor){
        this.prePeakL = max( this.prePeakL, abs(l[i]) );
        this.prePeakR = max( this.prePeakR, abs(r[i]) );
        if(this.peakCount++<this.analyserInterval)return;
        let pl = this.prePeakL;
        let pr = this.prePeakR;
        this.preMax = max(pl, pr, this.preMax);
        processor.port.postMessage({id:"vu",value:{l:pl,r:pr,max:this.preMax,time:fi/Fs}});
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

const constParams = {
    descriptors: {},
    setup(parameters) {
        for (let p of parameters) {
            if (p.ramp) {
                parameterDescriptors.push(p);
                continue;
            }
            this.descriptors[p.name] = p;
            this[p.name] = p.defaultValue;
        }
    },
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
,   parameterDescriptors = [];

/////////////////////////////////////////////////////////////////////////
class Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }
    static get parameterDescriptors() {
        return parameterDescriptors;
    }
    handleMessage(event) {
        let id = event.data.id, value = event.data.value;
        let result = constParams.change(id, value, this);
        if(result)this.port.postMessage(result);
    }
}

let mixer, masterAmp;
function setup(){
    constParams.setup(parameters);
    mixer = new Mixer();
    masterAmp = new MasterAmp();
    
    Processor.prototype.process = process;
    registerProcessor('processor', Processor);
    registerProcessor('setup', class extends Processor {
        constructor() {
            super();
            let t = this;
            let param = JSON.parse(JSON.stringify(parameters));//callback関数を除去
            this.port.onmessage = _ => t.port.postMessage(param);
        }
    });
}

/////////////////////////////////////////////////////////////////////////
const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: v => masterAmp.change(v) },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]
setup();
/////////////////////////////////////////////////////////////////////////

let baseList = [6,7.5,8,9,10,12,15,16,18,20,24,30]
let hzList = baseList.map(v=>v*20);
let lfoPMAmp = baseList.map(v=>v*0.017/Fs*twoPI);
let lfo1 = baseList.map(v=>v*0.011/Fs*twoPI);
let lfo2 = baseList.map(v=>8/v/Fs*twoPI);
let lfo3 = baseList.map(v=>11/v/Fs*twoPI);
let lfo4 = baseList.map(v=>0.01/v/Fs*twoPI);
let lfoVibC = baseList.map(v=>2*sqrt(v)/Fs*twoPI);
let lfoVibM = baseList.map(v=>v/100/Fs*twoPI);
let startList = baseList.map(v=>sin(v*7)*twoPI);
let phaserList  = baseList.map(v=>uni(sin(v*5)));

let length = baseList.length;
let phaseList = new Array(length).fill(0);
let vibPhaseList = new Array(length).fill(0);
let shapers = [tanh,s=>sineCurve(s),s=>s,s=>s*s*s];

let frame = Fs*0;
let vol = 0.5;
for(let i=0,l=baseList.length;i<l;i++){
    let b = baseList[i];
    mixer.setTrack( i, (b*6.55)%2-1, vol );
}

function process(inputs, outputs, parameters) {
    const outL = outputs[0][0];
    const outR = outputs[0][1];
    const bufferLen = outL.length;
    
    for(let i=0; i<bufferLen; i++){
        const fi = frame + i; 
        /////////////////////////////////////////////////////////////////////////
        for(let j=0;j<length;j++){
            vibPhaseList[j] += lfoVibC[j] * ( 0.2 + uni( sin(fi*lfoVibM[j]) ) );
            let vib = sin( vibPhaseList[j]  )*0.3/12;

            phaseList[j] += octave(hzList[j], vib)*twoPI/Fs;
            let mod = sin(phaseList[j]) *0.3 *uni( sin(fi*lfoPMAmp[j]) )
            let s = lerp( sin(phaseList[j] + mod), sin(fi*hzList[j]*twoPI/Fs), phaserList[j] );
            s *= uni( sin(fi*lfo1[j] -0.25*twoPI) );
            s *= uni( sin(fi*lfo4[j] +startList[j]) );
            s *= uni( sin(fi*lfo2[j]) );
            s *= uni( sin(fi*lfo3[j]) );
            s = shapers[j%4](s);
            // s += noise()*0.01
            mixer.track(j,s,outL,outR,i);
        }
        /////////////////////////////////////////////////////////////////////////
    }
    
    for(let i=0; i<bufferLen; i++)masterAmp.exec(outL,outR,i,frame+i,this);
    frame += bufferLen;
    return true;
}
