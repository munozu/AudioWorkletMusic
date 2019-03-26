Object.getOwnPropertyNames(Math).forEach(p => self[p] = Math[p]);
Number.prototype.step = function (step = 0.5) { let c = 1 / step; return parseInt(this * c) / c; }
Number.prototype.roundStep = function (step = 0.5) { let c = 1 / step; return round(this * c) / c; }
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const gE = id => { return document.getElementById(id) };
const gV = id => { return parseFloat(gE(id).value) };
let info, paramContainers;
let context, processor, wavCreator;
let connecting, exportState = 0, autoStart, countInit = 0;
let scoreNum = 3;
let waveTables = {};

window.addEventListener("load", async function setup() {
    info = gE("info");
    paramContainers = gE("param-container");

    let search = new URLSearchParams(window.location.search);
    autoStart = search.get("auto") != "false";
    if (search.get("score") !== null) {
        scoreNum = search.get("score");
    }
    for (let o of gE("select-score").children) {
        if (o.textContent == scoreNum) o.selected = true;
    }
    analyser.setup();
    await fetchWaveTable("saw32.dat");
    await fetchWaveTable("tri32.dat");
    try { await init(); } catch (error) { info.textContent = error; return; }
    setupEvents();
});

function fetchWaveTable(url) {
    fetch(url)
        .then(res => res.arrayBuffer())
        .then(buffer => new Float32Array(buffer))
        .then(array => {
            let sampleRate = array[0], harms = 1;
            let output = waveTables[(url.split(".")[0])] = [];
            for (let i = 1, l = array.length; i < l; i += sampleRate) {
                output[harms] = Array.from(array.slice(i, i + sampleRate));
                harms *= 2;
            }
            output.sampleRate = sampleRate;
            output.maxHarms = harms / 2;
        });
}

function setupEvents() {
    gE("init").addEventListener("click", init);
    gE("connect").addEventListener("click", connect);
    gE("export").addEventListener("click", _ => wavCreator.export());
    gE("record").addEventListener("click", _ => wavCreator.record());
    gE("select-score").addEventListener("change", e => {
        for (let o of e.target.children) {
            if (!o.selected) continue;
            scoreNum = parseInt(o.textContent);
            init();
        }
    });
}

async function init() {
    if (exportState == 2) return;
    connecting = false;
    if (context) context.close();
    analyser.stop();

    let lh = (++countInit === 1) ? 1 : gV("latency");

    // context = new AudioContext({ latencyHint: lh });
    context = new AudioContext({ latencyHint: lh, sampleRate: 24000 });

    await context.audioWorklet.addModule(`score${scoreNum}.js`);

    await setupProcessor();
    await setupParameters();
    await setupWavCreator();
    if (exportState == 1) return;

    gE("latency").value = context.baseLatency;

    if (countInit === 1) {
        info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}. `
        if (!autoStart) return;
        info.textContent += `press any keys`;
        if (document.location.href.indexOf("127.0.0.1") != -1) connect();
        else {
            window.addEventListener("keydown", autoConnect);
            window.addEventListener("mousemove", autoConnect);
            function autoConnect() {
                window.removeEventListener("keydown", autoConnect);
                window.removeEventListener("mousemove", autoConnect);
                connect();
            }
        }
    }
    else {
        connect();
        info.textContent = `sampleRate:${context.sampleRate}, baseLatency:${context.baseLatency}.`;
    }
}

async function setupProcessor(){
    processor = await new AudioWorkletNode(context, 'processor', { outputChannelCount: [2] });
    processor.onprocessorerror = e => { console.log(e); info.textContent = "error"; }
    processor.port.onmessage = e => {
        if (typeof e.data == "string") info.textContent = e.data;
        else if (e.data.id == "vu") analyser.setVu(e.data.value);
        else gE(e.data.id).value = e.data.value;
    }
}

async function setupParameters() {
    gE("param-container").innerHTML = "";
    let setupMessenger = await new AudioWorkletNode(context, "setup");
    setupMessenger.port.onmessage = e => createParameters(e.data);
    setupMessenger.port.postMessage({ waveTables });
}

async function setupWavCreator() {
    wavCreator = await new AudioWorkletNode(context, "wavCreator");
    let recording = false;
    wavCreator.record = _ => {
        recording = !recording;
        info.textContent = recording ? "recording..." : "creating wav";
        wavCreator.port.postMessage("record");
    }
    wavCreator.export = _ => {
        exportState = 1;
        info.textContent = "wait...";
        init().then(_ => {
            exportState = 2;
            wavCreator.port.postMessage(gV("export-sec"));
        });
    }
    wavCreator.port.onmessage = e => {
        if (typeof e.data == "string") {
            info.textContent = e.data;
            return;
        }
        let blob = new Blob([e.data], { type: "audio/wav" });
        let urlObj = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = urlObj;
        a.textContent = "save wav, " + new Date().toLocaleString();
        a.download = document.title + scoreNum;// + "----" + new Date().toLocaleString();
        gE("wav-output").insertBefore(a, gE("wav-output").firstChild);
        info.textContent = "wav created";
        exportState = 0;
    }
}

function connect() {
    if (exportState == 2) return;
    connecting = !connecting;
    context[(connecting ? "resume" : "suspend")]();
    processor[(connecting ? "connect" : "disconnect")](context.destination);
    analyser[(connecting ? "init" : "stop")]();
    info.textContent = (connecting ? "connected" : "disconnected");
}

function postMessage(id, value) {
    processor.port.postMessage({ id, value });
}
