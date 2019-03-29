const Fs = sampleRate, nyquistF = Fs / 2, Ts = 1 / Fs;
const abs=Math.abs, acos=Math.acos, acosh=Math.acosh, asin=Math.asin, asinh=Math.asinh, atan=Math.atan, atanh=Math.atanh, atan2=Math.atan2, ceil=Math.ceil, cbrt=Math.cbrt, expm1=Math.expm1, clz32=Math.clz32, cos=Math.cos, cosh=Math.cosh, exp=Math.exp, floor=Math.floor, fround=Math.fround, hypot=Math.hypot, imul=Math.imul, log=Math.log, log1p=Math.log1p, log2=Math.log2, log10=Math.log10, max=Math.max, min=Math.min, pow=Math.pow, random=Math.random, round=Math.round, sign=Math.sign, sin=Math.sin, sinh=Math.sinh, sqrt=Math.sqrt, tan=Math.tan, tanh=Math.tanh, trunc=Math.trunc, E=Math.E, LN10=Math.LN10, LN2=Math.LN2, LOG10E=Math.LOG10E, LOG2E=Math.LOG2E, PI=Math.PI, SQRT1_2=Math.SQRT1_2, SQRT2=Math.SQRT2;
const ratioToDB=ratio=> 20*log10(ratio)
,   fade  =(x, sec=0.01, sec2=sec)=>{
    for(let i=0, c=round(sec *Fs); i<c; i++)x[i]*=i/c;
    for(let i=0, c=round(sec2*Fs), la=x.length-1; i<c; i++)x[la-i]*=i/c;
    return x;
};
const setting = {
    sampleRate,
    bitsPerSample:16,
    numChannels:2
}

let wave = {l:[],r:[]}

function record(l,r){
    wave.l.push(l);
    wave.r.push(r);
}

function get(source = wave, t=0){
    fade(source.l,0,t);
    fade(source.r,0,t);
    let output = createWav(source.l, source.r);
    source = {l:[],r:[]};
    return output;
}

function exportWav(sec, processFunc){
    let fadeoutSec = sec/10;
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
    return get(output, fadeoutSec);
}

function createWav(trackL, trackR){
    function getMaxVol(...arg){
        let maxLR = [0,0], jLen = (!arg[1])?1:2;
        for(let j=0; j<jLen; j++){
            for( let i=0, len=arg[j].length; i<len; i++){
                if( abs(arg[j][i])>maxLR[j] )maxLR[j]=abs(arg[j][i]);
            }
        }
        let maxVol=max(...maxLR), maxText=[].concat(maxLR);
        maxText.forEach((e,i,a)=>{a[i]=(e*100).toFixed(1)+"%("+ratioToDB(e).toFixed(1)+"dB)";});
        console.log("master input: "+ maxText.join(", "));
        return maxVol;
    }

    function convertInto8Array(x,maxVol,y){
        switch(setting.bitsPerSample){
            case 8:
                y = new Uint8Array(x.length);
                for( let i=0, len=x.length; i<len; i++)y[i]= round( (x[i]/maxVol +1) /2 *0xff );
                return y;// 128が無音
            case 16:
                y = new Int16Array(x.length);//符号付き
                for( let i=0, len=x.length; i<len; i++)y[i]=( x[i]/maxVol *0x7fff );
                return new Uint8Array(y.buffer);// [0,-1,　1] -> [0, -32767, 32767] // 最大値から1少ない
            case 32:
                y = new Float32Array(x.length);
                for( let i=0, len=x.length; i<len; i++)y[i]=( x[i]/maxVol);
                return new Uint8Array(y.buffer);
            case 24:
                y = new Uint8Array(x.length*3);
                for( let i=0,t, len=x.length; i<len; i++){
                    t = trunc( x[i]/maxVol *0x7fffff );
                    y[i*3  ] = t%0x100; t = t>>>8;
                    y[i*3+1] = t%0x100; t = t>>>8;
                    y[i*3+2] = t;
                }
                return y;
        }
    }
    function fuseStereo(l,r){
        let y = new Uint8Array(l.length*2);
        let b = setting.bitsPerSample/8;
        for(let i=0, len=l.length; i<len; i+=b){
            for(let j=0, i2=i*2; j<b; j++){
                y[i2  +j] = l[i+j];
                y[i2+b+j] = r[i+j];
            }
        }
        return y;
    }

    //http://soundfile.sapp.org/doc/WaveFormat/
    function createWavFormatArray(wave){
        let header = createHeader(wave), hl = header.length;
        let byteArray = new Uint8Array(hl + wave.length);
        for( let i=0; i<hl; i++)byteArray[i] = header[i];
        for( let i=0, l=byteArray.length; i<l; i++)byteArray[hl+i] = wave[i];
        
        return byteArray;
    }
    function createHeader(wave){
        let fieldSizeList = [4,4,4,4,4,2,2,4,4,2,2,4,4],
            endianList    = [0,1,0,0,1,1,1,1,1,1,1,0,1],
            NumChannels   = setting.numChannels,
            SampleRate    = setting.sampleRate,
            BitsPerSample = setting.bitsPerSample,
            ByteRate      = SampleRate * NumChannels * BitsPerSample /8,
            BlockAlign    = NumChannels * BitsPerSample/8,
            SubChunk2Size = wave.length,
            ChunkSize     = 36 + SubChunk2Size,
            AudioFormat   = BitsPerSample==32?3:1,
            headerParts = [
                0x52494646,ChunkSize,0x57415645,0x666d7420,0x00000010,AudioFormat,
                NumChannels,SampleRate,ByteRate,BlockAlign,BitsPerSample,0x64617461,SubChunk2Size
            ];
        
        for(let i=0; i<headerParts.length; i++){
            let x=headerParts[i], y=[];
            for(let j=0;j<fieldSizeList[i];j++){ y.push(x%256); x>>>=8; }
            if(!endianList[i])y = y.reverse();
            headerParts[i] = y;
        }
        return [].concat(...headerParts);//headerParts.flat(2);//edge
    }

    let wave8Array, maxVol = getMaxVol(trackL,trackR);
    if( trackR ){
        let l = convertInto8Array(trackL,maxVol);
        let r = convertInto8Array(trackR,maxVol);
        wave8Array = fuseStereo(l,r);
    }
    else wave8Array = convertInto8Array(trackL,maxVol);
    
    return createWavFormatArray(wave8Array);
}

export {record, exportWav, get}