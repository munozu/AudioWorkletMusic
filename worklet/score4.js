
import {register,changeMasterAmp} from "../worklet/processor.js"
import {EnvelopeQuadratic, ADSR, NoiseLFO, } from "../worklet/class.js";
import {Filter, FilterBq, Delay, FeedForwardDelay, FeedbackDelay, ReverbSchroeder, Stutter, Sampler, WaveTableOsc, PulseOsc } from "../worklet/class.js";
import { XorShift, Mixer, SetTarget } from "../worklet/mixer.js";

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
    { name: 'pitch', defaultValue: 1, minValue: 0.001, maxValue: 2, exp: 2 },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 1, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]
const constParams = register(parameters,postSetup,aRateProcess,kRateProcess);


// mixer //////////////////////////////////////////////
const numTracks = 2;
const mixer = new Mixer(numTracks,1);
{
    let delFilterL = Filter.create(3000)
    let delL = Delay.create(4, 0.7, 1,delFilterL);
    let delR = FeedForwardDelay.create(2);
    function delaySt(inL,inR,output){
        output[0] = inL *0.7; //dry
        output[1] = inR *0.7;
        let wetL = delL((inL+inR)/2) * 0.5;
        output[0] += wetL
        output[1] += delR(wetL);
    }

    let delSawL = FeedbackDelay.create(5, 0.7, 6);
    let delSawR = FeedbackDelay.create(5, 0.7, 6);
    function delaySaw(l,r,output){
        output[0] = l +delSawL(l)
        output[1] = r +delSawR(r)
    }
    mixer.tracks[0].setup( 0, 0.75, delaySt );
    let trk1Vol = 0.08;
    mixer.tracks[1].setup( 0, trk1Vol, delaySaw, trk1Vol*5);

    let xorS = new XorShift(25)
    let reverb1 = new ReverbSchroeder(5,xorS);
    let reverb2 = new ReverbSchroeder(5,xorS);
    
    console.log(reverb1.logTxt);
    console.log(reverb2.logTxt);
    function rvbFunc(inL,inR,output){
        output[0] = reverb1.exec(inL);
        output[1] = reverb2.exec(inR);
    }
    mixer.aux[0].setup(0,dBtoRatio(-28),rvbFunc);
}

// setup //////////////////////////////////////////////

let scale = [], mainScale = [];
for(let oct=-2;oct<=-1;oct++){
    for(let n of [8,8,8,8,9,10,10,11,12,12,12,13,14,14,15])scale.push(n*100*2**oct);
    for(let n of [9,10,12,15])mainScale.push(n*100*2**oct);
}

function waveShaperCubic(s,k=0.5){
    let area = (1+k)/2 - k/4;
    let amp = 0.5/area;
    return ((1+k)*s - k*s*s*s) *amp;
}
function fade(x, sec=0.01, sec2=sec){
    for(let i=0, c=round(sec *Fs); i<c; i++)x[i]*=i/c;
    for(let i=0, c=round(sec2*Fs), la=x.length-1; i<c; i++)x[la-i]*=i/c;
    return x;
};

let noiseSample = [];
let sampleBaseHz = 400;
{
    let lp = FilterBq.create(sampleBaseHz  ,0.1,"bp");
    let hp = FilterBq.create(sampleBaseHz/2,1,  "hp");
    let del = Delay.create(1/sampleBaseHz,0.9,1)
    for(let i=0, l=Fs*10; i<l; i++){
        let s = noise() *40;
        s = del(s)
        s = lp(s) 
        s = hp(s)
        noiseSample.push(s)
    }
    fade(noiseSample,0.01)
} // noise sample

let sampler = Sampler.createOneUseInstance(noiseSample,sampleBaseHz);
let noteHz = scale[0];
let noteLp = Filter.create(1,"lp",noteHz)
let noteN = 0;
let nextTime = 2;
let osc1, saw1, saw2;

function postSetup(_waveTables){
    waveTables = _waveTables;
    osc1 = new WaveTableOsc(waveTables.tri32);
    saw1 = WaveTableOsc.createOneUseInstance(waveTables.saw32);
    saw2 = WaveTableOsc.createOneUseInstance(waveTables.saw32);
    adsr.noteOn();
}

let adsr = new ADSR(1,1,0.3,1);
let nLfo1 = NoiseLFO.create(5,cosI,random);
let nLfo2 = NoiseLFO.create(1,cosI,noise);

// process //////////////////////////////////////////////
let noteOffReservationState = 2;// 0:on, 1:off reserved, 2:off
function kRateProcess(frame,bufferLen){
    if(nextTime<frame*Ts){
        if(noteOffReservationState==1){
            adsr.noteOff();
            noteOffReservationState = 2;
            nextTime += rand(1,4);
            return;
        }
        else if(noteOffReservationState==0 && coin(0.2)){
            noteOffReservationState = 1;
            nextTime += rand(1,4);
        }
        else{
            let tempN = noteN;
            while(tempN==noteN){
                tempN += randInt(-5,5);
                tempN = clamp(tempN,0,scale.length-1);
            }
            noteN = tempN;
            noteHz = scale[noteN];
            adsr.noteOn();
            noteOffReservationState = 0;
            if(mainScale.includes(noteHz))nextTime += rand(1,1.5);
            else nextTime += rand(0.1,0.3);
        }
    }   
}

let accOsc1 = 0,  accOsc1Mod = 0;
let filterSaw = FilterBq.create(1600,1,"bp");
let nLfoSawAmp1 = NoiseLFO.create(10,cosI,_=>random()**30);
let nLfoSawAmp2 = NoiseLFO.create(10,cosI,_=>random()**30);
let nLfoSawPan = NoiseLFO.create(15,cosI,noise);
let sawLv = 0, sawLvInc = 1/Fs/1;
let sawDel = Delay.create(0.005,0,0.5);
function aRateProcess(L,R,bufferInd,frame,processor){
    let hz = ( noteLp(noteHz*constParams.pitch) );
    let adsrAmp = adsr.exec();
        
    let hzMod = octave(hz,nLfo2()*0.3/12);
    let s0 = sampler(hzMod) *adsrAmp * nLfo1();
    
    accOsc1 += hz/Fs;
    accOsc1Mod += hz*twoPIoFs/2;
    let s1 = osc1.exec(accOsc1 +sin(accOsc1Mod)*.3, hz);
    s1 = waveShaperCubic(s1,adsrAmp);
    s1 *= adsrAmp;

    let s= lerp(s0,s1,.25);
    mixer.tracks[0].input1ch(s);

    // let sawS = lerp( 
    //     saw1(1600*constParams.pitch)*nLfoSawAmp1(), 
    //     saw2(1800*constParams.pitch)*nLfoSawAmp2(), 
    //     0.4
    // );
    // sawLv = min(1, sawLv + sawLvInc );
    // sawS = filterSaw( sawS*sawLv );
    // sawS = sawDel(sawS,0.004+sin(frame*twoPIoFs)*0.002)
    // mixer.tracks[1].input1to2ch( sawS, nLfoSawPan() );

    mixer.output(L,R,bufferInd);
}

