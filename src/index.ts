// @ts-ignore
import processor from "./processor.worklet.js";

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
  processOptions?: IProcessOptions;
  //analyserNode配置，用来提供实时频率分析和时域分析的切点数据（可以用作数据分析和可视化）,默认不开启
  analyserOptions?: IAnalyserOptions;
}

interface IStop {
  url: string;
  duration: number;
}

/**
 * 在data中的offset位置开始写入str字符串
 * @param {TypedArrays} data    二进制数据
 * @param {Number}      offset  偏移量
 * @param {String}      str     字符串
 */
function writeString(data: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    data.setUint8(offset + i, str.charCodeAt(i));
  }
}

class Recorder {
  private config: IConfig | null | undefined = {
    processOptions: {
      processSize: 4096,
      numChannels: 1,
      sampleBits: 16,
      sampleRate: 16000,
    },
    analyserOptions: {
      open: false,
      fftSize: 512,
    },
  };
  private stream: null | MediaStream = null;
  private context: null | AudioContext = null;
  private workletNode: null | AudioWorkletNode = null;
  private microphone: null | MediaStreamAudioSourceNode = null;
  private analyserNode: null | AnalyserNode = null;
  private littleEdian: boolean = false; // 判断端字节序
  private status: "not ready" | "ready" | "recording" = "not ready";
  constructor() {
    this.littleEdian = (function () {
      let buffer = new ArrayBuffer(2);
      new DataView(buffer).setInt16(0, 256, true);
      return new Int16Array(buffer)[0] === 256;
    })();
  }
  //关闭所有在使用的麦克
  private closeTracks() {
    this.stream?.getTracks()?.forEach((track) => {
      // if (track.readyState === 'live') {
      track.stop();
      // }
    });
  }
  //初始化
  async init(config?: IConfig) {
    if (this.status === "recording") {
      return console.warn("录音中，请不要初始化，这会导致音频处理错误");
    }
    const processOptions = Object.assign(
      this.config.processOptions,
      config?.processOptions
    );
    const analyserOptions = Object.assign(
      this.config.analyserOptions,
      config?.analyserOptions
    );
    Object.assign(this.config, config);
    this.config.processOptions = processOptions;
    this.config.analyserOptions = analyserOptions;
    this.status = "ready";
  }
  //停止录音
  async stop() {
    if (this.status !== "recording") {
      return console.warn("当前没有在录音");
    }

    this.workletNode.port.postMessage({
      type: "stop",
    });
    const duration = this.context?.currentTime;
    this.closeTracks();
    if (this.context?.state !== "closed") {
      await this.context?.close();
    }
    this.microphone = null;
    this.stream = null;
    this.workletNode = null;
    this.context = null;
    this.status = "ready";
    return duration;
  }
  //开始录音
  async start() {
    if (this.status === "not ready") {
      return console.warn("没有初始化,请先调用init");
    }
    if (this.status === "recording") {
      return console.warn("正在录音中，请不要重复调用");
    }
    this.status = "recording";
    //获取音频流
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    //创建音频上下文
    this.context = new AudioContext({
      sampleRate: this.config.processOptions?.sampleRate,
    });
    //加载音频处理worker
    await this.context.audioWorklet.addModule(processor);
    //获取音频源
    this.microphone = this.context.createMediaStreamSource(this.stream);
    //创建音频处理节点
    this.workletNode = new AudioWorkletNode(this.context, "main");
    //发送worklet初始config
    this.workletNode.port.postMessage({
      type: "init",
      data: {
        processSize: this.config.processOptions?.processSize,
        numChannels: this.config.processOptions?.numChannels,
        sampleRate: this.context.sampleRate,
      },
    });
    //与worklet交互
    this.workletNode.port.onmessage = (e) => {
      const info = e.data;
      switch (info.type) {
        case "process":
          this.config?.onDataProcess &&
            this.config?.onDataProcess({
              vol: info.data.vol,
              buffer: info.data.buffer,
            });
          break;
      }
    };

    //绑定处理节点和输入
    this.microphone.connect(this.workletNode).connect(this.context.destination);

    if (this.config.analyserOptions.open) {
      this.analyserNode = this.context.createAnalyser();
      this.analyserNode.fftSize = this.config.analyserOptions.fftSize;
      this.microphone.connect(this.analyserNode);
    }
  }
  //process源数据转pcm
  encodePCM(
    bytes: Float32Array,
    sampleBits: number = this.config.processOptions?.sampleBits,
    littleEdian: boolean = this.littleEdian
  ) {
    let offset = 0,
      dataLength = bytes.length * (sampleBits / 8),
      buffer = new ArrayBuffer(dataLength),
      data = new DataView(buffer);

    // 写入采样数据
    if (sampleBits === 8) {
      for (let i = 0; i < bytes.length; i++, offset++) {
        // 范围[-1, 1]
        let s = Math.max(-1, Math.min(1, bytes[i]));
        // 8位采样位划分成2^8=256份，它的范围是0-255;
        // 对于8位的话，负数*128，正数*127，然后整体向上平移128(+128)，即可得到[0,255]范围的数据。
        let val = s < 0 ? s * 128 : s * 127;
        val = +val + 128;
        data.setInt8(offset, val);
      }
    } else {
      for (let i = 0; i < bytes.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, bytes[i]));
        // 16位的划分的是2^16=65536份，范围是-32768到32767
        // 因为我们收集的数据范围在[-1,1]，那么你想转换成16位的话，只需要对负数*32768,对正数*32767,即可得到范围在[-32768,32767]的数据。
        data.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, littleEdian);
      }
    }

    return data;
  }
  //pcm转wav
  encodeWAV(
    buffer: DataView,
    sampleRate: number = this.config.processOptions.sampleRate,
    numChannels: number = this.config.processOptions.numChannels,
    sampleBits: number = this.config.processOptions.sampleBits,
    littleEdian: boolean = this.littleEdian
  ) {
    const bytesPerSample = sampleBits / 8;
    const blockAlign = numChannels * bytesPerSample;
    const arrayBuffer = new ArrayBuffer(
      44 + buffer.byteLength * bytesPerSample
    );
    const dataView = new DataView(arrayBuffer);
    let offset = 0;
    // 资源交换文件标识符
    writeString(dataView, 0, "RIFF");
    offset += 4;
    // 下个地址开始到文件尾总字节数,即文件大小-8
    dataView.setUint32(
      offset,
      36 + buffer.byteLength * bytesPerSample,
      littleEdian
    );
    offset += 4;
    // WAV文件标志
    writeString(dataView, offset, "WAVE");
    offset += 4;
    // 波形格式标志
    writeString(dataView, offset, "fmt ");
    offset += 4;
    // 过滤字节,一般为 0x10 = 16
    dataView.setUint32(offset, 16, littleEdian);
    offset += 4;
    // 格式类别 (PCM形式采样数据)
    dataView.setUint16(offset, 1, littleEdian);
    offset += 2;
    // 声道数
    dataView.setUint16(offset, numChannels, littleEdian);
    offset += 2;
    // 采样率,每秒样本数,表示每个通道的播放速度
    dataView.setUint32(offset, sampleRate, littleEdian);
    offset += 4;
    // 波形数据传输率 (每秒平均字节数) 声道数 × 采样频率 × 采样位数 / 8
    dataView.setUint32(offset, sampleRate * blockAlign, littleEdian);
    offset += 4;
    // 快数据调整数 采样一次占用字节数 声道数 × 采样位数 / 8
    dataView.setUint16(offset, blockAlign, littleEdian);
    offset += 2;
    // 采样位数
    dataView.setUint16(offset, sampleBits, littleEdian);
    offset += 2;
    // 数据标识符
    writeString(dataView, offset, "data");
    offset += 4;
    // 采样数据总数,即数据总大小-44
    dataView.setUint32(offset, buffer.byteLength, littleEdian);
    offset += 4;

    // 给wav头增加pcm体
    for (let i = 0; i < buffer.byteLength; ) {
      dataView.setUint8(offset, buffer.getUint8(i));
      offset++;
      i++;
    }

    return dataView;
  }
  //获取音频频谱数据
  getAnalyserData() {
    if (!this.config.analyserOptions.open) {
      return console.warn("未开启analyser功能");
    }
    if (this.status !== "recording") {
      return console.warn("当前未录音");
    }
    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyserNode.getByteFrequencyData(dataArray);
    return dataArray;
  }
}
export default Recorder;
