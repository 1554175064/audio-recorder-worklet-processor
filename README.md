# audio-recorder-worklet-processor

worklet 录音，支持获取 pcm、音量、wav、音频频谱数据

为了应对不同业务场景，很多情况不需要对音频数据做缓存，如实时转写等，所以这里不对音频数据做存储，仅提供原子能力

如果业务有需求可以自己存储音频数据，再调用这里提供的方法转成 PCM 等格式（也可以自己写转换方法，这里仅提供 PCM 和 WAV 两种）

浏览器支持
charome 66+
Firefox 76+
Edge 79+
Opera 53+
Safari 14.1+

#### DOC

调用

```js
import Recorder from "audio-recorder-worklet-processor";

const recorder = new Recorder();
```

或

```javascript
<script type="text/javascript" src="../dist/index.js"></script>;

const recorder = new Recorder();
```

初始化

```typescript
interface IProcessOptions {
  processSize?: number; //收集采样的大小，采集完多少后触发onDataProcess一次，默认4096
  numChannels?: 1 | 2; //声道数 1或2，默认单声道
  sampleBits?: 16 | 8; //采样位数 一般8,16，默认16
  sampleRate?: number; //采样率 一般 11025、16000、22050、24000、44100、48000，默认为16000
}
interface IAnalyserOptions {
  open: boolean; //是否开启analyserNode，默认否
  fftSize: number; //具体含义可以看mdn的定义，简单来说数值越大精度越高，取值范围32-32768，默认512
}
interface IConfig {
  //录音的实时回调，可以获取音频原始数据和音量区间0-1(觉得不敏感可以自己乘以倍率)
  onDataProcess?: (data: { vol: number; buffer: Float32Array }) => void;
  //process配置
  processOptions: IProcessOptions;
  //analyserNode配置，用来提供实时频率分析和时域分析的切点数据（可以用作数据分析和可视化）,默认不开启
  analyserOptions?: IAnalyserOptions;
}

// init(config?: IConfig): Promise<void>
recorder.init(config);
```

开始录音

```typescript
//start(): Promise<void>;
recorder.start();
```

停止收音

```typescript
//返回录音时长，在调用stop时，会将缓存区不足processSize大小的数据再调用一次onDataProcess返回，所以不用担心丢失录音数据
//stop(): Promise<number | void>;
recorder.stop();
```

获取音频频谱数据

```typescript
//getAnalyserData(): Uint8Array
recorder.getAnalyserData();
```

process 原始数据转 PCM

如果使用这里的录音获取的数据 sampleBits 和 littleEdian 可以不传，如果用这个方法处理其他录音的数据则需要指定一下，否则可能返回数据有问题

```typescript
  //**
   *
   * @param {Float32Array} bytes  process原数据
   * @param {number} sampleBits  采样位数，默认为init时的参数，未传入则为init默认值
   * @param {boolean} littleEdian  是否是小端字节序，未传入时根据系统自动判断
   * @returns {DataView}  PCM数据
   */
recorder.encodePCM(bytes, sampleBits, littleEdian)
```

PCM 转 WAV

```typescript
   //**
    *
    * @param {DataView}  buffer PCM数据
    * @param {Float32Array} sampleRate  采样率，默认为init时的参数，未传入则为init默认值
    * @param {Float32Array} numChannels  声道数，默认为init时的参数，未传入则为init默认值
    * @param {Float32Array} sampleBits  采样位数，默认为init时的参数，未传入则为init默认值
    * @param {boolean} littleEdian  是否是小端字节序，未传入时根据系统自动判断
    * @returns  {DataView}  WAV数据
    */
recorder.encodeWAV(buffer, sampleRate, numChannels, sampleBits, littleEdian)
```

#### Example

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Document</title>
    <script src="../dist/index.js"></script>
  </head>
  <body>
    <button onclick="init()">init</button>
    <button onclick="start()">start</button>
    <button onclick="analyser()">analyser</button>
    <button onclick="stop()">stop</button>
  </body>
  <script>
    const recorder = new Recorder();
    const bufferArr = [];
    const init = () => {
      recorder.init({
        analyserOptions: {
          open: true,
        },
        onDataProcess: (data) => {
          bufferArr.push(...data.buffer);
        },
      });
    };
    const start = async () => {
      await recorder.start();
    };
    const analyser = () => {
      const data = recorder.getAnalyserData();
      console.log("analyserData:", data);
    };
    const stop = async () => {
      const duration = await recorder.stop();
      console.log("duration:", duration);
      //结束后可以将缓存数据转PCM
      const pcmData = recorder.encodePCM(bufferArr);
      //有需要可以转WAV
      const wavData = recorder.encodeWAV(pcmData);
      //下载等功能自行实现
      const wavBlob = new Blob([wavData], { type: "audio/wav" });
      let oA = document.createElement("a");
      oA.href = window.URL.createObjectURL(wavBlob);
      oA.download = "recorder.wav";
      oA.click();
    };
  </script>
</html>
```
