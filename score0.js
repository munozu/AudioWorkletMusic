import * as wavModule from "/wav.js";
import { Mixer, ParameterHandler, MasterAmp, ADSR, Filter, FilterBq, ReverbSchroeder, WaveTableOsc, PulseOsc} from "/class.js";

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
,   panL =function(x){return cos(quarterPI*(1+x));}
,   panR =function(x){return sin(quarterPI*(1+x));}
const panScatter=(n=0,total=4,width=0.8) => -width + n*width*2/(total-1);
/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

const parameterDescriptors = [];
const constParams = new  ParameterHandler();
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

Processor.prototype.process = processFunc;
function processFunc (inputs, outputs, parameters) {
    const L = outputs[0][0];
    const R = outputs[0][1];
    const bufferLen = L.length;
    
    for(let i=0; i<bufferLen; i++){
        const fi = frame + i; 
        process(L,R,i,fi);
    }
    if(recording){ for(let i=0; i<bufferLen; i++)wavModule.record(L[i],R[i]); }
    if(!exporting){ for(let i=0; i<bufferLen; i++)masterAmp.exec(L,R,i,frame+i,this,constParams) };
    frame += bufferLen;
    return true;
};

class WavCreator extends Processor {
    constructor() {
        super();
        this.port.onmessage = function(e){
            if(e.data=="record"){
                recording = !recording;
                if(!recording)this.port.postMessage(wavModule.get());
            }
            else this.export(e.data);
        }.bind(this);

    }
    export(sec){
        exporting = true;
        let fadeoutSec = sec<10?0:sec<60?5:15;
        let output = {l:[],r:[]};
        let n = Date.now();
        for(let i=0,l=Fs*parseInt(sec);i<l;i+=128){
            let buffer = [[new Array(128).fill(0),new Array(128).fill(0)]];
            processFunc(null,buffer);
            for(let j=0;j<128;j++){
                output.l.push( buffer[0][0][j] );
                output.r.push( buffer[0][1][j] );
            }
        }
        console.log(`export: ${sec}s, fadeout: ${fadeoutSec}s, ${(Date.now()-n)/1000}s elapsed`);
        this.port.postMessage( wavModule.get(output, fadeoutSec) );
        exporting = false;
    }
}

let masterAmp, recording=false, exporting=false;
function setup(){
    constParams.setup(parameters);
    masterAmp = new MasterAmp(constParams.masterAmp);
    registerProcessor('processor', Processor);
    registerProcessor('setup', class extends Processor {
        constructor() {
            super();
            let params = JSON.parse(JSON.stringify(parameters));
            this.port.onmessage = function(e){
                waveTables = e.data.waveTables;
                this.port.postMessage(params);
                postSetup();
            }.bind(this);
        }
    });
    registerProcessor('wavCreator', WavCreator);
}

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

let waveTables, frame = Fs*0;
const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: v => masterAmp.change(v) },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]

setup();


let osc1List = [], osc2List = [];
function postSetup(){
    for(let i=8;i--;){
        osc1List.push( PulseOsc.create(waveTables.saw32) );
        osc2List.push( PulseOsc.create(waveTables.tri32) );
    }
}


let mixer = new Mixer(64,1);
let reverbL = ReverbSchroeder.create(15);
let reverbR = ReverbSchroeder.create(15);
mixer.setAux(0,function rvbFunc(inL,inR,L,R,i){;
    L[i] += reverbL(inL);
    R[i] += reverbR(inR);
});

let oscMixMod = []
let adsrList = [];
let filterAdsr = [];
let filterList = [];
let filterTop = new Array(8).fill(1000);
let lp = []
let pwmHz = [];
let pwmHzFM = [];
let pwmPhase = new Array(8).fill(0);
let hzList = new Array(8).fill(400);

for(let i=0;i<8;i++){
    adsrList.push(new ADSR(0.2, 0.2, 0.2, 2))
    filterAdsr.push(new ADSR(0.2, 0.2, 0.3, 2))
    
    filterList[i] = FilterBq.create(400,0.7);
    lp[i] = Filter.create(1);
    pwmHz[i] = rand(1,3);
    pwmHzFM[i] = rand(0.1,0.2);
    oscMixMod[i] = rand(0.01,0.05);
    mixer.setTrack(i,panScatter(i,8,1),0.6, 0.1);
}

function randOn(){
    let n = randInt(7);
    let ad = rand(0.4,2) * exp(-hzList[n]/3200);
    adsrList[n].setA(ad);
    adsrList[n].setD(ad);
    filterAdsr[n].setA(ad);
    filterAdsr[n].setD(ad);
    hzList[n] = 25/2*randChoice([8,9,10,12,14]) * 2**randInt(4);
    let vol = rand(0.1,1) *  exp(-hzList[n]/1200);
    adsrList[n].noteOn(vol);
    filterAdsr[n].noteOn();
    filterTop[n] = sqrt(hzList[n]/3200)*3200;
}
randOn();
let twoPIoFs = twoPI/Fs;
function process(L,R,bufferI,fi){
    if(coin(0.6/Fs))randOn();
    if(coin(0.5/Fs))adsrList[randInt(7)].noteOff();

    for(let i=0; i<8; i++){
        pwmPhase[i] += (pwmHz[i]+siT(fi*pwmHzFM[i]/Fs)*1 ) /Fs;
        let s1 = osc1List[i](hzList[i], 0.25 +siT(pwmPhase[i])*0.1)
        let s2 = osc2List[i](hzList[i]/2,0.25);
        let s = lerp(s1,s2,uni(siT(fi*oscMixMod[i]/Fs)));
        s  = filterList[i](s, 20+lp[i](filterTop[i])*filterAdsr[i].exec() );
        s *= adsrList[i].exec();
        mixer.track(i,s,L,R,bufferI);
    }
    mixer.outputAux(L,R,bufferI);
}