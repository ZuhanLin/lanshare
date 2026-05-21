import fsp from 'node:fs/promises'
import path from 'node:path'

export interface ListingEntry {
  name: string
  isDir: boolean
  size: number
}

export interface RenderOptions {
  root: string
  relDir: string
  uploadEnabled: boolean
}

export async function readEntries(absDir: string): Promise<ListingEntry[]> {
  const dirents = await fsp.readdir(absDir, { withFileTypes: true })
  const entries: ListingEntry[] = []
  for (const d of dirents) {
    if (d.name.startsWith('.lanshare-upload-')) continue
    let size = 0
    const isDir = d.isDirectory()
    if (!isDir) {
      try {
        const stat = await fsp.stat(path.join(absDir, d.name))
        size = stat.size
      } catch {
        continue
      }
    }
    entries.push({ name: d.name, isDir, size })
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return entries
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function encodeSegment(name: string): string {
  return encodeURIComponent(name)
}

function buildBreadcrumbs(relDir: string): string {
  const parts = relDir.split('/').filter(Boolean)
  const crumbs: string[] = [`<a href="/">/</a>`]
  let acc = ''
  for (const part of parts) {
    acc += '/' + encodeSegment(part)
    crumbs.push(`<a href="${acc}/">${htmlEscape(part)}</a>`)
  }
  return crumbs.join(' <span class="sep">›</span> ')
}

export async function renderDirectoryListing(opts: RenderOptions): Promise<string> {
  const absDir = path.resolve(opts.root, opts.relDir)
  const entries = await readEntries(absDir)
  const isRoot = opts.relDir === ''
  const title = opts.relDir ? `/${opts.relDir}/` : '/'

  const rows: string[] = []
  if (!isRoot) {
    rows.push(`<li class="row"><a href="../">📁 ..</a></li>`)
  }
  for (const e of entries) {
    const href = encodeSegment(e.name) + (e.isDir ? '/' : '')
    const icon = e.isDir ? '📁' : '📄'
    const sizeCell = e.isDir ? '' : `<span class="size">${formatSize(e.size)}</span>`
    const label = htmlEscape(e.name) + (e.isDir ? '/' : '')
    rows.push(
      `<li class="row"><a href="${href}">${icon} ${label}</a>${sizeCell}</li>`,
    )
  }

  const uploadSection = opts.uploadEnabled ? renderUploadSection(opts.relDir) : ''
  const styles = STYLES + (opts.uploadEnabled ? UPLOAD_STYLES : '')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${htmlEscape(title)} — lanshare</title>
  <style>${styles}</style>
</head>
<body>
  <header>
    <nav class="crumbs">${buildBreadcrumbs(opts.relDir)}</nav>
  </header>
  <main>
    <ul class="entries">${rows.join('')}</ul>
    ${uploadSection}
  </main>
</body>
</html>`
}

const STYLES = `
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#f6f7f9;color:#222;padding:0 0 40px}
header{background:#fff;border-bottom:1px solid #e3e6ea;padding:14px 16px;position:sticky;top:0;z-index:10}
.crumbs{font-size:15px;line-height:1.4;word-break:break-all}
.crumbs a{color:#0a66c2;text-decoration:none}
.crumbs a:active{opacity:.6}
.crumbs .sep{color:#999;margin:0 4px}
main{padding:8px 16px}
.entries{list-style:none;margin:0;padding:0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.row{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f0f1f3;padding:0}
.row:last-child{border-bottom:none}
.row a{flex:1;padding:14px 16px;color:#222;text-decoration:none;font-size:16px;word-break:break-all}
.row a:active{background:#f0f4fa}
.size{padding:0 16px;color:#888;font-size:13px;font-variant-numeric:tabular-nums}
`

const UPLOAD_STYLES = `
.upload{margin-top:20px;background:#fff;border-radius:10px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.upload h2{margin:0 0 12px;font-size:15px;color:#555;font-weight:600}
#ls-drop{border:2px dashed #c0c8d4;border-radius:10px;padding:28px 16px;text-align:center;color:#667;cursor:pointer;font-size:15px;background:#fafbfc;-webkit-tap-highlight-color:transparent}
#ls-drop.drag{border-color:#0a66c2;background:#eef5fd;color:#0a66c2}
#ls-drop:active{background:#eef0f3}
#ls-queue{list-style:none;margin:14px 0 0;padding:0}
#ls-queue li{display:flex;justify-content:space-between;align-items:center;padding:10px 4px;border-bottom:1px solid #f0f1f3;font-size:14px;gap:12px}
#ls-queue li:last-child{border-bottom:none}
#ls-queue .name{flex:1;word-break:break-all}
#ls-queue .status{font-size:13px;color:#888;white-space:nowrap}
#ls-queue .status.ok{color:#1a7f37}
#ls-queue .status.err{color:#c62828}
#ls-queue .status.skip{color:#888}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:flex-end;justify-content:center;z-index:100}
.modal{background:#fff;border-radius:14px 14px 0 0;width:100%;max-width:480px;padding:18px 16px 24px}
.modal h3{margin:0 0 8px;font-size:16px;word-break:break-all}
.modal p{margin:0 0 14px;color:#666;font-size:14px}
.modal .actions{display:flex;flex-direction:column;gap:8px}
.modal button{border:1px solid #d0d4da;background:#fff;border-radius:8px;padding:14px;font-size:15px;cursor:pointer;-webkit-tap-highlight-color:transparent}
.modal button:active{background:#f0f4fa}
.modal button.primary{background:#0a66c2;color:#fff;border-color:#0a66c2}
.modal button.danger{color:#c62828;border-color:#f3c1c1}
.modal label{display:flex;align-items:center;gap:8px;color:#666;font-size:13px;padding:10px 4px 0}
`

function renderUploadSection(relDir: string): string {
  const dirJSON = JSON.stringify(relDir)
  return `<section class="upload">
    <h2>📤 Upload to this folder</h2>
    <div id="ls-drop">Tap to choose files, or drop them here</div>
    <input id="ls-picker" type="file" multiple hidden>
    <ul id="ls-queue"></ul>
  </section>
  <script>
${UPLOAD_SCRIPT.replace('__DIR_JSON__', dirJSON)}
  </script>`
}

const UPLOAD_SCRIPT = `(function(){
  const dir = __DIR_JSON__;
  const dropzone = document.getElementById('ls-drop');
  const picker = document.getElementById('ls-picker');
  const queue = document.getElementById('ls-queue');
  let applyToAll = null;

  dropzone.addEventListener('click', () => picker.click());
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    handleFiles(e.dataTransfer.files);
  });
  picker.addEventListener('change', () => { handleFiles(picker.files); picker.value = ''; });

  function joinPath(dir, name) {
    return dir ? dir + '/' + name : name;
  }

  function appendItem(name) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    const s = document.createElement('span');
    s.className = 'status';
    s.textContent = 'Waiting…';
    li.append(n, s);
    queue.appendChild(li);
    return s;
  }
  function setStatus(el, text, cls) {
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  async function handleFiles(fileList) {
    applyToAll = null;
    const files = Array.from(fileList);
    for (const f of files) {
      await uploadOne(f);
    }
  }

  async function uploadOne(file) {
    const status = appendItem(file.name);
    let mode = 'reject';
    try {
      const checkRes = await fetch('/__check?path=' + encodeURIComponent(joinPath(dir, file.name)));
      const checkJson = await checkRes.json();
      if (checkJson.exists) {
        if (applyToAll) {
          mode = applyToAll;
        } else {
          const choice = await askConflict(file.name);
          if (!choice) { setStatus(status, 'Skipped', 'skip'); return; }
          if (choice.applyAll) applyToAll = choice.mode;
          mode = choice.mode;
        }
      }
      setStatus(status, 'Uploading…');
      const fd = new FormData();
      fd.append('file', file);
      const url = '/__upload?dir=' + encodeURIComponent(dir) + '&onConflict=' + mode;
      const res = await fetch(url, { method: 'POST', body: fd });
      if (!res.ok) {
        const txt = await res.text();
        setStatus(status, 'Failed: ' + (txt || res.status), 'err');
        return;
      }
      const body = await res.json();
      setStatus(status, '✓ Saved as ' + body.finalName, 'ok');
      if (!document.querySelector('.refresh-hint')) {
        const hint = document.createElement('div');
        hint.className = 'refresh-hint';
        hint.style.cssText = 'margin-top:10px;font-size:13px;color:#666;text-align:center';
        hint.innerHTML = '<a href="" style="color:#0a66c2">↻ Refresh to see new files</a>';
        queue.parentNode.appendChild(hint);
      }
    } catch (err) {
      setStatus(status, 'Failed: ' + err.message, 'err');
    }
  }

  function askConflict(name) {
    return new Promise(resolve => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = '<h3>' + escapeHtml(name) + '</h3><p>A file with this name already exists. What do you want to do?</p>' +
        '<div class="actions">' +
        '<button class="rename primary">Keep both (add suffix)</button>' +
        '<button class="overwrite danger">Overwrite</button>' +
        '<button class="skip">Skip</button>' +
        '</div>' +
        '<label><input type="checkbox" id="applyAll"> Apply to remaining conflicts</label>';
      bg.appendChild(modal);
      document.body.appendChild(bg);
      const cleanup = () => bg.remove();
      const applyAll = () => modal.querySelector('#applyAll').checked;
      modal.querySelector('.rename').onclick = () => { cleanup(); resolve({ mode: 'rename', applyAll: applyAll() }); };
      modal.querySelector('.overwrite').onclick = () => { cleanup(); resolve({ mode: 'overwrite', applyAll: applyAll() }); };
      modal.querySelector('.skip').onclick = () => { cleanup(); resolve(null); };
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
})();`
