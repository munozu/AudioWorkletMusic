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
function kRateProcess(bufferI,bufferLen){}

let frame = Fs*0;
const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: v => masterAmp.change(v) },
    { name: 'reverbSeed', defaultValue: 1, minValue: 1, maxValue: 100, step:1, callback: initReverb  },
    { name: 'reverbTime', defaultValue: 7, minValue: 0.1, maxValue:20, callback: initReverb },
    { name: 'reverbIn', defaultValue: 0.5, minValue: 0.001, maxValue: 1,  callback: v => stReverbIn.setValue(v)  },
    { name: 'reverbOut', defaultValue: 0.5, minValue: 0.001, maxValue: 1,  callback: v => stReverbOut.setValue(v) },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]

setup();

// mixer //////////////////////////////////////////////
let numTracks = 6;
let mixer = new Mixer(numTracks,1);
let reverb1, reverb2;
function initReverb(){
    let xorS = new XorShift(constParams.reverbSeed)
    reverb1 = ReverbSchroeder.create(constParams.reverbTime,xorS);
    reverb2 = ReverbSchroeder.create(constParams.reverbTime,xorS);
}
initReverb();
let stReverbIn = new SetTarget(0.5,0.1);
let stReverbOut = new SetTarget(0.5,0.1);
mixer.aux[0].setup(0,dBtoRatio(-28)*4,function rvbFunc(inL,inR,output){;
    let reverbIn = stReverbIn.exec();
    let reverbOut = stReverbOut.exec();
    output[0] = reverb2(inL*reverbIn) * reverbOut;
    output[1] = reverb1(inR*reverbIn) * reverbOut;
});
for(let i=0;i<numTracks;i++){
    mixer.tracks[i].setup(panDivide(i,numTracks,0.9), 1.1);
}

// setup //////////////////////////////////////////////
let oscMixMod = []
let adsrList = [];
let filterAdsr = [];
let filterList = [];
let filterBottom = new Array(numTracks).fill(500);
let filterDelta = new Array(numTracks).fill(500);
let lp = []
let pwmHz = [];
let pwmHzFM = [];
let pwmPhase = new Array(numTracks).fill(0);
let hzList = new Array(numTracks).fill(400);

for(let i=0;i<numTracks;i++){
    adsrList.push(new ADSR(0.2, 0.2, 0.2, 2))
    filterAdsr.push(new ADSR(0.2, 0.2, 0.3, 2))
    
    filterList[i] = FilterBq.create(400,1.5);
    lp[i] = Filter.create(1,"lp");
    pwmHz[i] = rand(1,2);
    pwmHzFM[i] = rand(0.1,0.2) *twoPIoFs;
    oscMixMod[i] = rand(0.01,0.05)*twoPIoFs;
}

let osc1List = [], osc2List = [];
function postSetup(){
    for(let i=numTracks;i--;){
        osc1List.push( PulseOsc.create(waveTables.saw32) );
        osc2List.push( PulseOsc.create(waveTables.tri32) );
    }
}

let scale = [];
for(let i=0,a=[8,9,10,12,14];i<5;i++){
    for(let n of a)scale.push(12.5*n *2**i);
}

function randOn(){
    let n = randInt(numTracks-1);
    let a = rand(0.4,2) * exp(-hzList[n]/3200);
    adsrList[n].setA(a);
    filterAdsr[n].setA(a);
    let d = rand(0.4,2) * exp(-hzList[n]/3200);
    adsrList[n].setD(d);
    filterAdsr[n].setD(d);
    let r = cosINeg( random() , 0.5);
    hzList[n] = scale[floor(r * scale.length)];
    let vol = random() *  exp(-hzList[n]/1000);
    adsrList[n].noteOn(vol);
    filterAdsr[n].noteOn();
    // let filTop = (1-exp(-hzList[n]/400))*2400;
    let filTop = fractionCurve(hzList[n]/2800,-5) * 2400;
    filterBottom[n] = filTop/2;
    filterDelta[n] = filTop- filterBottom[n];
}
randOn();

// process //////////////////////////////////////////////
function process(L,R,bufferI,fi){
    if(coin(0.6/Fs))randOn();
    if(coin(0.5/Fs))adsrList[randInt(numTracks-1)].noteOff();

    for(let i=0; i<numTracks; i++){
        pwmPhase[i] += (pwmHz[i]+sin(fi*pwmHzFM[i]) ) *twoPIoFs;
        let pwm = sin(pwmPhase[i]);
        let s1 = osc1List[i](hzList[i],  0.25+pwm*0.08);
        let s2 = osc2List[i](hzList[i]/2,0.25);
        let s = lerp(s1,s2,uni( sin(fi*oscMixMod[i]) ));
        let filterLv = filterBottom[i] +lp[i]( filterDelta[i] );
        filterLv *=  filterAdsr[i].exec();
        s  = filterList[i](s, filterLv );
        s *= adsrList[i].exec();
        mixer.tracks[i].input1ch(s);
    }
    mixer.output(L,R,bufferI);
}
