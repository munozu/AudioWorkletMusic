const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;

class SetTarget {
    constructor(iniValue = 0, tc = 0.01, iniTargetValue = iniValue) {
        this.v0 = this.gain = iniValue;
        this.v1 = iniTargetValue;
        this.t = 0;
        this.setTC(tc);
    }
    setTC(v) { this.TC = v * Fs; }
    setValue(targetValue) {
        this.v0 = this.gain;
        this.v1 = targetValue;
        this.t = 0;
    }
    exec() {
        this.gain = this.v1 + (this.v0 - this.v1) * exp(-(this.t++ / this.TC));
        return this.gain;
    }
}
export {SetTarget}