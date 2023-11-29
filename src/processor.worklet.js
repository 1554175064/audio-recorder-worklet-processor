class AudioMeter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [];
  }

  constructor() {
    super();
    this.chunks = [];
    this.port.onmessage = (e) => {
      const info = e.data;
      switch (info.type) {
        case "init":
          this.config = info.data;
          break;
        //收到停止，发送剩余所有chunks信息
        case "stop":
          const data = this.splitChunksByProcessSize();
          this.port.postMessage({ type: "process", data });
          break;
      }
    };
  }
  /**
   * 数据合并压缩,双声道合并
   *
   * @static
   * @param {Float32Array} lData       [-1, 1]的pcm数据
   * @param {Float32Array} rData       [-1, 1]的pcm数据
   * @returns  {Float32Array}         压缩处理后的二进制数据
   */
  compress(lData, rData) {
    let length = Math.floor(lData.length + rData.length),
      result = new Float32Array(length),
      index = 0,
      j = 0;

    // 循环间隔 compression 位取一位数据
    while (index < length) {
      let temp = Math.floor(j);
      result[index] = lData[temp];
      index++;
      if (rData.length) {
        /*
         * 双声道处理
         * 此处需要组和成LRLRLR这种格式，才能正常播放，所以要处理下
         */
        result[index] = rData[temp];
        index++;
      }

      j += 1;
    }
    // 返回压缩后的一维数据
    return result;
  }

  /**
   * 计算所有样本平方的平均值的平方根，用作音频音量
   * @param {Float32Array} buffer
   * @returns {number}
   */
  getRMS(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    return rms;
  }

  /**
   * 根据processSize做chunk数据拆分
   */
  splitChunksByProcessSize() {
    const sendBuffer = this.chunks.splice(0, this.config.processSize);
    const vol = this.getRMS(sendBuffer);
    return {
      buffer: sendBuffer,
      vol: vol,
    };
  }

  calculateVolume(inputs) {
    //单声道
    let lbuffer = inputs[0][0],
      rbuffer = [];
    //双声道
    if (this.config.numChannels === 2) {
      rbuffer = inputs[0][1];
    }
    //声道合并
    const buffer = this.compress(lbuffer, rbuffer);
    this.chunks.push(...buffer);

    if (this.chunks.length >= this.config.processSize) {
      const data = this.splitChunksByProcessSize();
      this.port.postMessage({
        type: "process",
        data,
      });
    }
  }

  process(inputs, outputs, parameters) {
    this.calculateVolume(inputs);
    return true;
  }
}

registerProcessor("main", AudioMeter); // 注册一个名为 vumeter 的处理函数 注意：与主线程中的名字对应。
