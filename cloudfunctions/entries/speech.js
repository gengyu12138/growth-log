const https = require('https');
const crypto = require('crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

function configured() { return !!(process.env.ASR_SECRET_ID && process.env.ASR_SECRET_KEY); }

function audioData(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 900000
    || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('语音文件无效或过大，请缩短后重录');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || !(bytes.slice(0, 3).toString() === 'ID3'
    || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) throw new Error('仅支持本应用录制的 MP3 语音');
  return bytes;
}

async function transcribe(data) {
  if (!configured()) throw new Error('语音转文字尚未开通，请管理员配置语音服务；文字记录仍可使用');
  const bytes = audioData(data);
  const body = JSON.stringify({ EngSerViceType: '16k_zh', SourceType: 1, VoiceFormat: 'mp3',
    Data: data, DataLen: bytes.length, FilterDirty: 0, FilterModal: 0, FilterPunc: 0, ConvertNumMode: 1 });
  const timestamp = Math.floor(Date.now() / 1000), date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = 'asr.tencentcloudapi.com', contentType = 'application/json; charset=utf-8';
  // 腾讯云 TC3 签名，凭据只在云函数环境中使用，不下发客户端。
  const scope = date + '/asr/tc3_request';
  const canonical = ['POST', '/', '', 'content-type:' + contentType + '\nhost:' + host + '\n', 'content-type;host', hash(body)].join('\n');
  const signingKey = hmac(hmac(hmac('TC3' + process.env.ASR_SECRET_KEY, date), 'asr'), 'tc3_request');
  const signature = crypto.createHmac('sha256', signingKey).update('TC3-HMAC-SHA256\n' + timestamp + '\n' + scope + '\n' + hash(canonical)).digest('hex');
  return new Promise((resolve, reject) => {
    const request = https.request({ hostname: host, method: 'POST', path: '/',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body),
        'X-TC-Action': 'SentenceRecognition', 'X-TC-Version': '2019-06-14', 'X-TC-Timestamp': timestamp,
        Authorization: 'TC3-HMAC-SHA256 Credential=' + process.env.ASR_SECRET_ID + '/' + scope + ', SignedHeaders=content-type;host, Signature=' + signature } },
    (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; if (raw.length > 512000) request.destroy(new Error('语音服务返回过大')); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('语音服务暂时不可用，请稍后重试');
          const result = JSON.parse(raw).Response;
          if (!result || result.Error) throw new Error('语音识别失败，请检查语音服务状态或重新录音');
          if (typeof result.Result !== 'string' || !result.Result.trim()) throw new Error('没有识别到清楚的语音，请重新录音');
          resolve({ text: result.Result.trim() });
        } catch (err) { reject(err); }
      });
    });
    const deadline = setTimeout(() => request.destroy(new Error('语音转文字超时，未保存记录，请重试或改用文字')), 20000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
    request.end(body);
  });
}
module.exports = { configured, audioData, transcribe };
