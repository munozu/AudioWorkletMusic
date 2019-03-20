
Object.getOwnPropertyNames(Math).forEach(p => self[p] = Math[p]);
const clamp = (n, mi, ma) => max(mi, min(ma, n));
const gE = id => { return document.getElementById(id) };
const gV = id => { return parseFloat(gE(id).value) };
let info, paramContainers;
let context, processor, wavCreator;
let connecting, exportState = 0, autoStart, countInit = 0;
let scoreNumList = [1], scoreNum = 0;

window.addEventListener("load", async function setup() {
    info = gE("info");
    paramContainers = gE("param-container");

    for (let n of scoreNumList) {
        let o = document.createElement("option");
        o.textContent = n;
        gE("select-score").appendChild(o);
    }
    autoStart = new URLSearchParams(window.location.search).get("auto") != "false";
    analyser.setup();
    try { await init(); } catch (error) { info.textContent = error; return; }
    setupEvents();
});

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

    processor = await new AudioWorkletNode(context, 'processor', { outputChannelCount: [2] });
    processor.onprocessorerror = e => { console.log(e); info.textContent = "error"; }
    processor.port.onmessage = e => {
        if (typeof e.data == "string") info.textContent = e.data;
        else if (e.data.id == "vu") analyser.setVu(e.data.value);
        else gE(e.data.id).value = e.data.value;
    }


    await setupWavCreator();
    if (exportState == 1) return;

    setupParams();
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

