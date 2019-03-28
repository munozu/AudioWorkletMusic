import * as wavModule from "/wav.js";
import { XorShift, Mixer, ParameterHandler, MasterAmp } from "/class.js";
import {SetTarget, EnvelopeQuadratic, ADSR, NoiseLFO, } from "/class.js";
import {Filter, FilterBq, Delay, ReverbSchroeder, Sampler, WaveTableOsc, PulseOsc } from "/class.js";


const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs, twoPIoFs = 2*Math.PI/Fs;
function cLog(obj){console.log(JSON.stringify(obj))} 
function doNothing(arg){return arg}

//math
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;
const lerp = function(a,b,amt=0.5){return a*(1-amt) + b*amt};
const clamp = (n, mi, ma) => max(mi, min(ma, n));

// curve
function cosI(x){return (1-cos(x*PI))/2;}// 偶関数
function cosINeg(x,a=1){ return (1+a)*x-cosI(x)*a; }
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
,   panL =function(x){return cos(quarterPI*(1+x));}
,   panR =function(x){return sin(quarterPI*(1+x));}

const panDivide=(n=0,total=4,width=0.8) => -width + n*width*2/(total-1);
function envelopeAD(t,a=0.01,d=1){ return (t<a)?(1/a)*t : max(0, 1-(t-a)*(1/d) ); }
function envelopeToTpT(t,peak=1,curve=1){ return pow(t/peak, (peak-t)/curve); }
function envelopeQuadratic(t,sec=2){ return max(0, 1-4/sec/sec*pow(t-sec/2, 2) ); }

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

const parameterDescriptors = [];
const constParams = new  ParameterHandler();
class Processor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
        constParams.processor = this;
    }
    static get parameterDescriptors() {
        return parameterDescriptors;
    }
    handleMessage(event) {
        let id = event.data.id, value = event.data.value;
        constParams.change(id, value, true);
    }
    info(v){
        this.port.postMessage(v.toString());
    }
}
Processor.prototype.process = processWrapper;

class WavCreator extends Processor {
    constructor() {
        super();
        this.port.onmessage = function(e){
            try {
                if(e.data=="record"){
                    recording = !recording;
                    if(!recording)this.port.postMessage(wavModule.get());
                }
                else this.exportWav(e.data);
            } catch (error) {
                this.port.postMessage("Wav Creator Error");
            }
        }.bind(this);
    }
    exportWav(sec){
        exporting = true;
        this.port.postMessage( wavModule.exportWav(sec, processWrapper) );
        exporting = false;
    }
}
class Setup extends Processor {
    constructor() {
        super();
        let params = JSON.parse(JSON.stringify(parameters));
        this.port.onmessage = function(e){
            waveTables = e.data.waveTables;
            this.port.postMessage(params);
            postSetup();
        }.bind(this);
    }
}

let waveTables, masterAmp, recording=false, exporting=false;
function setup(){
    constParams.setup(parameters);
    masterAmp = new MasterAmp(constParams.masterAmp);
    registerProcessor('processor', Processor);
    registerProcessor('setup', Setup);
    registerProcessor('wavCreator', WavCreator);
}
function processWrapper (inputs, outputs, parameters) {
    const L = outputs[0][0];
    const R = outputs[0][1];
    const bufferLen = L.length;
    kRateProcess(frame,bufferLen);
    
    for(let i=0; i<bufferLen; i++){
        const fi = frame + i; 
        process(L,R,i,fi,this);
    }
    if(recording){ for(let i=0; i<bufferLen; i++)wavModule.record(L[i],R[i]); }
    if(!exporting){ for(let i=0; i<bufferLen; i++)masterAmp.exec(L,R,i,frame+i,this,constParams) };
    frame += bufferLen;
    return true;
};

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////
function kRateProcess(){}
function postSetup(){}

let frame = Fs*0;
const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: v => masterAmp.change(v) },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]

constParams.setup(parameters);
masterAmp = new MasterAmp(constParams.masterAmp);
setup();

let baseList = [6,7.5,8,9,10,12,15,16,18,20,24,30];
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
let numTracks = baseList.length;
let phaseList = new Array(numTracks).fill(0);
let vibPhaseList = new Array(numTracks).fill(0);
let shapers = [tanh,s=>sineCurve(s),s=>s,s=>s*s*s];

let vol = 0.45;

let mixer = new Mixer(numTracks);
for(let i=0;i<numTracks;i++){
    let b = baseList[i];
    mixer.tracks[i].setup(  (b*13.27)%2-1, vol );
}

function process(L,R,bufferI,fi){
    for(let j=0;j<numTracks;j++){
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
        mixer.tracks[j].input1ch(s);
    }
    mixer.output(L,R,bufferI)
}