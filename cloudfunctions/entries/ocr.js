const tencent = require('./tencent');
function configured() { return !!(process.env.OCR_SECRET_ID && process.env.OCR_SECRET_KEY); }
function imageData(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 900000 || value.length % 4
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('识别图片过大或无效，请压缩或裁剪后重试');
  const bytes = Buffer.from(value, 'base64');
  const png = bytes.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (bytes.toString('base64') !== value || !png && !jpg) throw new Error('请选择 JPG 或 PNG 照片或截图');
}
async function recognize(data, mode) {
  if (!configured()) throw new Error('照片文字识别尚未开通，请先使用文字输入');
  imageData(data);
  if (!['basic', 'accurate'].includes(mode)) throw new Error('照片文字识别模式无效');
  const result = await tencent.request('ocr', mode === 'accurate' ? 'GeneralAccurateOCR' : 'GeneralBasicOCR', '2018-11-19',
    { ImageBase64: data }, process.env.OCR_SECRET_ID, process.env.OCR_SECRET_KEY, '照片文字识别');
  if (!Array.isArray(result.TextDetections) || result.TextDetections.some((row) => typeof row.DetectedText !== 'string')) throw new Error('识别结果格式异常，请重试');
  const text = result.TextDetections.map((row) => row.DetectedText).join('\n').trim();
  if (!text) throw new Error('未识别到文字，请拍清楚一些或改用文字输入');
  if (text.length > 20000) throw new Error('识别内容过长，请裁剪到本次要记录的部分');
  return { text, lines: result.TextDetections.length };
}
module.exports = { configured, imageData, recognize };
