// Music library: load tracks from a USB stick or any folder (or loose files),
// browse/search them, analyse BPM, and send them to deck A or B.

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|aif|aiff|webm)$/i;
const BPM_CACHE_KEY = 'djwoo.bpmCache.v1';
const MAX_ROWS = 400;

function loadCache() { try { return JSON.parse(localStorage.getItem(BPM_CACHE_KEY)) || {}; } catch { return {}; } }
function saveCache(c) { try { localStorage.setItem(BPM_CACHE_KEY, JSON.stringify(c)); } catch { /* storage unavailable */ } }

/** "Artist - Title (Extended Mix).mp3" → { artist, title } */
export function parseName(filename) {
  const base = filename.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s._-]+/, '').replace(/_/g, ' ').trim();
  const i = base.indexOf(' - ');
  return i > 0 ? { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() } : { artist: '', title: base };
}

export function createLibrary({ loadFile, analyzeFile, ready }) {
  const $ = (id) => document.getElementById(id);
  const panel = $('lib-panel');
  const rows = $('lib-rows');
  const search = $('lib-search');
  const folderInput = $('lib-folder-input');
  const filesInput = $('lib-files-input');
  let tracks = [];
  let sortBy = 'name';
  let analyzing = false;
  const cache = loadCache();

  function addTrack(name, path, size, getFile) {
    if (!AUDIO_EXT.test(name) || name.startsWith('._')) return;
    const key = `${name}|${size}`;
    if (tracks.some((t) => t.key === key)) return;
    tracks.push({ key, name, path, size, getFile, ...parseName(name), bpm: cache[key] ?? null });
  }

  async function scanHandle(dir, path, depth = 0) {
    if (depth > 10) return;
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      if (handle.kind === 'directory') await scanHandle(handle, `${path}/${name}`, depth + 1);
      else if (AUDIO_EXT.test(name)) {
        const file = await handle.getFile();
        addTrack(name, path, file.size, async () => handle.getFile());
      }
    }
  }

  async function openFolder() {
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker({ id: 'djwoo-music', mode: 'read' });
        setStatus(`Scanning ${dir.name}…`);
        const before = tracks.length;
        await scanHandle(dir, dir.name);
        setStatus(`Added ${tracks.length - before} tracks from ${dir.name}`);
        render();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('Folder picker unavailable, falling back', err);
      }
    }
    folderInput.click();
  }

  function addFileList(list) {
    const before = tracks.length;
    for (const f of list) {
      const rel = f.webkitRelativePath || f.name;
      addTrack(f.name, rel.split('/').slice(0, -1).join('/') || 'Files', f.size, async () => f);
    }
    setStatus(`Added ${tracks.length - before} tracks`);
    render();
  }

  folderInput.addEventListener('change', (e) => { addFileList(e.target.files); e.target.value = ''; });
  filesInput.addEventListener('change', (e) => { addFileList(e.target.files); e.target.value = ''; });
  $('lib-open-folder').addEventListener('click', openFolder);
  $('lib-add-files').addEventListener('click', () => filesInput.click());
  $('lib-analyze').addEventListener('click', analyzeAll);
  $('lib-clear').addEventListener('click', () => { tracks = []; setStatus(''); render(); });
  search.addEventListener('input', render);
  $('lib-sort').addEventListener('change', (e) => { sortBy = e.target.value; render(); });
  $('close-lib').addEventListener('click', () => { panel.hidden = true; });

  // drag a folder or files anywhere onto the library panel
  panel.addEventListener('dragover', (e) => { e.preventDefault(); panel.classList.add('drop'); });
  panel.addEventListener('dragleave', () => panel.classList.remove('drop'));
  panel.addEventListener('drop', async (e) => {
    e.preventDefault();
    panel.classList.remove('drop');
    const items = [...e.dataTransfer.items];
    const handles = await Promise.all(items.map((i) => i.getAsFileSystemHandle?.()).filter(Boolean));
    if (handles.length) {
      for (const h of handles) {
        if (!h) continue;
        if (h.kind === 'directory') await scanHandle(h, h.name);
        else { const f = await h.getFile(); addTrack(f.name, 'Dropped', f.size, async () => f); }
      }
      render();
    } else addFileList(e.dataTransfer.files);
  });

  function setStatus(text) { $('lib-status').textContent = text; }

  function filtered() {
    const q = search.value.trim().toLowerCase();
    const list = q ? tracks.filter((t) => `${t.artist} ${t.title} ${t.path}`.toLowerCase().includes(q)) : tracks.slice();
    if (sortBy === 'bpm') list.sort((a, b) => (a.bpm ?? 999) - (b.bpm ?? 999));
    else if (sortBy === 'artist') list.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    else if (sortBy === 'folder') list.sort((a, b) => a.path.localeCompare(b.path) || a.title.localeCompare(b.title));
    else list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }

  function render() {
    const list = filtered();
    $('lib-count').textContent = tracks.length ? `${list.length} of ${tracks.length} tracks` : '';
    $('lib-empty').hidden = tracks.length > 0;
    rows.replaceChildren(...list.slice(0, MAX_ROWS).map((t) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="lib-title"></div><div class="lib-artist"></div></td>
        <td class="mono lib-bpm">${t.bpm ? t.bpm.toFixed(1) : '–'}</td>
        <td class="lib-load"><button class="ghost load-a" title="Load to deck A">A</button><button class="ghost load-b" title="Load to deck B">B</button></td>`;
      tr.querySelector('.lib-title').textContent = t.title;
      tr.querySelector('.lib-artist').textContent = [t.artist, t.path].filter(Boolean).join(' · ');
      tr.querySelector('.load-a').addEventListener('click', () => load(t, 'A'));
      tr.querySelector('.load-b').addEventListener('click', () => load(t, 'B'));
      return tr;
    }));
    if (list.length > MAX_ROWS) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" class="dim">Showing ${MAX_ROWS} of ${list.length}. Search to narrow it down.</td>`;
      rows.append(tr);
    }
  }

  async function load(t, deckId) {
    await ready();
    const file = await t.getFile();
    const result = await loadFile(deckId, file);
    if (result?.bpm) { t.bpm = result.bpm; cache[t.key] = result.bpm; saveCache(cache); render(); }
  }

  async function analyzeAll() {
    if (analyzing) { analyzing = false; return; }
    await ready();
    analyzing = true;
    $('lib-analyze').textContent = 'Stop';
    const todo = tracks.filter((t) => !t.bpm);
    let done = 0;
    for (const t of todo) {
      if (!analyzing) break;
      setStatus(`Analysing BPM ${++done}/${todo.length}: ${t.title}`);
      try {
        const { bpm } = await analyzeFile(await t.getFile());
        t.bpm = bpm;
        cache[t.key] = bpm;
        saveCache(cache);
        if (done % 3 === 0) render();
      } catch { /* skip undecodable files */ }
    }
    analyzing = false;
    $('lib-analyze').textContent = 'Analyse BPM';
    setStatus(done ? `BPM analysis done (${done} tracks)` : 'All tracks already analysed');
    render();
  }

  render();
  return { open() { panel.hidden = false; search.focus(); } };
}
