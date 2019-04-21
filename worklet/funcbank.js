Number.prototype.step  = function(step=0.5){ let c=1/step; return parseInt(this*c)/c; } 
function step(v, step=0.5){ let c=1/step; return parseInt(v*c)/c; } 

function shuffle(array, m=Math) {
    for(let i=0, l=array.length-1, a=l+1, r; i<l; i++){
        r = floor(m.random() *a);
        [array[i],array[r]] = [array[r],array[i]];
    }
    return array;
}
const tri    =function(t){return abs((((t+1/4)*4)+2)%4 -2)-1}
,   saw    =function(t){return (t*2+1)%2 -1}
,   square =function(t){return ((t*2+1)%2 -1) - (((t+0.5)*2+1)%2 -1)}
,   pulse  =function(t, duty=0.5){return saw(t) - saw(t+duty)}
,   pulse1 =function(t, duty=0.5){return (t-floor(t))<duty?-1:1}

function fade(x, sec=0.01, sec2=sec){
    for(let i=0, c=round(sec *Fs); i<c; i++)x[i]*=i/c;
    for(let i=0, c=round(sec2*Fs), la=x.length-1; i<c; i++)x[la-i]*=i/c;
    return x;
};

function envelopeAD(t,a=0.01,d=1){ return (t<a)?(1/a)*t : max(0, 1-(t-a)*(1/d) ); }
function envelopeToTpT(t,peak=1,curve=1){ return pow(t/peak, (peak-t)/curve); }
function envelopeQuadratic(t,sec=2){ return max(0, 1-4/sec/sec*pow(t-sec/2, 2) ); }

function waveShaperCubic(s,k=0.5){
    let area = (1+k)/2 - k/4;
    let amp = 0.5/area;
    return ((1+k)*s - k*s*s*s) *amp;
}