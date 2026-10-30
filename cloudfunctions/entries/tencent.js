const https = require('https');
const crypto = require('crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();
function request(service, action, version, data, secretId, secretKey, label) {
  if (!['asr', 'ocr'].includes(service)) throw new Error('识别服务类型无效');
  const body = JSON.stringify(data), timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10), host = service + '.tencentcloudapi.com';
  const contentType = 'application/json; charset=utf-8', scope = date + '/' + service + '/tc3_request';
  const canonical = ['POST', '/', '', 'content-type:' + contentType + '\nhost:' + host + '\n', 'content-type;host', hash(body)].join('\n');
  const signingKey = hmac(hmac(hmac('TC3' + secretKey, date), service), 'tc3_request');
  const signature = crypto.createHmac('sha256', signingKey).update('TC3-HMAC-SHA256\n' + timestamp + '\n' + scope + '\n' + hash(canonical)).digest('hex');
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, method: 'POST', path: '/', headers: {
      'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), 'X-TC-Action': action, 'X-TC-Version': version, 'X-TC-Timestamp': timestamp,
      Authorization: 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + scope + ', SignedHeaders=content-type;host, Signature=' + signature,
    } }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; if (raw.length > 2 * 1024 * 1024) req.destroy(new Error(label + '返回过大，请缩小内容')); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error(label + '暂时不可用，请稍后重试');
          const result = JSON.parse(raw).Response;
          if (!result || result.Error) throw new Error(label + '失败，请检查服务开通状态、额度或重新输入');
          resolve(result);
        } catch (err) { reject(err); }
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error(label + '超时，未保存记录，可重试或改用文字')), 20000);
    req.on('close', () => clearTimeout(deadline)); req.on('error', reject); req.end(body);
  });
}
async function consume(db, collection, month, limit, label) {
  try { await db.createCollection(collection); }
  catch (err) { if (!String(err.errCode).includes('502002') && !/exist|已存在/i.test(err.message || err.errMsg || '')) throw err; }
  // 应用共享保守限额；失败也计次，避免未知结果重试突破额度。
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(collection).doc(month), { data: usage } = await ref.get();
    if (usage && (!Number.isSafeInteger(usage.count) || usage.count < 0)) throw new Error(label + '额度状态异常，请联系管理员');
    const count = usage ? usage.count : 0;
    if (count >= limit) throw new Error('本月小程序' + label + '额度已用完，请使用文字记录');
    if (usage) await ref.update({ data: { count: count + 1 } });
    else await ref.set({ data: { count: 1 } });
  });
}
module.exports = { request, consume };
