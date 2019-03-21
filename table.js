const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const twoPI = PI*2, halfPI = PI/2, quarterPI = PI/4, isArray = Array.isArray;

let sampleRate = 2**11
function normalize(n, x){
    let y=[], m = max(-min(...x),max(...x));
    for(let i=0, l=x.length;i<l;i++) y[i]=x[i]/m;
    return y;
}
function createSaw(){
    const sawTable = (_=>{
        let sr=sampleRate, minHz=20, maxHarms = min(15000/minHz);
        let a=twoPI/sr, wave= new Array(sr).fill(0), output = [];
        function add(h){ for(let i=0;i<sr;i++)wave[i] -= sin((PI+a*i)*h)/h; }
        for(let i=1,l=maxHarms;i<=l;i++){ 
            add(i);
            output[i] = normalize(i,wave);
         }
        return output;
    })();
    
    let array = [sampleRate];
    for(let i=1, l=sawTable.length;i<l;i*=2){
        array = array.concat(sawTable[i]);
    }
    append(array,"saw table");
}

function createTriangle(){
    const triTable = (_=>{
        let sr=sampleRate, minHz=20, maxHarms = min(15000/minHz);
        let a=twoPI/sr, wave= new Array(sr).fill(0), output = [];
        function add(h){ 
            let si = (h%4)==1?1:-1;
            for(let i=0;i<sr;i++)wave[i] +=si*sin((PI+a*i)*h)/h/h; 
        }
        for(let i=1,l=maxHarms;i<=l;i+=2){ 
            add(i);
            output[i] = normalize(i,wave);
         }
         
        return output;
    })();
    
    let array = [sampleRate].concat(triTable[1]);
    for(let i=2, l=triTable.length;i<l;i*=2){
        // console.log(i-1, i);
        array = array.concat(triTable[i-1]);
    }
    append(array,"triangle table");
}

function append(array,text){
    let fl = new Float32Array( array );
    let blob = new Blob([fl]);
    let urlObj = URL.createObjectURL(blob);
    let a = document.createElement("a");
    a.href = urlObj;
    a.textContent = text;
    document.body.appendChild(a);
}

window.addEventListener("load",_=>{
    createTriangle();
})