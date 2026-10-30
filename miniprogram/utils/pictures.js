const config = require('./config');
const same = (a, b) => a && b && a._id === b._id && a.family_code === b.family_code;
function validResult(value) {
  return value && ['scene', 'document', 'mixed', 'unclear'].includes(value.category)
    && typeof value.caption === 'string' && value.caption.length <= 160 && typeof value.text === 'string' && value.text.length <= 2000
    && typeof value.warning === 'string' && value.warning.length <= 200 && typeof value.incomplete === 'boolean';
}
async function readImage(path, member) {
  let local = path, downloaded = '';
  try {
    if (path.startsWith('cloud://')) {
      const match = /^cloud:\/\/([^/]+)\/entries\/([^/]+)\/[a-zA-Z0-9_.-]+$/.exec(path);
      if (!match || match[1].split('.')[0] !== config.envId || match[2] !== member.family_code) throw new Error('照片不属于当前家庭或环境');
      const r = await wx.cloud.downloadFile({ fileID: path }); local = downloaded = r.tempFilePath;
      if (!local) throw new Error('未能读取照片，原图仍保留');
    }
    const read = (filePath) => new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath, encoding: 'base64', success: resolve, fail: reject }));
    let data = (await read(local)).data;
    const supported = (value) => /^(\/9j\/|iVBORw0KGgo|R0lGOD|UklGR)/.test(value);
    if (data.length > 900000 || !supported(data)) {
      const r = await wx.compressImage({ src: local, quality: 60, compressedWidth: 1600 });
      data = (await read(r.tempFilePath)).data;
    }
    if (data.length > 900000) throw new Error('图片过大，请裁剪或缩小后识别；原图仍可保存');
    if (!supported(data)) throw new Error('图片暂不支持识别，可转为 JPG、PNG 或截图后重试；原图仍保留');
    return data;
  } finally { if (downloaded) wx.getFileSystemManager().unlink({ filePath: downloaded, fail: () => {} }); }
}
function createPictureReader(page, changed) {
  let rows = [], running = null, disposed = false, epoch = 0;
  const currentPaths = () => page.data.images || [];
  const publish = (persist = true) => {
    if (disposed) return;
    const paths = currentPaths(); rows = rows.filter((row) => paths.includes(row.path));
    page.setData({ imageInsights: rows.map((row) => Object.assign({}, row, { number: paths.indexOf(row.path) + 1 })) });
    if (persist) changed();
  };
  const setError = (message) => { rows.filter((row) => ['queued', 'working'].includes(row.status)).forEach((row) => { row.status = 'error'; row.error = message; }); publish(); };
  const textFor = (path) => {
    const row = rows.find((item) => item.path === path);
    if (!row || row.status !== 'done' || !validResult(row.result)) throw new Error('请先取得图片识别结果');
    const r = row.result;
    const text = [r.caption.trim() ? '照片描述：' + r.caption.trim() : '', r.text.trim() ? (r.incomplete ? '图片部分文字：' : '图片文字：') + r.text.trim() : ''].filter(Boolean).join('\n');
    if (!text) throw new Error('请先填写要采用的描述或图片文字');
    return text;
  };
  const run = () => {
    if (running || disposed || !rows.some((row) => row.status === 'queued')) return running;
    const version = epoch;
    const task = (async () => {
      page.setData({ pictureAnalyzing: true });
      try {
        const app = getApp(), member = await app.ensureMember();
        if (disposed || epoch !== version) return;
        if (!same(member, page.member) || !['owner', 'editor'].includes(member.role)) throw new Error('当前家庭身份不能识别照片，请重新进入');
        const caps = await app.getEntryCapabilities();
        if (disposed || epoch !== version) return;
        if (caps.pictureUnderstanding !== 1) throw new Error('图片理解尚未启用，原图已保留；更新服务后可重试');
        let row;
        while (!disposed && epoch === version && (row = rows.find((item) => item.status === 'queued'))) {
          if (!same(app.globalData.member, member) || !same(page.member, member)) throw new Error('家庭身份已变化，图片识别已停止');
          row.status = 'working'; row.error = ''; publish();
          try {
            const image = await readImage(row.path, member);
            if (disposed || epoch !== version) return;
            if (!rows.includes(row)) continue;
            if (!same(app.globalData.member, member)) throw new Error('家庭身份已变化，未提交图片');
            const r = await app.entryRequest({ action: 'analyzePicture', image, memberId: member._id, familyCode: member.family_code });
            if (disposed || epoch !== version) return;
            if (!same(app.globalData.member, member) || !same(page.member, member)) throw new Error('家庭身份已变化，未带入识别结果');
            if (!rows.includes(row)) continue;
            if (!validResult(r.analysis)) throw new Error('图片结果格式异常，请重新识别');
            row.result = r.analysis; row.status = 'done'; row.error = '';
          } catch (err) {
            if (disposed || epoch !== version) return;
            if (rows.includes(row)) { row.status = 'error'; row.error = err.message || '图片识别未完成，原图已保留，可重试'; }
          }
          publish();
        }
      } catch (err) { if (!disposed && epoch === version) setError(err.message || '暂时无法识别，原图已保留，可联网后重试'); }
      finally { if (!disposed && epoch === version) page.setData({ pictureAnalyzing: false }); }
    })();
    running = task;
    task.finally(() => { if (running === task) running = null; if (!disposed && rows.some((row) => row.status === 'queued')) run(); });
    return task;
  };
  return {
    restore(value) {
      epoch += 1; page.setData({ pictureAnalyzing: false }); rows = [];
      if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > 9 || value.some((row) => !row || typeof row.path !== 'string'
        || !['queued', 'working', 'done', 'error'].includes(row.status) || row.status === 'done' && !validResult(row.result)))) {
        page.setData({ pictureStatus: '图片识别草稿格式异常，原图和已采用正文仍保留，可重新识别' }); publish(false); return;
      }
      rows = (value || []).map((row) => ({ path: row.path, status: row.status === 'working' ? 'queued' : row.status,
        result: validResult(row.result) ? row.result : null, error: typeof row.error === 'string' ? row.error : '',
        applied: typeof row.applied === 'string' && row.applied.length <= 2200 ? row.applied : '' })); publish(false);
    },
    add(paths) {
      if (disposed) return;
      for (const path of paths) if (currentPaths().includes(path) && !rows.some((row) => row.path === path)) rows.push({ path, status: 'queued', result: null, error: '' });
      publish(); return run();
    },
    resume: run,
    reconcile() { publish(); },
    retry(path) { const row = rows.find((item) => item.path === path); if (!row || row.status === 'working') return; row.status = 'queued'; row.error = ''; publish(); return run(); },
    edit(path, field, value) {
      const row = rows.find((item) => item.path === path);
      if (!row || !row.result || !['caption', 'text'].includes(field) || typeof value !== 'string' || value.length > (field === 'caption' ? 160 : 2000)) return;
      row.result = Object.assign({}, row.result, { [field]: value }); publish();
    },
    compose(path, before) {
      const row = rows.find((item) => item.path === path);
      const block = textFor(path);
      if (before.includes(block)) return { text: before, block, changed: false };
      if (row.applied && before.includes(row.applied)) return { text: before.replace(row.applied, block), block, changed: true };
      if (row.applied && /照片描述：|图片(?:部分)?文字：/.test(before)) throw new Error('之前采用的段落已在正文中修改，请直接调整正文，避免重复带入或覆盖手写内容');
      return { text: [before, block].filter(Boolean).join('\n'), block, changed: true };
    },
    markApplied(path, block) { const row = rows.find((item) => item.path === path); if (row) { row.applied = block; publish(); } },
    snapshot() { return rows.filter((row) => currentPaths().includes(row.path)).map((row) => ({ path: row.path, status: row.status, result: row.result, error: row.error, applied: row.applied || '' })); },
    reset() { epoch += 1; rows = []; if (!disposed) { page.setData({ imageInsights: [], pictureAnalyzing: false, pictureStatus: '' }); } },
    dispose() { disposed = true; epoch += 1; },
  };
}
module.exports = { createPictureReader, readImage, validResult };
