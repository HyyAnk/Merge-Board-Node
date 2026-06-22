const DB_NAME = 'mergeboard-file-system';
const STORE_NAME = 'handles';
const ROOT_KEY = 'project-root';

let rootHandle = null;
const objectUrls = new Set();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function databaseRequest(mode, action) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

function requireRoot() {
  if (!rootHandle) throw new Error('Project folder access has not been granted');
  return rootHandle;
}

async function readJson(directory, name) {
  const handle = await directory.getFileHandle(name);
  return JSON.parse(await (await handle.getFile()).text());
}

async function writeJson(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  await writer.write(JSON.stringify(value, null, 2));
  await writer.close();
}

async function writeFile(directory, name, value) {
  const handle = await directory.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  await writer.write(value);
  await writer.close();
}

async function getProjectDirectory(folder, create = false) {
  return requireRoot().getDirectoryHandle(folder, { create });
}

async function ensureProjectDirectories(folder) {
  const directory = await getProjectDirectory(folder, true);
  await Promise.all([
    directory.getDirectoryHandle('assets', { create: true }),
    directory.getDirectoryHandle('texts', { create: true }),
  ]);
  return directory;
}

function cleanProjectName(value) {
  const name = String(value || '').trim().slice(0, 80);
  if (!name) throw new Error('Project name cannot be empty');
  return name;
}

function safeFolderBase(name) {
  let folder = cleanProjectName(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '').trim();
  if (!folder) folder = 'Project';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(folder)) folder = `_${folder}`;
  return folder;
}

