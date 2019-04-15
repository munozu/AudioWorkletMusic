console.log("score.js")
import {register,changeMasterAmp} from "/worklet/processor.js"
import {EnvelopeQuadratic, ADSR, NoiseLFO, } from "/worklet/class.js";
import {Filter, FilterBq, Delay, FeedForwardDelay, FeedbackDelay, ReverbSchroeder, Stutter, Sampler, WaveTableOsc, PulseOsc } from "/worklet/class.js";
import { XorShift, Mixer, SetTarget } from "/worklet/mixer.js";

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
const mixer = new Mixer(numTracks,1);
{

    mixer.tracks[0].setup( 0, 1, null , 1);

    let xorS = new XorShift(1)
    let reverb1 = new ReverbSchroeder(0.2,xorS);
    let reverb2 = new ReverbSchroeder(0.2,xorS);
    
    console.log(reverb1.logTxt);
    console.log(reverb2.logTxt);

    function rvbFunc(inL,inR,output){
        output[0] = reverb1.exec(inL);
        output[1] = reverb2.exec(inR);
    }
    mixer.aux[0].setup(0,dBtoRatio(-30),rvbFunc);
}

// setup //////////////////////////////////////////////

let scale = [];
for(let oct=-3;oct<=0;oct++){
    for(let n of [8,9,11,12,15])scale.push(n*100*2**oct);
}
{
    let tmp = [scale[0]];
    for(let i=1;i<scale.length;i++){
        if( scale[i] - tmp[tmp.length-1] >40)tmp.push(scale[i]); 
    }
    scale = tmp;
}

function postSetup(_waveTables){
}


// process //////////////////////////////////////////////
let notes = [];
let numPans = 9;
let monoTracks = new Array(numPans).fill(0).map(v=>new MonoTrack());
let stutters = new Array(numPans).fill(0).map(v=>new Stutter());
function nLfoInterpolate(v){return pow(v,8)}
function pushNote(){
    let hz1 = randChoice(scale), hz2=hz1;
    let velocity = randChoice([0.05, 0.3, 0.5, 0.7]) * lerp(1, 0.3, hz1/1500);
    let ampMod = null;
    
    if(coin(1/3)){
        let oct = random()*0.2/12;
        hz1 = octave(hz1,-oct);
        hz2 = octave(hz1,+oct);
    }
    else if(coin(1/2)){
        if(coin(2/3)){
            let hz =randChoice([4,8,16,32]);
            let frame = 0;
            ampMod = function sinMod(){return uni( sin(frame++*hz*twoPIoFs) );}

        }
        else{
            let hz =randChoice([8,16,32]);
            ampMod = NoiseLFO.create(hz,nLfoInterpolate,random);
        }
    }
    else velocity /= 2;

    hz1 *= twoPIoFs;
    hz2 *= twoPIoFs;
    let obj = {
        hz1,
        hz2,
        ampMod,
        velocity,
        t:0,
        a:randChoice([0.01, 0.3, 1]),
        h:randChoice([1, 5, 15]),
        d:randChoice([0.01, 0.3, 1]),
        isOver:false,
        trkNum:randInt(numPans-1),
        pan:rand(-1,1),
    }
    obj.endCallback = _=>{
        obj.isOver = true;
        filterNotesEnabled = true;
    }
    notes.push(obj);
}

let filterNotesEnabled = false;
function filterNotes(){
    notes = notes.filter(v=>{if(!v.isOver)return v;});
}

let nextOnTime = 0, nextStutterTime = 2;
let stutterSet = new Set();
function kRateProcess(frame,bufferLen,processor){
    // processor.info(notes.length)
    let velSum = 0;
    for(let o of notes)velSum+=o.velocity;
    // processor.info(velSum);
    let t = frame/Fs;
    if(t>=nextOnTime){
        if(velSum<SQRT2)pushNote();
        nextOnTime += rand(5);
    }

    if(t>=nextStutterTime){
        if(coin(0.3)){
            for(let s of stutterSet)s.off();
            stutterSet = new Set();
        }
        else{
            let stutterTime = randChoice([0.2,0.4,0.8]);
            for(let i=0,l=randInt(2,4);i<l;i++){
                let n = randInt(numPans-1);
                stutterSet.add(stutters[n]);
            }
            for(let s of stutterSet)s.toggle(stutterTime);
        }
        nextStutterTime += rand(1,5);
    }
}


function aRateProcess(L,R,bufferInd,frame,processor){

    for(let i=0,l=notes.length;i<l;i++){
        let n = notes[i];
        n.t += Ts;
        // n.ampEnvelope = min(1, n.ampEnvelope+ n.ampInc);
        let s1 = sin(frame*n.hz1);
        let s2 = sin(frame*n.hz2);
        let s = lerp(s1,s2,0.5) * envelopeAHD(n.t,n.a,n.h,n.d,n.endCallback);
        if(n.ampMod) s *= n.ampMod();
        monoTracks[n.trkNum].input(s * n.velocity);
    }
    if(filterNotesEnabled)filterNotes();
    filterNotesEnabled = false;

    for(let i=0; i<numPans; i++){
        mixer.tracks[0].input1to2ch( stutters[i].exec( monoTracks[i].output() ), panDivide(i,numPans) );
    }

    mixer.output(L,R,bufferInd);
}

