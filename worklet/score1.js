
import {register,changeMasterAmp} from "./processor.js"
import {EnvelopeQuadratic, ADSR, NoiseLFO, } from "./class.js";
import {Filter, FilterBq, Delay, FeedForwardDelay, FeedbackDelay, ReverbSchroeder, Stutter, Sampler, WaveTableOsc, PulseOsc } from "./class.js";
import { XorShift, Mixer, SetTarget } from "./mixer.js";

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

//wave
const uni  =function(v){return (v+1)/2}
,   noise  =function( ){return random()*2-1};

// sound
const midiHz=((y=[])=>{for(let i=0;i<128;i++)y[i]=440*2**((i-69)/12);return y;})()
,   ratioToDB=ratio=> 20*log10(ratio)
,   dBtoRatio=dB=> pow(10,(dB/20))
,   octave=function(hz,oct=0){return hz*pow(2,oct);}
,   panL =function(x){return cos(quarterPI*(1+x));}
,   panR =function(x){return sin(quarterPI*(1+x));}
,   panDivide=(n=0,total=4,width=0.8) => -width + n*width*2/(total-1);

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

function kRateProcess(){}
function postSetup(){}

const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: changeMasterAmp },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]

let constParams = register(parameters,postSetup,aRateProcess,kRateProcess);

let baseList = [12/2,15/2,8,9,10,12,15,16,18,20,24,30];
let hzList = baseList.map(v=>v*25);
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

function cubicShaper(s){return s*s*s*1.2;}
let shapers = [
    tanh,tanh,
    doNothing,doNothing,
    doNothing,doNothing,
    sineCurve,sineCurve,
    sineCurve,sineCurve,
    cubicShaper,cubicShaper
];

let vol = 0.4;

let mixer = new Mixer(numTracks);
for(let i=0;i<numTracks;i++){
    let pan = (i%2===0?1:-1);
    let n = i - (i%2===0?0:1);
    pan *= 1 -n/numTracks;
    pan *= 0.7;
    mixer.tracks[i].setup(  pan, vol );
}

let sinMinus1 = 0.75*twoPI;
function aRateProcess(L,R,bufferI,fi){
    for(let i=0;i<numTracks;i++){
        vibPhaseList[i] += lfoVibC[i] * ( 0.2 + uni( sin(fi*lfoVibM[i]) ) );
        let vib = sin( vibPhaseList[i]  )*0.3/12;

        phaseList[i] += octave(hzList[i], vib)*twoPIoFs;
        let mod = sin(phaseList[i]) *0.3 *uni( sin(fi*lfoPMAmp[i]) )
        let s = lerp( sin(phaseList[i] + mod), sin(fi*hzList[i]*twoPIoFs), phaserList[i] );
        s *= uni( sin(fi*lfo1[i] +sinMinus1) );
        s *= uni( sin(fi*lfo4[i] +startList[i]) );
        s *= uni( sin(fi*lfo2[i]) );
        s *= uni( sin(fi*lfo3[i]) );
        s = shapers[i](s);
        mixer.tracks[i].input1ch(s);
    }
    mixer.output(L,R,bufferI)
}