const analyser = {
    vuTxt: [],
    buffer: null,
    modeNum: 1,
    unknownLen: 100,
    setup() {
        this.element = gE("analyser");
        this.div = gE("analyser-text");
        this.width = this.element.width;
        this.height = this.element.height;
        this.element.addEventListener("click", this.handleClick.bind(this));
        this.modes = [
            null,
            { size: 2 ** 11, func: this.spectrum },
            { size: 2 ** 11, func: this.oscilloscope },
            { size: 2 ** 11, func: this.spectrum3d }
        ];
    },
    init() {
        if (this.modeNum == 0) return;
        this.isRunning = true;
        this.canvasCtx = this.element.getContext("2d");
        this.node = context.createAnalyser();

        let m = this.modes[this.modeNum];
        this.draw = m.func;
        this.node.fftSize = m.size;
        this.bufferSize = this.node.frequencyBinCount;
        this.buffer = new Uint8Array(this.bufferSize);

        this.spectrum3dList = [];
        this.ind3d = 0;
        this.setupGuide(this.bufferSize, this.width, this.height);
        processor.connect(this.node);
        this.loop();
    },
    handleClick(e) {
        if (!connecting) return;
        this.stop();
        if (++this.modeNum >= this.modes.length) this.modeNum = 0;
        else this.init();
    },
    setupGuide(bufferSize, w, h) {
        this.posList = [];
        this.posList3dX = [];
        this.posList3dY = [];
        this.posList = [];
        this.guideList = [];
        this.guideListOctave = [];
        this.guideListDigit = [];
        let nyquistF = context.sampleRate / 2
        let leftEnd = log2(1 / bufferSize * nyquistF);
        let rightEnd = log2(nyquistF) - leftEnd;

        this.posList[0] = 0;
        for (let i = 1; i < bufferSize; i++) {
            let hz = i / bufferSize * nyquistF;
            this.posList[i] = (log2(hz) - leftEnd) / rightEnd * w;
        }

        this.posList3dX = this.posList.map(v => (v / w - 0.5) * w * 0.43 + w / 2);

        for (let i = 0, l = this.unknownLen; i < l; i++) {
            let y = h - ((l - i) / l) * h;
            y = h / 2 + (y / h - 0.5) * h * 0.53;
            this.posList3dY.push(y);
        }

        function pushLines(list, digit = 10, len = 10) {
            for (let i = 1; i < len; i++) {
                let hz = digit * i;
                if (hz != clamp(hz, 1 / bufferSize * nyquistF, nyquistF)) continue;
                let x = (log2(hz) - leftEnd) / rightEnd * w;
                list.push(round(x));
            }
        }
        pushLines(this.guideList, 10);
        pushLines(this.guideList, 100);
        pushLines(this.guideList, 1000);
        pushLines(this.guideList, 10000);

        [100, 1000, 10000].forEach(n => {
            let x = (log2(n) - leftEnd) / rightEnd * w;
            this.guideListDigit.push(round(x));
        });

        for (let hz = 25; hz < nyquistF; hz *= 2) {
            let x = (log2(hz) - leftEnd) / rightEnd * w;
            this.guideListOctave.push(round(x));
        }
    },
    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;
        this.canvasCtx.fillStyle = "white";
        this.canvasCtx.fillText("analyser stopped", 0, 12);
        cancelAnimationFrame(this.animId);
        this.draw = null;
    },
    setVu(data) {
        if (this.modeNum == 0) return;
        let lr = ((-data.rmsLVal + data.rmsRVal) / (data.rmsLVal + data.rmsRVal)).toFixed(3);
        if (lr >= 0) lr = "+" + lr;
        this.div.textContent = [
            "      Time: " + floor(data.time),
            "     PeakL: " + data.l.toFixed(3),
            "     PeakR: " + data.r.toFixed(3),
            "   PeakMax: " + data.max.toFixed(3),
            // "RMS L: " + data.rmsLVal.toFixed(3),
            // "RMS R: " + data.rmsRVal.toFixed(3),
            "LR balance:" + lr,
        ].join("\n");
    },
    loop() {
        this.draw(this.canvasCtx, this.bufferSize, this.width, this.height);
        this.animId = requestAnimationFrame(this.loop.bind(this));
    },
    oscilloscope(cc, bufferSize, w, h) {
        cc.fillStyle = "mediumAquamarine";
        cc.fillRect(0, 0, w, h);
        cc.fillStyle = "#888";
        cc.fillRect(0, 0.25 * h, w, 1);
        cc.fillRect(0, 0.75 * h, w, 1);
        this.node.getByteTimeDomainData(this.buffer);

        cc.lineWidth = 1;
        cc.fillStyle = "white";
        cc.strokeStyle = "#444"
        cc.beginPath();
        cc.moveTo(w, h / 2);
        cc.lineTo(0, h / 2);
        let i = 1, l = bufferSize / 2;
        for (; i < bufferSize; i++) {
            let v = this.buffer[i];
            if (v < this.buffer[i - 1] && v == 128) break;
        }
        if (i > bufferSize - l) i = 0;
        for (let t = i, len = t + l; i < len; i++) {
            let v = this.buffer[i] / 256 - 0.5;
            let x = (i - t) / l * w;
            let y = h / 2 + v * h;
            cc.lineTo(x, y);
        }
        cc.lineTo(w, h / 2);
        cc.stroke();
        cc.fill();
    },
    spectrum3d(cc, bufferSize, w, h) {
        cc.fillStyle = "black";
        cc.fillRect(0, 0, w, h);

        cc.strokeStyle = "#fff";
        cc.fillStyle = "#000";
        this.node.getByteFrequencyData(this.buffer);

        this.spectrum3dList[this.ind3d] = new Uint8Array(this.buffer);
        let list = this.spectrum3dList;
        let l = this.unknownLen, c = h / 256 * 0.05;
        for (let j = 0; j < l; j += 4) {
            let ind = this.ind3d + 1 - l + j;
            if (ind < 0) ind += l;
            if (!list[ind]) continue;
            cc.beginPath();
            let by = this.posList3dY[j];
            cc.moveTo(this.posList3dX[0] - 10, by - list[ind][0] * c);
            for (let i = 1; i < bufferSize; i = floor((i + 1) * 1.1)) {
                let y = by - list[ind][i] * c;
                cc.lineTo(this.posList3dX[i], y);
            }
            cc.fill();
            cc.stroke();
        }

        if (++this.ind3d >= l) this.ind3d -= l;
    },
    spectrum(cc, bufferSize, w, h) {
        cc.fillStyle = "MediumAquaMarine";
        cc.fillRect(0, 0, w, h);
        cc.lineWidth = 1;
        cc.fillStyle = "#888";
        for (let i = 0, l = this.guideList.length; i < l; i++) {
            cc.fillRect(this.guideList[i], 0, 1, h);
        }

        cc.fillStyle = "#fffc";
        this.node.getByteFrequencyData(this.buffer);
        cc.beginPath();
        cc.moveTo(-1, h);
        for (let i = 0, c = h / 256; i < bufferSize; i++) {
            let y = h - this.buffer[i] * c;
            cc.lineTo(this.posList[i], y);
        }
        cc.lineTo(w + 1, h);
        cc.fill();

        cc.fillStyle = "#444";
        for (let i = 0, l = this.guideListDigit.length; i < l; i++) {
            cc.fillRect(this.guideListDigit[i], 0, 2, 2);
        }
        for (let i = 0, l = this.guideListOctave.length; i < l; i++) {
            cc.fillRect(this.guideListOctave[i], h - 2, 2, 2);
        }
    }
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
        let blob = new Blob([e.data], { type: "audio/wav" });
        let urlObj = URL.createObjectURL(blob);
        let a = document.createElement("a");
        a.href = urlObj;
        a.textContent = "save wav, " + new Date().toLocaleString();
        a.download = document.title + "----" + new Date().toLocaleString();
        gE("wav-output").insertBefore(a, gE("wav-output").firstChild);
        info.textContent = "wav created";
        exportState = 0;
    }
}

