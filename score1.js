import * as wavModule from "/wav.js";
import {SetTarget, Mixer, ParameterHandler, MasterAmp} from "/class.js";

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
    if(!exporting){ for(let i=0; i<bufferLen; i++)masterAmp.exec(L,R,i,frame+i,this) };
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

function setup(){
    constParams.setup(parameters);
    masterAmp = new MasterAmp(constParams.masterAmp);
    
    registerProcessor('processor', Processor);
    registerProcessor('wavCreator', WavCreator);
    registerProcessor('setup', class extends Processor {
        constructor() {
            super();
            let params = JSON.parse(JSON.stringify(parameters));
            this.port.onmessage = function(){this.port.postMessage(params)}.bind(this);
        }
    });
}

/////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////

let masterAmp, recording=false, exporting=false, frame = Fs*0;
const parameters = [
    { name: 'masterAmp', defaultValue: 0.7, minValue: 0, maxValue: 1, callback: v => masterAmp.change(v) },
    // { type: "separator", value: "parameters" },
    // { name: 'param1', defaultValue: 1, minValue: 1, maxValue: 10, type: "number", step:1 },
    // { name: 'param2', defaultValue: 0.01, minValue: 0.001, maxValue: 2, exp: 2 },
    // { name: 'param3', defaultValue: 0.01, minValue: 0.001, maxValue: 2, ramp: true, unit:"unit" },
]
setup();

let mixer = new Mixer();
function process(L,R,i,fi){
    let s = sin(fi*twoPI*400/Fs);
    mixer.track(0,s,L,R,i)
}