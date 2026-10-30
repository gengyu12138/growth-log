const tencent = require('./tencent');
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
  const result = await tencent.request('asr', 'SentenceRecognition', '2019-06-14', {
    EngSerViceType: '16k_zh', SourceType: 1, VoiceFormat: 'mp3', Data: data, DataLen: bytes.length,
    FilterDirty: 0, FilterModal: 0, FilterPunc: 0, ConvertNumMode: 1,
  }, process.env.ASR_SECRET_ID, process.env.ASR_SECRET_KEY, '语音转文字');
  if (typeof result.Result !== 'string' || !result.Result.trim()) throw new Error('没有识别到清楚的语音，请重新录音');
  return { text: result.Result.trim() };
}
module.exports = { configured, audioData, transcribe };
