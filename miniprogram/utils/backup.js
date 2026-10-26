const { createZip, utf8 } = require('./zip');

function fileCall(fs, method, options) {
  return new Promise((resolve, reject) => fs[method](Object.assign({}, options, { success: resolve, fail: reject })));
}

async function backupPhotos(wxApi, filePath, payload, familyCode, envId, cancelled, progress) {
  const fs = wxApi.getFileSystemManager();
  const images = [...new Set(payload.entries.reduce((list, entry) => list.concat(entry.images || []), []))];
  const files = [];
  let temporaryPath = '';
  const check = () => { if (cancelled()) throw new Error('已取消备份'); };
  try {
    check();
    // 下载前核对引用范围；旧数据中的外部或其他家庭文件不能借备份功能被读取。
    for (const id of images) {
      const match = typeof id === 'string' && /^cloud:\/\/([^/]+)\/entries\/([^/]+)\/([a-zA-Z0-9_.-]+)$/.exec(id);
      if (!match || match[1].split('.')[0] !== envId || match[2] !== familyCode) throw new Error('部分照片引用不属于当前家庭，备份已停止');
    }
    await fileCall(fs, 'writeFile', { filePath, data: new ArrayBuffer(0) });
    const zip = createZip(async (data) => { check(); await fileCall(fs, 'appendFile', { filePath, data }); });
    for (let i = 0; i < images.length; i += 1) {
      check(); progress(`正在备份照片 ${i + 1} / ${images.length}…`);
      let download;
      try { download = await wxApi.cloud.downloadFile({ fileID: images[i] }); }
      catch (err) { throw new Error(`第 ${i + 1} 张照片下载失败，未生成完整备份，请重试`); }
      temporaryPath = download.tempFilePath;
      if (!temporaryPath) throw new Error('照片下载结果异常');
      check();
      const info = await fileCall(fs, 'getFileInfo', { filePath: temporaryPath });
      if (!Number.isFinite(info.size) || info.size <= 0 || info.size > 20 * 1024 * 1024) throw new Error('照片为空或单张超过 20 MB，备份已停止');
      const read = await fileCall(fs, 'readFile', { filePath: temporaryPath });
      if (!read.data || read.data.byteLength !== info.size) throw new Error('照片读取不完整，备份已停止');
      const extension = /\.(jpg|jpeg|png|webp|gif|heic)$/i.exec(images[i]);
      const name = 'photos/' + String(i + 1).padStart(5, '0') + (extension ? '.' + extension[1].toLowerCase() : '.bin');
      await zip.add(name, read.data);
      files.push({ fileID: images[i], path: name, bytes: info.size });
      await fileCall(fs, 'unlink', { filePath: temporaryPath }); temporaryPath = '';
    }
    const manifest = Object.assign({}, payload, { format: 'growth-log-photo-backup-v1', files,
      imageNotice: 'photos 目录保留云端照片文件，不再次压缩。历史上传前已压缩的照片无法还原为相机原图。' });
    await zip.add('records.json', utf8(JSON.stringify(manifest, null, 2)));
    const bytes = await zip.finish(); check();
    return { count: files.length, bytes };
  } catch (err) {
    await fileCall(fs, 'unlink', { filePath }).catch(() => {});
    throw err;
  } finally {
    if (temporaryPath) await fileCall(fs, 'unlink', { filePath: temporaryPath }).catch(() => {});
  }
}

module.exports = { backupPhotos };
