const $ = selector => document.querySelector(selector);
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
let selectedId = null, detailSignature = '', listSignature = '', refreshing = false;
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'X-Docapod': '1', ...options.headers } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'The app could not complete this request.'); }
  return response.status === 204 ? null : response.json();
}
function showError(selector, message) { $(selector).textContent = message || ''; $(selector).hidden = !message; }
function providerNote() {
  const voice = $('#voice-provider').value, script = $('#script-provider').value;
  const notes = [];
  if (script === 'demo') notes.push('Offline preview selects source excerpts; it does not interpret the research.');
  if (voice === 'elevenlabs') notes.push('The script will be sent to ElevenLabs. Your plan may incur charges.');
  else if (voice === 'demo') notes.push('Test tones only: this mode produces no spoken audio.');
  else notes.push('Kokoro runs on this Mac. First use downloads the voice model; generation can take several minutes.');
  $('#provider-note').textContent = notes.join(' ');
}
$('#script-provider').addEventListener('change', providerNote);
$('#voice-provider').addEventListener('change', providerNote);
$('#paper').addEventListener('change', () => { $('#file-label').textContent = $('#paper').files[0]?.name || 'Choose a research paper'; });
for (const event of ['dragenter', 'dragover']) $('#dropzone').addEventListener(event, () => $('#dropzone').classList.add('dragging'));
for (const event of ['dragleave', 'drop']) $('#dropzone').addEventListener(event, () => $('#dropzone').classList.remove('dragging'));
$('#upload-form').addEventListener('submit', async event => {
  event.preventDefault(); showError('#form-error', '');
  const file = $('#paper').files[0];
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return showError('#form-error', 'This file exceeds the 20 MB upload limit.');
  $('#create-button').disabled = true; $('#create-button').textContent = 'Uploading paper…';
  try {
    const episode = await api('/api/episodes', { method: 'POST', body: new FormData(event.target) });
    selectedId = episode.id; detailSignature = ''; listSignature = '';
    $('#paper').value = ''; $('#file-label').textContent = 'Choose a research paper';
    await refresh(); $('#episode-detail').focus();
  } catch (error) { showError('#form-error', error.message); }
  finally { $('#create-button').disabled = false; $('#create-button').textContent = 'Create podcast'; }
});
function renderList(episodes) {
  const signature = JSON.stringify([selectedId, episodes]);
  if (signature === listSignature) return;
  listSignature = signature;
  $('#episode-count').textContent = episodes.length;
  $('#empty-state').hidden = episodes.length > 0;
  $('#episode-list').replaceChildren(...episodes.map(episode => {
    const button = el('button', undefined, 'episode-row');
    button.setAttribute('aria-pressed', String(episode.id === selectedId));
    const mark = el('span', '≋', 'episode-mark'); mark.setAttribute('aria-hidden', 'true');
    const body = el('span'); body.append(el('strong', episode.title), el('small', `${new Date(episode.createdAt).toLocaleDateString()} · ${episode.voiceProvider === 'demo' ? 'Test tones' : episode.voiceProvider === 'kokoro' ? 'Local voices' : 'ElevenLabs'}${episode.pages ? ` · ${episode.pages} page${episode.pages === 1 ? '' : 's'}` : ''}`));
    button.append(mark, body, el('span', { queued: 'Queued', working: 'Creating', ready: 'Ready', failed: 'Needs attention' }[episode.status], `badge ${episode.status}`));
    button.addEventListener('click', () => { if (selectedId !== episode.id) { selectedId = episode.id; detailSignature = ''; } refresh(); });
    return button;
  }));
}
async function renderDetail(episode) {
  const signature = JSON.stringify(episode);
  if (signature === detailSignature) return; // Preserve playback while polling.
  detailSignature = signature;
  const detail = $('#episode-detail'); detail.hidden = false; detail.replaceChildren();
  detail.append(el('p', 'YOUR RESEARCH, IN CONVERSATION', 'eyebrow'), el('h2', episode.title));
  detail.append(el('p', `${episode.scriptProvider === 'demo' ? 'Offline excerpt preview' : 'Written with Ollama'} · ${episode.script?.words || 0} words · ${episode.script?.pages || 0} of 10 pages${episode.audio ? ` · ${Math.ceil(episode.audio.seconds / 60)} min` : ''}`, 'meta'));
  if (episode.script?.warning) detail.append(el('p', episode.script.warning, 'notice'));
  if (episode.voiceProvider === 'demo') detail.append(el('p', 'This is a test recording with alternating tones, not spoken audio. Select Kokoro for a real podcast.', 'notice'));
  if (episode.status === 'ready') {
    const audio = el('audio'); audio.controls = true; audio.preload = 'metadata'; audio.src = `/api/episodes/${episode.id}/audio`; audio.setAttribute('aria-label', episode.title); detail.append(audio);
  } else {
    const progress = el('p', episode.message, episode.status === 'failed' ? 'error' : 'progress-message'); progress.setAttribute('role', 'status'); detail.append(progress);
  }
  const actions = el('div', undefined, 'actions');
  if (episode.status === 'ready') { const link = el('a', 'Download audio'); link.href = `/api/episodes/${episode.id}/audio?download=1`; link.download = 'doc-a-pod.wav'; actions.append(link); }
  if (episode.script) {
    const download = el('button', 'Save script', 'quiet');
    download.onclick = () => {
      const text = `${episode.title}\n${episode.script.words} words · ${episode.script.pages} pages\n\n${episode.script.lines.map(line => `${line.host}: ${line.text}`).join('\n\n')}`;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); const link = el('a'); link.href = url; link.download = 'doc-a-pod-script.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    }; actions.append(download);
  }
  if (episode.status === 'failed') {
    const retry = el('button', 'Retry episode', 'quiet');
    retry.onclick = async () => {
      if (episode.voiceProvider === 'elevenlabs' && !confirm('Retrying will resend the script to ElevenLabs and may incur charges. Continue?')) return;
      retry.disabled = true;
      try { await api(`/api/episodes/${episode.id}/retry`, { method: 'POST' }); await refresh(); }
      catch (error) { showError('#connection-error', error.message); retry.disabled = false; }
    }; actions.append(retry);
  }
  if (['ready', 'failed'].includes(episode.status)) {
    const remove = el('button', 'Delete', 'quiet delete');
    remove.onclick = async () => {
      if (!confirm('Delete this episode, script, and uploaded paper from this Mac?')) return;
      try { await api(`/api/episodes/${episode.id}`, { method: 'DELETE' }); selectedId = null; detailSignature = ''; await refresh(); }
      catch (error) { showError('#connection-error', error.message); }
    }; actions.append(remove);
  }
  detail.append(actions);
  if (episode.script) {
    const heading = el('div', undefined, 'script-heading'); heading.append(el('h3', 'The conversation'), el('span', 'Maya & Leo')); detail.append(heading);
    let lastTopic;
    episode.script.lines.forEach((line, index) => {
      if (line.topic !== lastTopic) { detail.append(el('h4', `The ${line.topic}`, 'script-topic')); lastTopic = line.topic; }
      const row = el('div', undefined, 'script-line'); row.append(el('div', line.host[0], `avatar ${line.host.toLowerCase()}`));
      const content = el('div'); content.append(el('strong', line.host), el('p', line.text));
      if (episode.audio?.timeline[index]) {
        const seek = el('button', 'Listen from here'); seek.onclick = () => { const audio = detail.querySelector('audio'); audio.currentTime = episode.audio.timeline[index].start; audio.play().catch(() => showError('#connection-error', 'Tap the audio player to start playback.')); }; content.append(seek);
      }
      row.append(content); detail.append(row);
    });
  }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const episodes = await api('/api/episodes');
    if (!episodes.some(e => e.id === selectedId)) { selectedId = episodes[0]?.id || null; detailSignature = ''; }
    renderList(episodes);
    if (selectedId) await renderDetail(await api(`/api/episodes/${selectedId}`));
    else $('#episode-detail').hidden = true;
    showError('#connection-error', '');
  } catch (error) { showError('#connection-error', `Cannot reach the Mac. Keep the app running and check your connection. ${error.message}`); }
  finally { refreshing = false; }
}
$('#refresh').onclick = refresh;
$('#install-help').onclick = () => $('#help-dialog').showModal();
async function init() {
  try {
    const settings = await api('/api/settings');
    $('#script-provider').value = settings.scriptProvider;
    const eleven = $('#voice-provider option[value=elevenlabs]'); eleven.disabled = !settings.elevenlabsAvailable; eleven.textContent = settings.elevenlabsAvailable ? 'ElevenLabs · cloud voices' : 'ElevenLabs · setup required';
    $('#voice-provider').value = settings.voiceProvider === 'elevenlabs' && !settings.elevenlabsAvailable ? 'kokoro' : settings.voiceProvider;
    providerNote();
  } catch { showError('#form-error', 'Could not load settings. Check that the Mac app is running.'); }
  await refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 2500);
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
init();
