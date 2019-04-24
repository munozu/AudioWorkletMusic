
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
    { type: "separator", value: "t/t^t Envelope" },
    { name: 'randomEnvelope',  defaultValue: 1,   minValue: 0,    maxValue: 1, step:1 },
    { name: 'carrierPeakTime', defaultValue: 0.1, minValue: 0.01, maxValue: 2, exp: 1, unit:"sec" },
    { name: 'carrierCurve',    defaultValue: 3,   minValue: 0.01, maxValue: 5, exp: 2 },
    { name: 'ringPeakTime',    defaultValue: 0.2, minValue: 0.01, maxValue: 2, exp: 2, unit:"sec" },
    { name: 'ringCurve',       defaultValue: 0.1, minValue: 0.01, maxValue: 5, exp: 2 },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]
let constParams = register(parameters,postSetup,aRateProcess,kRateProcess);

// mixer //////////////////////////////////////////////
let numTracks = 8;
let mixer = new Mixer(numTracks,1);
for(let i=0;i<numTracks;i++){
    mixer.tracks[i].setup( panDivide(i,numTracks,0.9), 0.5, null, 0.2 +abs( panDivide(i,numTracks,0.8) ) );
}
let xorS = new XorShift(17);
let reverb1 = ReverbSchroeder.create(5,xorS);
let reverb2 = ReverbSchroeder.create(5,xorS);
mixer.aux[0].setup(0,dBtoRatio(-26),function rvbFunc(inL,inR,output){
    output[0] = reverb1(inL)
    output[1] = reverb2(inR)
})

// setup //////////////////////////////////////////////
function envelopeAD(t,a=0.01,d=1){ return (t<a)?(1/a)*t : max(0, 1-(t-a)*(1/d) ); }
function envelopeToTpT(t,peak=1,curve=1){ return pow(t/peak, (peak-t)/curve); }
function envelopeQuadratic(t,sec=2){ return max(0, 1-4/sec/sec*pow(t-sec/2, 2) ); }
let list = [], waitList = [];
let thresholdEnd = 100/(2**16*0.5);
let tt = 1/44100;
function addNote(indInSec){
    if(list.length+waitList.length>12)return;
    let hz = randChoice([10,10,12,15,9*2])*100*2**randInt(-3,0);

    let a, d, ma, md;
    let cp = constParams;
    if(cp.randomEnvelope===0){
        a = cp.carrierPeakTime;
        d = cp.carrierCurve;
        ma = cp.ringPeakTime;
        md = cp.ringCurve;
    }
    else{
        a = 0.01 + 2 *random()**1.5;
        let thresholdAttack = (1-exp(-hz/1000));
        let maxD = log10(pow(tt/a,a-tt))/log10( thresholdAttack );
        d = min(maxD, rand(0.01,5));
        ma = rand(0.01,1);
        md = 0.01 + random()**3 *5;
        if(a<0.3)ma = min(a*2,ma);
    }
    
    let obj = {
        trk: randInt(numTracks-1),
        vel: random()*exp(-(hz-100)/1300),
        ringLv: exp(-(hz-100)/1000) *0.7,
        vibratoHz: rand(5,min(100,hz/2))*twoPIoFs,
        vibratoLv: rand(1)/12,
        pitchEnvD: random()**3*0.1,
        pitchEnvHz: randInt(-1,1)*12.5,
        t:0,
        osc1: WaveTableOsc.createOneUseInstance(waveTables.tri32),
        hz, a, d, ma, md,
    }
    list.push(obj);

    if(a>0.4)return;
    if(coin(0.5))initDelay();
    let l = randInt(5);
    for(let i=1,t=0;i<=l;i++){
        if(list.length+waitList.length>16)return;
        t += dTime*i**dTimeExp;
        let pan = dPanFunc(obj.trk);
        let gain = dGain**i;
        addDelay(indInSec, obj,t, gain,pan,i);
        for(let j=1,t2=0;j<=dSub;j++){
            t2 += dSubTime*j**dSubExp;
            addDelay(indInSec, obj, t +t2, gain*dSubGain**j,pan,i+j);
        }
    }
}
let dTime, dTimeExp, dGain, dSub, dPanFunc, dSubTime, dSubExp, dSubGain;
function initDelay(){
    dTime = sqrt(random());
    dTimeExp = randChoice([-0.5,-0.25, 0, 0.25,0.33])
    dGain = rand(0.7,0.9);
    dPanFunc = randChoice([doNothing,randomPanTrk,randomPanTrk])
    dSub = 5*random()**1.7;
    dSubGain = rand(0.7,0.9);
    dSubTime = rand(2,5)
    dSubExp = randChoice([-0.25,0.25])
}
initDelay();

function addDelay(indInSec, obj,t,vol,trk,count){
    let delayed = Object.assign({},obj);
    if(trk)delayed.trk = trk;
    delayed.hz += (coin()?1:-1) * rand(count*0.05,count*0.05);
    delayed.t = -t;
    delayed.ringLv *= 0.5**count;
    delayed.vel *=vol
    delayed.osc1 = WaveTableOsc.createOneUseInstance(waveTables.tri32);
    delayed.waitSec = 0;
    while(delayed.t<-1){
        delayed.waitSec++
        delayed.t++;
    }
    if(delayed.waitSec){
        delayed.t += (1-indInSec)*Ts;
        waitList.push(delayed);
    }
    else list.push(delayed);
}
function randomPanTrk(){return randInt(numTracks-1)}


let masterHp1 = Filter.create(50,"hp")
let masterHp2 = Filter.create(50,"hp")
let masterLp1 = Filter.create(1000,"lp")
let masterLp2 = Filter.create(1000,"lp")
let envQuad = new EnvelopeQuadratic(10);

function postSetup(_waveTables){
    waveTables = _waveTables;
    addNote(0);
}

// process //////////////////////////////////////////////
function kRateProcess(bufferI,bufferLen){
    let tempList = [];
    for(let obj of list){
        if(obj.t<1 || obj.cAmp > thresholdEnd )tempList.push(obj);
    }
    list = tempList;
}

function aRateProcess(L,R,bufferI,fi,processor){
    let indInSec = fi%Fs;
    if(indInSec==0){
        let tempList = [];
        for(let obj of waitList){
            obj.waitSec--;
            if(!obj.waitSec)list.push(obj);
            else tempList.push(obj);
        }
        waitList = tempList;
    }
    if(coin(0.7/Fs))addNote(indInSec);
    for(let i=0, l= list.length;i<l;i++){
        let obj = list[i];
        obj.t += Ts;
        if(obj.t<0)continue;
        
        let vibLv = envQuad.exec(obj.t) *obj.vibratoLv;
        let hz = octave( obj.hz, vibLv*sin(fi*obj.vibratoHz) );
        hz = hz + obj.pitchEnvHz * envelopeAD(obj.t,0.0,obj.pitchEnvD)
        let s = obj.osc1(hz);
        
        let ringLv = envelopeToTpT(obj.t,obj.ma,obj.md) *obj.ringLv;
        s = lerp(s,s*sin(14/3*fi*obj.hz*twoPIoFs),ringLv)
        obj.cAmp = envelopeToTpT(obj.t,obj.a,obj.d) *obj.vel;
        s = s * obj.cAmp ;
        mixer.tracks[obj.trk].input1ch(s);
    }
    
    mixer.output(L,R,bufferI)
    L[bufferI] = masterHp1(L[bufferI])
    R[bufferI] = masterHp2(R[bufferI])
    L[bufferI] = masterLp1(L[bufferI])
    R[bufferI] = masterLp2(R[bufferI])
}
