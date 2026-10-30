const tencent = require('./tencent');
const crypto = require('crypto');
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

// 只签发当前成员、家庭的短期查询凭证；客户端不能替换成别人的任务 ID。
function taskSignature(task, member) {
  return crypto.createHmac('sha256', process.env.ASR_SECRET_KEY)
    .update(JSON.stringify(['growth-speech-v1', member._id, member.family_code, task.id, task.expiresAt]))
    .digest('hex');
}

async function startTask(data, member) {
  const bytes = audioData(data);
  const result = await tencent.request('asr', 'CreateRecTask', '2019-06-14', {
    EngineModelType: '16k_zh', ChannelNum: 1, ResTextFormat: 0, SourceType: 1,
    Data: data, DataLen: bytes.length, SpeakerDiarization: 0, EmotionRecognition: 0,
    FilterDirty: 0, FilterModal: 0, FilterPunc: 0, ConvertNumMode: 1,
  }, process.env.ASR_SECRET_ID, process.env.ASR_SECRET_KEY, '语音转写提交');
  if (!result.Data || !Number.isSafeInteger(result.Data.TaskId) || result.Data.TaskId <= 0) throw new Error('转写任务返回异常，请稍后重试');
  const task = { id: result.Data.TaskId, expiresAt: Date.now() + 15 * 60 * 1000 };
  task.signature = taskSignature(task, member);
  return { task };
}

async function taskStatus(task, member) {
  if (!task || !Number.isSafeInteger(task.id) || task.id <= 0
    || !Number.isSafeInteger(task.expiresAt)
    || typeof task.signature !== 'string' || !/^[a-f0-9]{64}$/.test(task.signature)
    || !crypto.timingSafeEqual(Buffer.from(task.signature, 'hex'), Buffer.from(taskSignature(task, member), 'hex'))) {
    throw new Error('这段语音的查询凭证已失效，请重新录音');
  }
  if (task.expiresAt <= Date.now()) return { state: 'expired' };
  const result = await tencent.request('asr', 'DescribeTaskStatus', '2019-06-14', { TaskId: task.id },
    process.env.ASR_SECRET_ID, process.env.ASR_SECRET_KEY, '语音转写查询');
  const data = result.Data;
  if (!data || data.TaskId !== task.id || ![0, 1, 2, 3].includes(data.Status)) throw new Error('转写状态异常，请稍后继续获取');
  if (data.Status === 0 || data.Status === 1) return { state: 'pending' };
  if (data.Status === 3) return { state: 'failed' };
  // 基础结果带接口生成的时间段前缀，去除后才交给文字分析，防止误当成事件时刻。
  if (typeof data.Result !== 'string') throw new Error('转写文字返回异常，请稍后继续获取');
  const text = data.Result.replace(/^\s*\[\d+:\d+(?:\.\d+)?,\d+:\d+(?:\.\d+)?\][ \t]*/gm, '').trim();
  if (!text) return { state: 'empty' };
  return { state: 'done', text };
}
module.exports = { configured, audioData, transcribe, startTask, taskStatus };
