
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
let waveTables;
const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: changeMasterAmp },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 1, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]
const constParams = register(parameters,postSetup,aRateProcess,kRateProcess);

function envelopeAHD(t, a=1, h=1, d=1, endCallback=doNothing){
    if(t<a)return lerp(0,1,t/a);
    if(t<a+h)return 1;
    if(t<a+h+d) return lerp(1,0,(t-a-h) /d);
    endCallback();
    return 0;
}

class MonoTrack{
    constructor(){
        this.buffer = 0;
    }
    input(s){
        this.buffer += s;
    }
    output(){
        let tmp = this.buffer;
        this.buffer = 0;
        return tmp;
    }
}
// mixer //////////////////////////////////////////////
const numTracks = 1;
const mixer = new Mixer(numTracks,0);
{

    mixer.tracks[0].setup( 0, 1, null );

    let xorS = new XorShift(1)
    let reverb1 = new ReverbSchroeder(0.2,xorS);
    let reverb2 = new ReverbSchroeder(0.2,xorS);
    
    console.log(reverb1.logTxt);
    console.log(reverb2.logTxt);

    function rvbFunc(inL,inR,output){
        output[0] = reverb1.exec(inL);
        output[1] = reverb2.exec(inR);
    }
    // mixer.aux[0].setup(0,dBtoRatio(-60),rvbFunc);
}

// setup //////////////////////////////////////////////

let scale = [];
for(let oct=-3;oct<=1;oct++){
    for(let n of [8,9,11,12,15])scale.push(n*100*2**oct);
}
{
    let tmp = [scale[0]];
    for(let i=1;i<scale.length;i++){
        if( scale[i] - tmp[tmp.length-1] >40)tmp.push(scale[i]); 
        else tmp.push(tmp[tmp.length-1]);
    }
    scale = tmp;
    console.log(scale)
}

function postSetup(_waveTables){
}

const Loudness = new class  {
    constructor(){
        let phon40dB = [99.85, 93.94, 88.17, 82.63, 77.78, 73.08, 68.48, 64.37, 60.59, 56.7, 53.41, 50.4, 47.58, 44.98, 43.05, 41.34, 40.06, 40.01, 41.82, 42.51, 39.23, 36.51, 35.61, 36.65, 40.01, 45.83, 51.8, 54.28, 51.49, 51.96, 92.77]
        this.ampList = phon40dB.map(v=>dBtoRatio(v-70));
    }
    getEqualAmp(hz){
        let ind =log(hz/20)/log(1.26); // hz = 20*1.26**x
        let x1 = floor(ind), x2=x1+1, amt = ind-x1;
        return lerp(this.ampList[x1],this.ampList[x2],amt);
    }
}
// process //////////////////////////////////////////////
function kRateProcess(frame,bufferLen,processor){
}


function aRateProcess(L,R,bufferInd,frame,processor){
    //ring or am
    // L[bufferInd] = R[bufferInd] = sin(200*twoPIoFs*frame)*sin(50*twoPIoFs*frame)
    // L[bufferInd] = R[bufferInd] = sin(200*twoPIoFs*frame)*(1+sin(50*twoPIoFs*frame))/2
    // return 

    // loudness
    let s = 0;
    for(let i=1;i<50;i++){
        let hz = 100*i;
        s += sin(frame*hz*twoPIoFs) * Loudness.getEqualAmp(hz);
    }
    L[bufferInd] = R[bufferInd] = s  /4;
}

function step(v, st=0.5){ let c=1/st; return parseInt(v*c)/c; } 