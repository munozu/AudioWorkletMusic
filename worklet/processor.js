
import * as wavModule from "/worklet/wav.js";
import {SetTarget} from "/worklet/mixer.js";
const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs, twoPIoFs = 2*Math.PI/Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const clamp = (n, mi, ma) => max(mi, min(ma, n));
function cLog(obj){console.log(JSON.stringify(obj))} 
function doNothing(arg){return arg}

class ParameterHandler{
    constructor(){
        this.descriptors = {};
    }
    setup(parameters) {
        for (let p of parameters) {
            if (p.ramp) {
                parameterDescriptors.push(p);
                continue;
            }
            this.descriptors[p.name] = p;
            this[p.name] = p.defaultValue;
        }
    }
    change(id, value, fromEvent=false) {
        let p = this.descriptors[id];
        if(!p)return;
        let clampedValue = clamp(parseFloat(value), p.minValue, p.maxValue);
        this[id] = clampedValue;
        if(p.callback) p.callback(clampedValue);
        if (value == clampedValue) this.processor.info(id + " " + value);
        else this.processor.info(id + " clamped " + clampedValue);
        if(!fromEvent)this.indicate(id,value)
    }
    indicate(id, value){
        this.processor.port.postMessage({id,value});
    }
}

class MasterAmp{
    constructor(iniTarget){
        this.setTarget = new SetTarget(0, 0.1, iniTarget);
        this.gain = 0;
        this.preTarget = iniTarget;
        this.preMax = 0;
        this.prePeakL = this.prePeakR = 0;
        this.peakCount = 0;
        this.analyserInterval = round(0.5*Fs);
        this.sqSumL = this.sqSumR = 0;
    }
    change(v){
        this.setTarget.setValue(v);
        this.preTarget = v;
    }
    analyse(l,r,i,fi,processor){
        this.sqSumL += l[i] * l[i];
        this.sqSumR += r[i] * r[i];
        this.prePeakL = max( this.prePeakL, abs(l[i]) );
        this.prePeakR = max( this.prePeakR, abs(r[i]) );
        if(this.peakCount++<this.analyserInterval)return;
        let pl = this.prePeakL;
        let pr = this.prePeakR;
        this.preMax = max(pl, pr, this.preMax);
        let rmsLVal = sqrt(this.sqSumL/this.analyserInterval);
        let rmsRVal = sqrt(this.sqSumR/this.analyserInterval);
        processor.port.postMessage({id:"vu",value:{l:pl,r:pr,max:this.preMax,time:fi/Fs,rmsLVal,rmsRVal}});
        this.sqSumL = this.sqSumR = 0;
        this.prePeakL = this.prePeakR = this.peakCount = 0;
    }
    exec(l,r,i,fi,processor,constParams){
        this.analyse(l,r,i,fi, processor);
        let preMax = max( abs(l[i]), abs(r[i]) ), ma = preMax*this.gain;

        if (ma> 1){
            let target = this.gain/ma;
            if(this.preTarget<target)return;
            this.preTarget = target;
            this.setTarget.setValue(target);

            constParams.change("masterAmp",target);
            processor.port.postMessage(`masterAmp ${target}`);
            processor.port.postMessage({ id: "masterAmp", value: target });
        }

        this.gain = this.setTarget.exec();
        l[i] *= this.gain;
        r[i] *= this.gain;
    }
}

export function changeMasterAmp(v){
    masterAmp.change(v);
}

/////////////////////////////////////////////////////////////////////////

AudioWorkletProcessor.prototype.process = doNothing;
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
Processor.prototype.process = process;

class WavCreator extends AudioWorkletProcessor {
    constructor() {
        super();
        this.port.onmessage = this.handleMessage.bind(this);
    }
    handleMessage(e){
        try {
            if(e.data=="record"){
                recording = !recording;
                if(!recording)this.port.postMessage(wavModule.get());
            }
            else this.exportWav(e.data);
        } catch (error) {
            this.port.postMessage("Wav Creator Error");
            throw error;
        }
    }
    exportWav(sec){
        exporting = true;
        this.port.postMessage( wavModule.exportWav(sec, process) );
        exporting = false;
    }
}

class Setup extends AudioWorkletProcessor {
    constructor() {
        super();
        let params = JSON.parse(JSON.stringify(parameters));
        this.port.onmessage = function(e){
            waveTables = e.data.waveTables;
            this.port.postMessage(params);
            postSetup(waveTables);
        }.bind(this);
    }
}

/////////////////////////////////////////////////////////////////////////

const parameterDescriptors = [];
const constParams = new  ParameterHandler();
let waveTables, masterAmp, recording=false, exporting=false;
let parameters, postSetup, aRateProcess, kRateProcess;
let frame = Fs*0;

export function register(_parameters,_postSetup,_aRateProcess,_kRateProcess){
    parameters = _parameters;
    postSetup = _postSetup;
    aRateProcess = _aRateProcess;
    kRateProcess = _kRateProcess;
    constParams.setup(parameters);
    masterAmp = new MasterAmp(constParams.masterAmp);
    registerProcessor('processor', Processor);
    registerProcessor('setup', Setup);
    registerProcessor('wavCreator', WavCreator);
    return constParams;
}

/////////////////////////////////////////////////////////////////////////

function process (inputs, outputs, parameters) {
    const L = outputs[0][0];
    const R = outputs[0][1];
    const bufferLen = L.length;
    kRateProcess(frame,bufferLen);
    
    for(let i=0; i<bufferLen; i++){
        const fi = frame + i; 
        aRateProcess(L,R,i,fi,this);
    }
    if(recording){ for(let i=0; i<bufferLen; i++)wavModule.record(L[i],R[i]); }
    if(!exporting){ for(let i=0; i<bufferLen; i++)masterAmp.exec(L,R,i,frame+i,this,constParams) };
    frame += bufferLen;
    return true;
};

////  flow  /////////////////////////////////////////////////////////////////////
// score${n}.js processor.jsを import
// processor.js グローバル変数設定
// score${n}.js registerで parameters等を processor.jsへ渡す
// processor.js パラメーターの設定と マスターアンプ作成 registerProcessor実行
// score${n}.js グローバル変数設定
// main.js      AudioWorkletNode作成
// processor.js AudioWorkletProcessor起動
// score${n}.js postSetup実行
// processor.js process開始