async function uniqueFolderOnDisk(name, projects, excludeId = null, excludeFolder = '') {
  const base = safeFolderBase(name);
  const indexed = new Set(projects.filter((item) => item.id !== excludeId).map((item) => item.folder.toLowerCase()));
  let candidate = base;
  let suffix = 2;
  while (true) {
    const indexedConflict = indexed.has(candidate.toLowerCase());
    let diskConflict = false;
    if (candidate.toLowerCase() !== excludeFolder.toLowerCase()) {
      try {
        await requireRoot().getDirectoryHandle(candidate);
        diskConflict = true;
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    }
    if (!indexedConflict && !diskConflict) return candidate;
    candidate = `${base} (${suffix++})`;
  }
}

function safeTextName(id) {
  return `${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
}

function assetExtension(file) {
  const fromName = file.name?.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (fromName && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' })[file.type] || 'png';
}

function clearObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}

function makeObjectUrl(file) {
  const url = URL.createObjectURL(file);
  objectUrls.add(url);
  return url;
}

async function copyDirectory(source, destination) {
  for await (const [name, handle] of source.entries()) {
    if (handle.kind === 'directory') {
      await copyDirectory(handle, await destination.getDirectoryHandle(name, { create: true }));
    } else {
      await writeFile(destination, name, await handle.getFile());
    }
  }
}

export function isFileSystemAccessSupported() {
  return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
}

export async function getRememberedRoot() {
  if (!isFileSystemAccessSupported()) return null;
  try {
    return await databaseRequest('readonly', (store) => store.get(ROOT_KEY));
  } catch {
    return null;
  }
}

export async function rootPermission(handle, request = false) {
  if (!handle) return 'denied';
  const options = { mode: 'readwrite' };
  return request ? handle.requestPermission(options) : handle.queryPermission(options);
}

export async function useRoot(handle) {
  rootHandle = handle;
  await databaseRequest('readwrite', (store) => store.put(handle, ROOT_KEY));
  return { name: handle.name };
}

export async function chooseRoot() {
  const handle = await window.showDirectoryPicker({ id: 'mergeboard-project-root', mode: 'readwrite', startIn: 'documents' });
  await useRoot(handle);
  return { name: handle.name };
}

export function getRootName() {
  return rootHandle?.name || '';
}

export async function scanProjects() {
  const projects = [];
  const projectIds = new Set();
  for await (const [folder, handle] of requireRoot().entries()) {
    if (handle.kind !== 'directory') continue;
    try {
      const data = await readJson(handle, 'project.json');
      const now = new Date().toISOString();
      const meta = data.projectMeta || {};
      let id = typeof meta.id === 'string' && meta.id ? meta.id : crypto.randomUUID();
      if (projectIds.has(id)) id = crypto.randomUUID();
      projectIds.add(id);
      const project = {
        id,
        name: meta.name || folder,
        folder,
        createdAt: meta.createdAt || now,
        updatedAt: data.updatedAt || now,
        nodeCount: Array.isArray(data.nodes) ? data.nodes.length : 0,
        edgeCount: Array.isArray(data.edges) ? data.edges.length : 0,
      };
      data.version = 4;
      data.projectMeta = { id: project.id, name: project.name, createdAt: project.createdAt };
      await writeJson(handle, 'project.json', data);
      projects.push(project);
    } catch {
      // A normal folder without project.json is intentionally ignored.
    }
  }
  return projects.sort((first, second) => new Date(second.updatedAt) - new Date(first.updatedAt));
}

export async function createProject(name, projects) {
  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    name: cleanProjectName(name),
    folder: await uniqueFolderOnDisk(name, projects),
    createdAt: now,
    updatedAt: now,
    nodeCount: 0,
    edgeCount: 0,
  };
  const directory = await ensureProjectDirectories(project.folder);
  await writeJson(directory, 'project.json', {
    version: 4,
    projectMeta: { id: project.id, name: project.name, createdAt: project.createdAt },
    updatedAt: now,
    nodes: [],
    edges: [],
  });
  return project;
}

export async function readProject(project) {
  clearObjectUrls();
  const directory = await getProjectDirectory(project.folder);
  const data = await readJson(directory, 'project.json');
  const assets = await directory.getDirectoryHandle('assets', { create: true });
  const texts = await directory.getDirectoryHandle('texts', { create: true });
  const nodes = await Promise.all((data.nodes || []).map(async (node) => {
    const next = { ...node, data: { ...(node.data || {}) } };
    if (node.type === 'textNode' && next.data.textFile) {
      try {
        const fileName = next.data.textFile.split('/').pop();
        next.data.content = await (await (await texts.getFileHandle(fileName)).getFile()).text();
      } catch {
        next.data.content ||= '';
      }
    }
    if (['imageNode', 'exampleNode', 'canvasImageNode'].includes(node.type) && next.data.assetFile) {
      try {
        next.data.image = makeObjectUrl(await (await assets.getFileHandle(next.data.assetFile)).getFile());
      } catch {
        next.data.image = '';
      }
    }
    return next;
  }));
  return { ...data, nodes };
}

export async function saveProject(project, nodes, edges) {
  const directory = await ensureProjectDirectories(project.folder);
  const assets = await directory.getDirectoryHandle('assets', { create: true });
  const texts = await directory.getDirectoryHandle('texts', { create: true });
  const referencedTexts = new Set();
  const referencedAssets = new Set();
  const persistedNodes = await Promise.all(nodes.map(async (node) => {
    const clean = {
      id: node.id,
      type: node.type,
      position: node.position,
      selected: Boolean(node.selected),
      data: { ...(node.data || {}) },
    };
    delete clean.data.resources;
    delete clean.data.resourceCount;
    if (node.type === 'textNode') {
      const file = safeTextName(node.id);
      await writeFile(texts, file, String(node.data?.content || ''));
      referencedTexts.add(file);
      delete clean.data.content;
      clean.data.textFile = `texts/${file}`;
    }
    if (['imageNode', 'exampleNode', 'canvasImageNode'].includes(node.type)) {
      if (node.data?.assetFile) referencedAssets.add(node.data.assetFile);
      delete clean.data.image;
    }
    return clean;
  }));
  const updatedAt = new Date().toISOString();
  await writeJson(directory, 'project.json', {
    version: 4,
    projectMeta: { id: project.id, name: project.name, createdAt: project.createdAt },
    updatedAt,
    nodes: persistedNodes,
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      type: edge.type || 'beam',
      data: edge.data || {},
    })),
  });
  for await (const [name, handle] of texts.entries()) {
    if (handle.kind === 'file' && !referencedTexts.has(name)) await texts.removeEntry(name);
  }
  for await (const [name, handle] of assets.entries()) {
    if (handle.kind !== 'file' || referencedAssets.has(name)) continue;
    const file = await handle.getFile();
    if (Date.now() - file.lastModified > 5000) await assets.removeEntry(name);
  }
  return { updatedAt, nodeCount: nodes.length, edgeCount: edges.length };
}

export async function uploadAsset(project, file, preferredName = '') {
  if (!(file instanceof Blob) || !file.size || file.size > 25 * 1024 * 1024) throw new Error('The image is empty or larger than 25 MB');
  const directory = await ensureProjectDirectories(project.folder);
  const assets = await directory.getDirectoryHandle('assets', { create: true });
  const assetFile = `${crypto.randomUUID()}.${assetExtension({ name: preferredName || file.name, type: file.type })}`;
  await writeFile(assets, assetFile, file);
  const storedFile = await (await assets.getFileHandle(assetFile)).getFile();
  return { url: makeObjectUrl(storedFile), assetFile, fileName: preferredName || file.name || assetFile };
}

export async function renameProject(project, name, projects) {
  const nextName = cleanProjectName(name);
  const nextFolder = await uniqueFolderOnDisk(nextName, projects, project.id, project.folder);
  let directory = await getProjectDirectory(project.folder);
  if (nextFolder !== project.folder) {
    const destination = await getProjectDirectory(nextFolder, true);
    await copyDirectory(directory, destination);
    await requireRoot().removeEntry(project.folder, { recursive: true });
    directory = destination;
  }
  const updated = { ...project, name: nextName, folder: nextFolder, updatedAt: new Date().toISOString() };
  const data = await readJson(directory, 'project.json');
  data.updatedAt = updated.updatedAt;
  data.projectMeta = { id: updated.id, name: updated.name, createdAt: updated.createdAt };
  await writeJson(directory, 'project.json', data);
  return updated;
}

export async function deleteProject(project) {
  await requireRoot().removeEntry(project.folder, { recursive: true });
}