function setupParams() {
    gE("param-container").innerHTML = "";
    let setupMessenger = new AudioWorkletNode(context, "setup");
    setupMessenger.port.onmessage = e => createParameters(e.data);
    setupMessenger.port.postMessage(1);
}

function createParameters(params) {
    for (let p of params) {
        if (p.type == "none") continue;
        if (p.type == null) p.type = "slider";
        if (p.type == "separator") {
            let el = document.createElement("h3");
            el.textContent = p.value;
            paramContainers.appendChild(el);
        }
        else if (p.type == "slider") createSlider(p);
        else createInput(p);
    }
}

function createSlider(p) {
    let divEl = document.createElement("div");
    divEl.id = p.name;
    divEl.classList.add("slider");

    let exp = p.exp || 1;
    let mi = p.minValue, ma = p.maxValue, range = ma - mi;

    let value = p.defaultValue;
    divEl.step = (p.step ? p.step : 0.01);

    let txt = p.name + (p.unit ? `(${p.unit})` : "");
    let textNode = document.createTextNode(" - " + txt);
    paramContainers.appendChild(divEl);
    paramContainers.appendChild(textNode);
    paramContainers.appendChild(document.createElement("BR"));

    setValue(value);
    function setValue(value) {
        let v = (value / range) ** (1 / exp) * 100;
        divEl.style.backgroundImage = `linear-gradient(to right, orange , orange , ${v}%, white, ${v}%, white)`;
        divEl.textContent = value.toFixed(3);
    }
    Object.defineProperty(divEl, 'value', { set: setValue });

    let mouseX = false, m = 1;
    divEl.addEventListener("mousedown", e => {
        let rect = e.target.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
        sendValue(getValue());
    });
    function moveHandler(e) {
        mouseX += e.movementX;
        sendValue(getValue());
    }
    function upHandler() {
        document.removeEventListener("mousemove", moveHandler);
        document.removeEventListener("mouseup", upHandler);
    }
    function getValue(v) {
        v = clamp((mouseX - m) / (divEl.clientWidth), 0, 1);
        divEl.style.backgroundImage = `linear-gradient(to right, orange , orange , ${v * 100}%, white, ${v * 100}%, white)`;
        v = mi + pow(v, exp) * range;
        divEl.textContent = v.toFixed(3);
        return v;
    }
    function sendValue(v) {
        if (!p.ramp) postMessage(p.name, v)
        else processor.parameters.get(p.name).linearRampToValueAtTime(v, context.currentTime + (p.time || 0.1));
    }
}

function createInput(p) {
    let inputEl = document.createElement("input");
    inputEl.id = p.name;
    let exp = p.exp || 1;
    inputEl.min = p.minValue ** (1 / exp);
    inputEl.max = p.maxValue ** (1 / exp);
    inputEl.value = p.defaultValue ** (1 / exp);
    inputEl.step = (p.step ? p.step : 0.01);
    inputEl.type = p.type; // rangeは valueのあとに設定
    let txt = p.name + (p.unit ? `(${p.unit})` : "");
    let textNode = document.createTextNode(" - " + txt);
    paramContainers.appendChild(inputEl);
    paramContainers.appendChild(textNode);
    paramContainers.appendChild(document.createElement("BR"));

    if (p.ramp) inputEl.addEventListener("change", _ => {
        let value = inputEl.value;
        info.textContent = p.name + " " + value;
        processor.parameters.get(p.name).linearRampToValueAtTime(value, context.currentTime + (p.time || 0.1));
    });
    else inputEl.addEventListener("change", _ => postMessage(p.name, pow(inputEl.value, exp)));
}