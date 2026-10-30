function createVoice(page, acceptText) {
  const recorder = wx.getRecorderManager();
  let ticker = null, pollTimer = null, resumePoll = null;
  const stopTicker = () => { if (ticker) clearInterval(ticker); ticker = null; };
  let disposed = false, cancelled = false, active = false, starting = false, path = '', version = 0, startVersion = 0;
  let task = null, scope = null, upload = null;
  const update = (data) => { if (!disposed) page.setData(data); };
  const stopPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    if (resumePoll) resumePoll();
    resumePoll = null;
  };
  const sameScope = (member) => !!member && !!scope && !!page.member
    && member._id === scope.memberId && member.family_code === scope.familyCode
    && page.member._id === scope.memberId && page.member.family_code === scope.familyCode
    && ['owner', 'editor'].includes(member.role);
  const transcribe = async () => {
    if ((!path && !task) || disposed || page.data.transcribing || page.data.recognizing) return;
    const token = ++version;
    const current = () => !disposed && token === version;
    update({ transcribing: true, voiceRetry: false, voiceStatus: task ? '继续获取转写文字…' : '正在提交语音转写…' });
    try {
      const app = getApp(), member = await app.ensureMember();
      if (!current()) return;
      if (!sameScope(member)) throw new Error('家庭身份已变化，请重新进入后录音');
      if (!task) {
        if (!upload) {
          const source = scope, sourcePath = path;
          const submission = (async () => {
            const read = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: sourcePath, encoding: 'base64', success: resolve, fail: reject }));
            if (disposed || source !== scope || sourcePath !== path || !sameScope(app.globalData.member)) throw new Error('录音状态已变化，请重新录音');
            const result = await app.entryRequest(Object.assign({ action: 'transcribeStart', audio: read.data }, source));
            if (!result.task || !Number.isSafeInteger(result.task.id) || result.task.id <= 0 || !Number.isSafeInteger(result.task.expiresAt)
              || typeof result.task.signature !== 'string' || !/^[a-f0-9]{64}$/.test(result.task.signature)) throw new Error('语音任务返回异常，请重新录音');
            // 切 Tab 只暂停查询；迟到的提交回执仍保留，回来继续查原任务。
            if (!disposed && source === scope && sourcePath === path) {
              task = result.task;
              if (!page.data.transcribing) update({ voiceRetry: true, voiceRetryLabel: '继续获取文字', voiceStatus: '已暂停获取转写，返回后可继续' });
            }
          })().finally(() => { if (upload === submission) upload = null; });
          upload = submission;
        }
        await upload;
        if (!current()) return;
        if (!task) throw new Error('录音状态已变化，请重新录音');
      }
      const deadline = Date.now() + 45000;
      while (current()) {
        if (!sameScope(app.globalData.member)) throw new Error('家庭身份已变化，请重新进入后录音');
        const result = await app.entryRequest(Object.assign({ action: 'transcribeStatus', task }, scope));
        if (!current()) return;
        if (!sameScope(app.globalData.member)) throw new Error('家庭身份已变化，请重新进入后录音');
        if (result.state === 'done') {
          if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('转写文字返回异常，请继续获取');
          const text = result.text.trim();
          // 先消费这份结果，避免 AI 分析失败后的重试重复追加转写原文。
          task = null; path = '';
          update({ voiceStatus: '已转为文字，正在交给 AI 整理…' });
          await acceptText(text);
          if (current()) update({ voiceStatus: page.data.text.length > 500
            ? '文字已完整保留，超过500字，请分段后分析和保存'
            : '已转为文字，请核对原文、日期和数量后保存', voiceRetry: false });
          return;
        }
        if (['empty', 'failed', 'expired'].includes(result.state)) {
          task = null; path = '';
          throw new Error(result.state === 'expired' ? '这段语音已过期，请重新录音'
            : result.state === 'empty' ? '没有识别到清楚的语音，请重新录音' : '这段语音转写失败，请重新录音或改用文字');
        }
        if (result.state !== 'pending') throw new Error('转写状态异常，请稍后继续获取');
        if (Date.now() >= deadline) throw new Error('语音仍在转写，稍后点“继续获取文字”，无需重新上传');
        update({ voiceStatus: '正在转文字，完成后自动交给 AI 整理…' });
        await new Promise((resolve) => { resumePoll = resolve; pollTimer = setTimeout(() => { pollTimer = null; resumePoll = null; resolve(); }, 2000); });
      }
    } catch (err) {
      if (current()) update({ voiceStatus: err.message || err.errMsg || '转文字失败，请重试', voiceRetry: !!(path || task),
        voiceRetryLabel: task ? '继续获取文字' : '重试上传这段语音' });
    } finally { if (current()) update({ transcribing: false }); }
  };
  const stopped = (result) => {
    if (!active) return;
    active = false; stopTicker(); update({ recording: false, voiceStarting: false });
    if (disposed || cancelled) return;
    if (!result.tempFilePath || result.duration < 500) { update({ voiceStatus: '语音太短，请重新录音' }); return; }
    if (result.fileSize > 650000) { update({ voiceStatus: '录音过大，请分段录入' }); return; }
    path = result.tempFilePath; transcribe();
  };
  const failed = () => { stopTicker(); if (active) { active = false; update({ recording: false, voiceStatus: '录音未成功，请检查麦克风权限后重试' }); } };
  recorder.onStop(stopped); recorder.onError(failed);
  return {
    async start() {
      if (disposed || active || starting || page.data.transcribing || page.data.recognizing) return;
      const attempt = ++startVersion;
      starting = true; update({ voiceStarting: true });
      try {
        const app = getApp(), member = await app.ensureMember();
        if (disposed || attempt !== startVersion) return;
        if (!member || !page.member || member._id !== page.member._id || member.family_code !== page.member.family_code
          || !['owner', 'editor'].includes(member.role)) throw new Error('当前不能录入语音，请重新进入页面');
        const caps = await app.getEntryCapabilities();
        if (disposed || attempt !== startVersion) return;
        if (caps.speechToText !== 1) throw new Error('语音服务尚未开通，仍可直接输入文字');
        if (caps.speechTasks !== 1) throw new Error('语音转写接口待更新，仍可直接输入文字');
        try { await new Promise((resolve, reject) => wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })); }
        catch (err) { update({ voicePermissionDenied: true }); throw new Error('麦克风权限未开启，可前往设置或切换键盘输入'); }
        if (disposed || attempt !== startVersion) return;
        scope = { memberId: member._id, familyCode: member.family_code };
        if (!sameScope(app.globalData.member)) throw new Error('家庭身份已变化，请重新进入后录音');
        cancelled = false; active = true; path = ''; task = null; upload = null;
        update({ recording: true, voiceSeconds: 0, voicePermissionDenied: false, voiceRetry: false, voiceStatus: '正在录音，点“说完了”转文字；最长60秒' });
        stopTicker(); ticker = setInterval(() => update({ voiceSeconds: Math.min(60, (page.data.voiceSeconds || 0) + 1) }), 1000);
        recorder.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000, format: 'mp3' });
      } catch (err) { if (attempt === startVersion) { stopTicker(); active = false; update({ recording: false, voiceStatus: err.message || '语音服务暂时不可用，可先用键盘输入并存本机' }); } }
      finally { if (attempt === startVersion) { starting = false; update({ voiceStarting: false }); } }
    },
    stop() { if (active) recorder.stop(); },
    cancel() {
      stopTicker(); stopPolling(); startVersion += 1; version += 1; starting = false; cancelled = true;
      if (active) recorder.stop();
      update({ recording: false, voiceStarting: false, transcribing: false, voiceRetry: !!(path || task),
        voiceRetryLabel: task ? '继续获取文字' : '重试上传这段语音', voiceStatus: task ? '已暂停获取转写，返回后可继续' : '已取消录音' });
    },
    retry: transcribe,
    reset() { version += 1; stopPolling(); path = ''; task = null; upload = null; update({ transcribing: false, voiceStatus: '', voiceRetry: false }); },
    dispose() { stopTicker(); stopPolling(); disposed = true; version += 1; startVersion += 1; cancelled = true; if (active) recorder.stop(); recorder.offStop(stopped); recorder.offError(failed); },
  };
}
module.exports = { createVoice };
