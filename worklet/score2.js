
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

const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: changeMasterAmp },
    { type: "separator", value: "Reverb" },
    { name: 'reverbSeed', defaultValue: 1, minValue: 1, maxValue: 100, step:1, callback: initReverb  },
    { name: 'reverbTime', defaultValue: 5, minValue: 0.1, maxValue:30, callback: initReverb },
    { name: 'reverbIn', defaultValue: 0.5, minValue: 0.001, maxValue: 1,  callback: v => stReverbIn.setValue(v)  },
    { name: 'reverbOut', defaultValue: 0.5, minValue: 0.001, maxValue: 1,  callback: v => stReverbOut.setValue(v) },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]

let constParams = register(parameters,postSetup,aRateProcess,kRateProcess);

// mixer //////////////////////////////////////////////
let numTracks = 6;
let mixer = new Mixer(numTracks,1);
let reverb1, reverb2;
let stReverbIn = new SetTarget(0.5,0.1);
let stReverbOut = new SetTarget(0.5,0.1);

function initReverb(){
    let xorS = new XorShift(constParams.reverbSeed)
    reverb1 = ReverbSchroeder.create(constParams.reverbTime,xorS);
    reverb2 = ReverbSchroeder.create(constParams.reverbTime,xorS);
}
{
    initReverb();
    mixer.aux[0].setup(0,dBtoRatio(-26)*4,function rvbFunc(inL,inR,output){;
        let reverbIn = stReverbIn.exec();
        let reverbOut = stReverbOut.exec();
        output[0] = reverb2(inL*reverbIn) * reverbOut;
        output[1] = reverb1(inR*reverbIn) * reverbOut;
    });
    for(let i=0;i<numTracks;i++){
        mixer.tracks[i].setup(panDivide(i,numTracks,0.9), 0.8);
    }
}

// setup //////////////////////////////////////////////


let scale = [];
for(let i=0,a=[8,9,10,12,14];i<5;i++){
    for(let n of a)scale.push(12.5*n *2**i);
}
console.log(scale)

function criticalBandwidthERB(hz){ return 24.7 * (4.37e-3 * hz + 1); }
const criticalBandwidth =hz=>hz<500?hz:0.2*hz

function isMuddy(hz,n){
    for(let i=0;i<numTracks;i++){
        if(n==i)continue;
        let hz2 = synths[i].hz;
        if(hz == hz2)continue;
        if(isMuddySub(hz/2,hz2/2))return true; //  1oct下の osc2同士
        if(isMuddySub(hz/2,hz2))return true;
        if(isMuddySub(hz,hz2/2))return true;
    }
    return false;
} 

function isMuddySub(hz1, hz2) {
    if(hz1==hz2)return false;
    let centerHz  = (hz1+hz2)/2;
    let width = criticalBandwidthERB(centerHz);
    let diff = abs(hz1-hz2);
    
    if(diff <= width*0.5)return true;
    else false;
}

// {
// 　　// scaleは25 組み合わせは300
//     let count = 0;
//     for(let hz1 of scale){
//         for(let hz2 of scale ){
//             if(hz1>=hz2)continue;
//             if(isMuddySub(hz1/2,hz2/2))cLog([1,hz1,hz2,++count]);
//             else if(isMuddySub(hz1/2,hz2))cLog([2,hz1,hz2,++count]);
//             else if(isMuddySub(hz1,hz2/2))cLog([3,hz1,hz2,++count]);
//         }
//     }
// }

let adsrList = [];
let filterAdsr = [];
let filterBottom = new Array(numTracks).fill(500); // TODO: 移行
let filterDelta = new Array(numTracks).fill(500);

let _synth = {
    osc1:null,
    osc2:null,
    oscMiMod:null,
    adsr:null,
    filterAdsr:null,
    filter:null,
    filterBottom:500,
    filterDelta:500,
    lpFilterTop:null,
    pwmHz:2,
    pwmHzFM:0.2*twoPIoFs,
    pwmPhase:0,
    oscMixMod:0.01*twoPIoFs,
    hz:0,
    halfHz:0,
    lastOnFrame:-Fs,
}

let synths = [];

function postSetup(waveTables){
    for(let i=0; i<numTracks;i++){
        synths[i] = Object.assign({},_synth);
        let synth = synths[i];
    
        adsrList.push(new ADSR(0.2, 0.2, 0.2, 2))
        filterAdsr.push(new ADSR(0.2, 0.2, 0.3, 2))
        
        synth.lpFilterTop = Filter.create(1,"lp",800);
        synth.filter = FilterBq.create(400,1,"lp");
        synth.osc1 = PulseOsc.create(waveTables.saw32);
        synth.osc2 = PulseOsc.createOneUseInstance(waveTables.tri32);
        synth.pwmHzFM = rand(0.2,0.3) *twoPIoFs; // plus -1 to 1
    }
    randOn(0);
}

function randOn(frame){
    let n = randInt(numTracks-1);
    let synth = synths[n];


    if(frame-synth.lastOnFrame<Fs*0.1)return;
    synth.lastOnFrame = frame;

    do{
        let r = random()**1.5;
        let maxNoteNum = scale.length* sqrt(1-adsrList[n].gain);
        synth.hz = scale[floor(r * maxNoteNum )];
    }
    while(isMuddy(synth.hz,n));
    
    let hz = synth.hz;
    synth.halfHz = hz/2;
    
    synth.pwmHz = rand(1.5,2) +log2(hz/100)*0.2;
    synth.oscMixMod = rand(0.01,0.05)*twoPIoFs;

    let a = rand(0.5,6) * exp(-hz/3200);
    adsrList[n].setA(a);
    filterAdsr[n].setA(a);
    let d = rand(0.5,6) * exp(-hz/3200);
    adsrList[n].setD(d);
    filterAdsr[n].setD(d);

    let vol = lerp(1, 0.15, hz/2800) * sqrt( random() );
    adsrList[n].noteOn(vol);
    filterAdsr[n].noteOn();
    // let filTop = fractionCurve(hz/2800,-5) * 1800;
    let filTop = lerp(0.3,1,hz/2800) * 1800;
    
    filterBottom[n] = filTop/2;
    filterDelta[n] = filTop- filterBottom[n];
}
// process //////////////////////////////////////////////
function kRateProcess(bufferI,bufferLen,processor){
    // let num = 0;
    // for(let s of synths){if(s.hz!=0)num++}
    // processor.info(num)
}

function aRateProcess(L,R,bufferI,frame){
    if(coin(0.55/Fs))randOn(frame);
    if(coin(1/Fs))adsrList[randInt(numTracks-1)].noteOff();

    for(let i=0; i<numTracks; i++){
        let synth = synths[i];
        if(synth.hz == 0)continue;
        synth.pwmPhase += (synth.pwmHz+sin(frame*synth.pwmHzFM) ) *twoPIoFs;
        let pwm = sin(synth.pwmPhase);
        let s1 = synth.osc1(synth.hz,  0.25+pwm*0.07);
        let s2 = synth.osc2(synth.halfHz,0.25) *0.8;
        let s = lerp(s1,s2,uni( sin(frame*synth.oscMixMod) ));
        let filterLv = filterBottom[i] +synth.lpFilterTop( filterDelta[i] );
        filterLv *=  filterAdsr[i].exec();
        s  = synth.filter(s, filterLv );
        let lv = adsrList[i].exec();
        if(lv <= 0)synth.hz = 0;
        s *= lv;
        mixer.tracks[i].input1ch(s);
    }
    mixer.output(L,R,bufferI);

}
