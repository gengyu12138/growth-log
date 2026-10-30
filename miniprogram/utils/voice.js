function createVoice(page, acceptText) {
  const recorder = wx.getRecorderManager();
  let ticker = null;
  const stopTicker = () => { if (ticker) clearInterval(ticker); ticker = null; };
  let disposed = false, cancelled = false, active = false, starting = false, path = '', version = 0, startVersion = 0;
  const update = (data) => { if (!disposed) page.setData(data); };
  const transcribe = async () => {
    if (!path || disposed || page.data.transcribing) return;
    const token = ++version;
    update({ transcribing: true, voiceStatus: '正在转文字，随后自动整理…' });
    try {
      const read = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path, encoding: 'base64', success: resolve, fail: reject }));
      const app = getApp(), member = await app.ensureMember();
      if (disposed || token !== version) return;
      if (!member || !page.member || member._id !== page.member._id || member.family_code !== page.member.family_code || !['owner', 'editor'].includes(member.role)) throw new Error('当前不能录入语音，请重新进入页面');
      const result = await app.entryRequest({ action: 'transcribe', audio: read.data });
      if (disposed || token !== version) return;
      const current = app.globalData.member;
      if (!current || current._id !== member._id || current.family_code !== member.family_code || page.member.family_code !== member.family_code) throw new Error('家庭身份已变化，请重新进入后录音');
      await acceptText(result.text);
      update({ voiceStatus: '已转为文字，请核对原文、日期和数量后保存', voiceRetry: false });
      path = '';
    } catch (err) { update({ voiceStatus: err.message || '转文字失败，请重试', voiceRetry: !!path }); }
    finally { if (token === version) update({ transcribing: false }); }
  };
  const stopped = (result) => {
    if (!active) return;
    active = false; stopTicker(); update({ recording: false });
    if (disposed || cancelled) return;
    if (!result.tempFilePath || result.duration < 500) { update({ voiceStatus: '语音太短，请重新录音' }); return; }
    if (result.fileSize > 650000) { update({ voiceStatus: '录音过大，请分段录入' }); return; }
    path = result.tempFilePath; transcribe();
  };
  const failed = () => { stopTicker(); if (active) { active = false; update({ recording: false, voiceStatus: '录音未成功，请检查麦克风权限后重试' }); } };
  recorder.onStop(stopped); recorder.onError(failed);
  return {
    async start() {
      if (disposed || active || starting || page.data.transcribing) return;
      const attempt = ++startVersion;
      starting = true; update({ voiceStarting: true });
      try {
        const caps = await getApp().getEntryCapabilities();
        if (disposed || attempt !== startVersion) return;
        if (caps.speechToText !== 1) throw new Error('语音服务尚未开通，仍可直接输入文字');
        try { await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })); }
        catch (err) { update({ voicePermissionDenied: true }); throw new Error('麦克风权限未开启，可前往设置或切换键盘输入'); }
        if (disposed || attempt !== startVersion) return;
        cancelled = false; active = true; path = '';
        update({ recording: true, voiceSeconds: 0, voicePermissionDenied: false, voiceRetry: false, voiceStatus: '正在录音，点“说完了”转文字；最长60秒' });
        stopTicker(); ticker = setInterval(() => update({ voiceSeconds: Math.min(60, (page.data.voiceSeconds || 0) + 1) }), 1000);
        recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' });
      } catch (err) { if (attempt === startVersion) { stopTicker(); active = false; update({ recording: false, voiceStatus: err.message || '语音服务暂时不可用，可先用键盘输入并存本机' }); } }
      finally { if (attempt === startVersion) { starting = false; update({ voiceStarting: false }); } }
    },
    stop() { if (active) recorder.stop(); },
    cancel() { stopTicker(); startVersion += 1; starting = false; cancelled = true; if (active) recorder.stop(); update({ recording: false, voiceStarting: false, voiceStatus: '已取消录音' }); },
    retry: transcribe,
    reset() { path = ''; update({ voiceStatus: '', voiceRetry: false }); },
    dispose() { stopTicker(); disposed = true; version += 1; cancelled = true; if (active) recorder.stop(); recorder.offStop(stopped); recorder.offError(failed); },
  };
}
module.exports = { createVoice };
