import React, { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  NodeResizer,
  Handle,
  Position,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore,
  useNodeId,
  useUpdateNodeInternals,
  SelectionMode,
  BaseEdge,
  EdgeLabelRenderer,
  ViewportPortal,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronLeft,
  Copy,
  Download,
  FileImage,
  FileText,
  FolderOpen,
  FolderKanban,
  FolderPlus,
  GripVertical,
  Image as ImageIcon,
  Layers3,
  Menu,
  MessageSquare,
  Merge,
  Maximize2,
  Minimize2,
  Moon,
  MousePointer2,
  Palette,
  Plus,
  Pencil,
  ChevronDown,
  RotateCcw,
  Scissors,
  Settings,
  Square,
  Sun,
  Trash2,
  Type,
  Upload,
  Waypoints,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';
import * as fileStorage from './fileSystemStorage.js';

const STORAGE_KEY = 'mergeboard-project-v1';
const ACTIVE_PROJECT_KEY = 'mergeboard-active-project-v1';
const THEME_KEY = 'mergeboard-theme-v1';
const SHOPAIKEY_API_KEY = 'mergeboard-shopaikey-api-key-v1';
const LOCAL_PROJECT_ROOT_PATH_KEY = 'mergeboard-local-project-root-path-v1';
const SHOPAIKEY_BASE_URL = 'https://direct.shopaikey.com/v1';
const SHOPAIKEY_IMAGE_MODEL = 'gpt-image-2';
const GEN_IMAGE_SIZES = { landscape: '1536x1024', portrait: '1024x1536' };
const NodeActionsContext = createContext(null);
const EdgeActionsContext = createContext(null);

const ENGLISH_TEXT_REPLACEMENTS = [
  ['â€¦', '…'],
  ['Â·', '·'],
  ['â€”', '—'],
  ['â€œ', '“'],
  ['â€', '”'],
  ['â€˜', '‘'],
  ['â€™', '’'],
  ['Ã—', '×'],
];

function translateEnglish(value) {
  if (typeof value !== 'string') return value;
  return ENGLISH_TEXT_REPLACEMENTS.reduce((text, [broken, replacement]) => text.replaceAll(broken, replacement), value);
}

function normalizeGenOrientation(value) {
  return value === 'portrait' ? 'portrait' : 'landscape';
}

function useTranslation() {
  return translateEnglish;
}

const NODE_COLORS = ['#7c6cf2', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7'];
const EDGE_COLORS = ['#8b7cf6', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef476f'];

const sampleImage = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffd06b"/><stop offset=".48" stop-color="#ff8b72"/><stop offset="1" stop-color="#7756e8"/></linearGradient></defs>
    <rect width="800" height="500" rx="32" fill="url(#g)"/><circle cx="624" cy="120" r="86" fill="#fff" fill-opacity=".25"/>
    <path d="M0 380 180 215l116 112 108-88L630 450H0Z" fill="#30234f" fill-opacity=".82"/><path d="m310 500 185-183 77 67 80-105 148 161v60Z" fill="#17102d" fill-opacity=".82"/>
    <text x="46" y="76" fill="white" font-size="24" font-family="Arial" font-weight="700" letter-spacing="5">VISUAL STORY</text>
  </svg>`)}`;

const initialNodes = [
  {
    id: 'text-1',
    type: 'textNode',
    position: { x: 80, y: 95 },
    data: { title: 'Headline', content: 'Turn scattered ideas into one clear, connected story.', color: '#3b82f6', viewMode: 'expanded' },
  },
  {
    id: 'image-1',
    type: 'imageNode',
    position: { x: 80, y: 370 },
    data: { title: 'Key visual', image: sampleImage, fileName: 'visual-story.svg', color: '#f59e0b', viewMode: 'expanded' },
  },
  {
    id: 'text-2',
    type: 'textNode',
    position: { x: 430, y: 110 },
    data: { title: 'Supporting copy', content: 'A visual workspace to collect, connect, and reuse every creative resource.', color: '#06b6d4', viewMode: 'expanded' },
  },
  {
    id: 'mixer-1',
    type: 'mixerNode',
    position: { x: 820, y: 190 },
    data: { title: 'Campaign pack', color: '#7c6cf2', viewMode: 'expanded' },
  },
  {
    id: 'example-1',
    type: 'exampleNode',
    position: { x: 1220, y: 190 },
    data: { title: 'Example output', color: '#10b981', viewMode: 'expanded' },
  },
];

const initialEdges = [
  { id: 'e-text1-mix', source: 'text-1', target: 'mixer-1', type: 'beam', data: { color: 'gradient' } },
  { id: 'e-image1-mix', source: 'image-1', target: 'mixer-1', type: 'beam', data: { color: 'gradient' } },
  { id: 'e-text2-mix', source: 'text-2', target: 'mixer-1', type: 'beam', data: { color: 'gradient' } },
  { id: 'e-mix-example', source: 'mixer-1', target: 'example-1', type: 'beam', data: { color: 'gradient' } },
];

function loadProject() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.nodes?.length) {
      return { ...saved, edges: (saved.edges || []).map((edge) => ({ ...edge, type: 'beam' })) };
    }
  } catch { /* use sample project */ }
  return { nodes: initialNodes, edges: initialEdges };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the image file'));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function imageUrlToNamedBlob(src, fileName = 'input.png') {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not read input image: ${fileName}`);
  const blob = await response.blob();
  return { blob, fileName, type: blob.type || 'image/png' };
}

async function saveImageBlobAs(blob, fileName = 'generated-image.png') {
  const safeName = String(fileName || 'generated-image.png').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '') || 'generated-image.png';
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: safeName.toLowerCase().endsWith('.png') ? safeName : `${safeName}.png`,
      types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = safeName.toLowerCase().endsWith('.png') ? safeName : `${safeName}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function callShopAIKeyImageEdit({ apiKey, prompt, images, model = SHOPAIKEY_IMAGE_MODEL, size = GEN_IMAGE_SIZES.landscape }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('size', size);
  form.append('quality', 'high');
  form.append('n', '1');
  images.forEach((image, index) => {
    form.append('image[]', image.blob, image.fileName || `input-${index + 1}.png`);
  });

  const response = await fetch(`${SHOPAIKEY_BASE_URL}/images/edits`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    body: form,
  });
  const rawBody = await response.text();
  let body = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    throw new Error(`ShopAIKey returned a non-JSON response: ${rawBody.slice(0, 220)}`);
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.message || rawBody || `HTTP ${response.status}`;
    throw new Error(`ShopAIKey request failed: ${message}`);
  }
  const firstImage = Array.isArray(body?.data) ? body.data[0] : null;
  if (firstImage?.b64_json) {
    const binary = atob(firstImage.b64_json);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: 'image/png' });
  }
  if (firstImage?.url) {
    const imageResponse = await fetch(firstImage.url);
    if (!imageResponse.ok) throw new Error('Generated image URL could not be downloaded');
    return imageResponse.blob();
  }
  throw new Error('ShopAIKey response did not include generated image data');
}

function getImageSize(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth || 320, height: image.naturalHeight || 240 });
    image.onerror = () => resolve({ width: 320, height: 240 });
    image.src = src;
  });
}

function findGraphInputDuplicates(nodes, graphEdges) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const collectLineage = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return new Set();
    const node = nodeById.get(nodeId);
    if (!node) return new Set();
    if (['textNode', 'carouselNode', 'imageNode', 'exampleNode', 'genNode'].includes(node.type)) return new Set([node.id]);
    const nextVisited = new Set(visited).add(nodeId);
    const lineage = new Set();
    graphEdges.filter((edge) => edge.target === nodeId).forEach((edge) => {
      collectLineage(edge.source, nextVisited).forEach((sourceId) => lineage.add(sourceId));
    });
    return lineage;
  };
  const duplicates = new Map();
  nodes.filter((node) => ['mixerNode', 'exampleNode', 'genNode', 'joinNode'].includes(node.type)).forEach((receiver) => {
    const seenSources = new Set();
    graphEdges.filter((edge) => edge.target === receiver.id).forEach((edge) => {
      collectLineage(edge.source).forEach((sourceId) => {
        const signature = `${receiver.id}:${sourceId}`;
        if (seenSources.has(sourceId)) duplicates.set(signature, { receiverId: receiver.id, sourceId });
        seenSources.add(sourceId);
      });
    });
  });
  return duplicates;
}

function removeDuplicateInputEdges(nodes, graphEdges) {
  const acceptedEdges = [];
  graphEdges.forEach((edge) => {
    const before = findGraphInputDuplicates(nodes, acceptedEdges);
    const after = findGraphInputDuplicates(nodes, [...acceptedEdges, edge]);
    const createsDuplicate = [...after.keys()].some((signature) => !before.has(signature));
    if (!createsDuplicate) acceptedEdges.push(edge);
  });
  return acceptedEdges;
}

function bridgeDeletedJoinPoints(nodes, graphEdges, deletedNodeIds) {
  const deletedIds = new Set(deletedNodeIds);
  const deletedJoinIds = new Set(nodes.filter((node) => deletedIds.has(node.id) && node.type === 'joinNode').map((node) => node.id));
  if (!deletedJoinIds.size) return graphEdges.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target));

  const incomingByTarget = new Map();
  const outgoingBySource = new Map();
  graphEdges.forEach((edge) => {
    if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
    if (!outgoingBySource.has(edge.source)) outgoingBySource.set(edge.source, []);
    incomingByTarget.get(edge.target).push(edge);
    outgoingBySource.get(edge.source).push(edge);
  });

  const collectUpstream = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return [];
    const nextVisited = new Set(visited).add(nodeId);
    return (incomingByTarget.get(nodeId) || []).flatMap((edge) => {
      if (deletedJoinIds.has(edge.source)) return collectUpstream(edge.source, nextVisited);
      if (deletedIds.has(edge.source)) return [];
      return [{ nodeId: edge.source, edge }];
    });
  };

  const collectDownstream = (nodeId, visited = new Set()) => {
    if (visited.has(nodeId)) return [];
    const nextVisited = new Set(visited).add(nodeId);
    return (outgoingBySource.get(nodeId) || []).flatMap((edge) => {
      if (deletedJoinIds.has(edge.target)) return collectDownstream(edge.target, nextVisited);
      if (deletedIds.has(edge.target)) return [];
      return [{ nodeId: edge.target, edge }];
    });
  };

  const remainingEdges = graphEdges.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target));
  const existingPairs = new Set(remainingEdges.map((edge) => `${edge.source}->${edge.target}`));
  const bridgedEdges = [];
  deletedJoinIds.forEach((joinId) => {
    const upstream = collectUpstream(joinId);
    const downstream = collectDownstream(joinId);
    upstream.forEach((input) => {
      downstream.forEach((output) => {
        if (input.nodeId === output.nodeId) return;
        const pairKey = `${input.nodeId}->${output.nodeId}`;
        if (existingPairs.has(pairKey)) return;
        existingPairs.add(pairKey);
        const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const inputColor = input.edge.data?.color || 'gradient';
        const outputColor = output.edge.data?.color || 'gradient';
        bridgedEdges.push({
          id: edgeId,
          source: input.nodeId,
          target: output.nodeId,
          sourceHandle: `out-${edgeId}`,
          targetHandle: `in-${edgeId}`,
          type: 'beam',
          data: { color: inputColor === outputColor ? inputColor : 'gradient' },
        });
      });
    });
  });

  return [...remainingEdges, ...bridgedEdges];
}

function compareByInputTitle(first, second) {
  const titleOrder = String(first?.title || '').localeCompare(String(second?.title || ''), undefined, { numeric: true, sensitivity: 'base' });
  if (titleOrder) return titleOrder;
  return String(first?.id || first?.sourceId || '').localeCompare(String(second?.id || second?.sourceId || ''), undefined, { numeric: true, sensitivity: 'base' });
}

const INPUT_KIND_PRIORITY = { example: 0, image: 1, text: 2 };

function sortInputTitles(items) {
  return [...items].sort((first, second) => {
    const kindOrder = (INPUT_KIND_PRIORITY[first.kind] ?? 99) - (INPUT_KIND_PRIORITY[second.kind] ?? 99);
    return kindOrder || compareByInputTitle(first, second);
  });
}

function createGraphSnapshot(nodes, edges) {
  const snapshot = {
    nodes: nodes.map(({ selected: _selected, dragging: _dragging, measured: _measured, ...node }) => ({ ...node, selected: false, data: { ...(node.data || {}) } })),
    edges: edges.map(({ selected: _selected, ...edge }) => ({ ...edge, selected: false, data: { ...(edge.data || {}) } })),
  };
  return { ...snapshot, signature: JSON.stringify(snapshot) };
}

const selectRenderedNodeLayout = (state) => Array.from(state.nodeLookup.values()).map((node) => ({
  id: node.id,
  x: node.internals.positionAbsolute.x,
  y: node.internals.positionAbsolute.y,
  width: node.measured.width || 0,
  height: node.measured.height || 0,
}));

const sameRenderedNodeLayout = (previous, next) => previous.length === next.length && previous.every((node, index) => {
  const candidate = next[index];
  return node.id === candidate.id && node.x === candidate.x && node.y === candidate.y && node.width === candidate.width && node.height === candidate.height;
});

const sameNoteNodeLayout = (previous, next) => previous?.x === next?.x
  && previous?.y === next?.y
  && previous?.width === next?.width
  && previous?.height === next?.height;

function setTextareaCaretFromPoint(textarea, clientX, clientY) {
  if (!textarea) return false;
  try {
    textarea.focus();
    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position?.offsetNode === textarea.firstChild || position?.offsetNode === textarea) {
        textarea.setSelectionRange(position.offset, position.offset);
        return true;
      }
    }
    if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(clientX, clientY);
      if (range?.startContainer === textarea.firstChild || range?.startContainer === textarea) {
        textarea.setSelectionRange(range.startOffset, range.startOffset);
        return true;
      }
    }
  } catch {
    // Browser caret APIs are best-effort only.
  }
  return false;
}

function textOffsetFromPoint(root, clientX, clientY) {
  try {
    const caret = typeof document.caretPositionFromPoint === 'function'
      ? document.caretPositionFromPoint(clientX, clientY)
      : null;
    const range = caret
      ? { startContainer: caret.offsetNode, startOffset: caret.offset }
      : typeof document.caretRangeFromPoint === 'function'
        ? document.caretRangeFromPoint(clientX, clientY)
        : null;
    const container = range?.startContainer;
    if (!root || !container || !root.contains(container)) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let textNode = walker.nextNode();
    while (textNode) {
      if (textNode === container) return offset + range.startOffset;
      offset += textNode.textContent?.length || 0;
      textNode = walker.nextNode();
    }
  } catch {
    // Best-effort browser caret lookup.
  }
  return null;
}

function NodeNoteControl({ nodeId, note = '', color = NODE_COLORS[0], className = '', selected = false }) {
  const t = useTranslation();
  const { updateNode } = useContext(NodeActionsContext);
  const [open, setOpen] = useState(false);
  const textareaRef = useRef(null);
  const hasNote = Boolean(note?.trim());
  const nodeLayout = useStore(useCallback((state) => {
    const node = state.nodeLookup.get(nodeId);
    if (!node) return null;
    return {
      x: node.internals.positionAbsolute.x,
      y: node.internals.positionAbsolute.y,
      width: node.measured.width || node.width || 0,
      height: node.measured.height || node.height || 0,
    };
  }, [nodeId]), sameNoteNodeLayout);
  const fitNoteHeight = useCallback((element = textareaRef.current) => {
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    if (open) fitNoteHeight();
  }, [fitNoteHeight, note, open]);

  const focusNoteAtPoint = useCallback((event) => {
    event.stopPropagation();
    requestAnimationFrame(() => {
      if (!setTextareaCaretFromPoint(textareaRef.current, event.clientX, event.clientY)) {
        textareaRef.current?.focus();
      }
    });
  }, []);

  if (!nodeId) return null;
  return (
    <div
      className={`node-note-control nodrag nopan ${open ? 'is-open' : ''} ${hasNote ? 'has-note' : ''} ${className}`}
      style={{ '--node-color': color }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="node-note-button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? t('Close note', 'ÄÃ³ng ghi chÃº') : t('Open note', 'Má»Ÿ ghi chÃº')}
        title={t('Note', 'Ghi chÃº')}
      >
        <MessageSquare size={14} />
      </button>
      {open && nodeLayout && (
        <ViewportPortal>
          <div
            className={`viewport-note-panel nodrag nopan nowheel ${selected ? 'is-foreground' : 'is-background'}`}
            style={{
              '--node-color': color,
              left: nodeLayout.x + nodeLayout.width + 48,
              top: nodeLayout.y + nodeLayout.height - 10,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={focusNoteAtPoint}
          >
            <textarea
              ref={textareaRef}
              className="node-note-textarea nowheel"
              value={note || ''}
              placeholder={t('Write a quick noteâ€¦', 'Nháº­p ghi chÃº nhanh...')}
              onChange={(event) => { updateNode(nodeId, { note: event.target.value }); fitNoteHeight(event.currentTarget); }}
              onDoubleClick={focusNoteAtPoint}
              autoFocus
            />
          </div>
        </ViewportPortal>
      )}
    </div>
  );
}

function NodeShell({ children, className = '', selected = false, color = NODE_COLORS[0], nodeId = null, note = '', ...props }) {
  return (
    <article className={`node-card ${className} ${selected ? 'is-selected' : ''}`} style={{ '--node-color': color }} {...props}>
      {nodeId && <NodeNoteControl nodeId={nodeId} note={note} color={color} selected={selected} />}
      {children}
    </article>
  );
}

function PortStack({ ports = [], type, position, color, compact = false }) {
  const t = useTranslation();
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();
  const uniquePorts = ports.filter((port, index, all) => all.findIndex((item) => item.id === port.id) === index);
  const items = uniquePorts.length ? uniquePorts : [{ id: `${type}-new`, color, idle: true }];
  const sizes = items.map((port) => compact ? (port.idle ? 14 : 14) : 18);
  const gap = compact ? 3 : 24;
  const totalHeight = sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, items.length - 1) * gap;
  let cursor = -totalHeight / 2;
  const offsets = sizes.map((size) => {
    const center = cursor + size / 2;
    cursor += size + gap;
    return center;
  });
  const portSignature = items.map((port) => `${port.id}:${port.color || ''}`).join('|');

  useLayoutEffect(() => {
    if (nodeId) updateNodeInternals(nodeId);
  }, [nodeId, portSignature, updateNodeInternals]);

  return items.map((port, index) => {
    const offset = `calc(50% + ${offsets[index]}px)`;
    return (
      <Handle
        key={port.id}
        id={port.id}
        type={type}
        position={position}
        className={`port ${position === Position.Left ? 'port-input' : 'port-output'} ${port.idle ? 'port-idle' : 'port-connected'}`}
        style={{ top: offset, '--port-color': port.color || color }}
        aria-label={type === 'target' ? t('Connector input', 'Äáº§u nháº­n connector') : t('Connector output', 'Äáº§u ra connector')}
        title={type === 'target' ? t('Input', 'Äáº§u nháº­n') : t('Drag to connect', 'KÃ©o Ä‘á»ƒ táº¡o káº¿t ná»‘i')}
      />
    );
  });
}

function NodeHeader({ title, nodeId, viewMode = 'expanded', color = NODE_COLORS[0], hideTitle = false, topContent = null }) {
  const t = useTranslation();
  const { updateNode } = useContext(NodeActionsContext);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title || '');
  const actionsRef = useRef(null);
  const titleRef = useRef(null);
  const focusedTitleRef = useRef(false);
  const draftTitleRef = useRef(title || '');
  const latestTitleRef = useRef(title || '');

  useEffect(() => {
    latestTitleRef.current = title || '';
    if (!focusedTitleRef.current) {
      draftTitleRef.current = title || '';
      setDraftTitle(title || '');
    }
  }, [title]);

  const fitTitleHeight = useCallback((element = titleRef.current) => {
    if (!element || hideTitle) return;
    const isFocused = document.activeElement === element;
    const selectionStart = element.selectionStart;
    const selectionEnd = element.selectionEnd;
    const scrollTop = element.scrollTop;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
    element.scrollTop = scrollTop;
    if (isFocused && Number.isFinite(selectionStart) && Number.isFinite(selectionEnd)) {
      element.setSelectionRange(selectionStart, selectionEnd);
    }
  }, [hideTitle]);

  const commitTitle = useCallback(() => {
    const nextTitle = draftTitleRef.current;
    if (nextTitle !== latestTitleRef.current) updateNode(nodeId, { title: nextTitle });
  }, [nodeId, updateNode]);

  useLayoutEffect(() => {
    fitTitleHeight();
  }, [draftTitle, fitTitleHeight]);

  useEffect(() => {
    if (!focusedTitleRef.current) return undefined;
    const syncTimer = window.setTimeout(commitTitle, 250);
    return () => window.clearTimeout(syncTimer);
  }, [commitTitle, draftTitle]);

  useEffect(() => {
    if (!paletteOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (!actionsRef.current?.contains(event.target)) setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [paletteOpen]);
  return (
    <header className="node-header">
      {!hideTitle && (
        <div className={`node-floating-title nodrag ${topContent ? 'has-top-content' : ''}`}>
          {topContent}
          <div className="node-title-line">
            <textarea
              ref={titleRef}
              className="node-title"
              value={draftTitle}
              aria-label={t('Node name')}
              onFocus={() => { focusedTitleRef.current = true; }}
              onChange={(event) => {
                draftTitleRef.current = event.target.value;
                setDraftTitle(event.target.value);
                fitTitleHeight(event.currentTarget);
              }}
              onBlur={() => {
                focusedTitleRef.current = false;
                commitTitle();
              }}
              rows={1}
            />
          </div>
        </div>
      )}
      <div ref={actionsRef} className="node-actions nodrag" onMouseLeave={() => setPaletteOpen(false)}>
        <div className="node-color-picker">
          <button className="color-trigger" onClick={() => setPaletteOpen((value) => !value)} aria-label={t('Choose node color', 'Chá»n mÃ u node')} title={t('Choose node color', 'Chá»n mÃ u node')}><Palette size={14} /></button>
          {paletteOpen && (
            <div className="node-color-popover" aria-label={t('Node color palette', 'Báº£ng mÃ u node')}>
              {NODE_COLORS.map((item) => <button key={item} className={item === color ? 'active' : ''} style={{ '--swatch': item }} onClick={() => { updateNode(nodeId, { color: item }); setPaletteOpen(false); }} aria-label={t(`Node color ${item}`, `MÃ u node ${item}`)} />)}
            </div>
          )}
        </div>
        <button
          className="view-mode-toggle"
          onClick={() => updateNode(nodeId, { viewMode: viewMode === 'expanded' ? 'compact' : 'expanded' })}
          aria-label={viewMode === 'expanded' ? t('Compact view', 'Hiá»ƒn thá»‹ rÃºt gá»n') : t('Expanded view', 'Hiá»ƒn thá»‹ Ä‘áº§y Ä‘á»§')}
          title={viewMode === 'expanded' ? t('Compact view', 'Hiá»ƒn thá»‹ rÃºt gá»n') : t('Expanded view', 'Hiá»ƒn thá»‹ Ä‘áº§y Ä‘á»§')}
        >{viewMode === 'expanded' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
      </div>
    </header>
  );
}

function CopyButton({ value, kind = 'text' }) {
  const t = useTranslation();
  const { copyResource } = useContext(NodeActionsContext);
  return (
    <button
      className="copy-button nodrag"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); copyResource(value, kind); }}
      aria-label={kind === 'image' ? t('Copy image', 'Copy áº£nh') : t('Copy text', 'Copy text')}
      title={kind === 'image' ? t('Copy image', 'Copy áº£nh') : t('Copy text', 'Copy text')}
    >
      <Copy size={13} />
    </button>
  );
}

const TextNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { updateNode } = useContext(NodeActionsContext);
  const viewMode = data.viewMode || 'expanded';
  const color = data.color || '#3b82f6';
  const editorRef = useRef(null);
  const pendingCaretOffsetRef = useRef(null);
  const [editing, setEditing] = useState(false);

  useLayoutEffect(() => {
    if (!editorRef.current) return;
    if (viewMode === 'expanded') {
      editorRef.current.style.height = 'auto';
      editorRef.current.style.height = `${editorRef.current.scrollHeight}px`;
    } else {
      editorRef.current.style.height = '';
    }
  }, [data.content, viewMode, editing]);

  const beginEditing = (event) => {
    event.stopPropagation();
    pendingCaretOffsetRef.current = textOffsetFromPoint(event.currentTarget, event.clientX, event.clientY);
    setEditing(true);
    requestAnimationFrame(() => {
      const textarea = editorRef.current;
      const offset = pendingCaretOffsetRef.current;
      pendingCaretOffsetRef.current = null;
      textarea?.focus();
      if (textarea && Number.isFinite(offset)) {
        const clampedOffset = Math.max(0, Math.min(textarea.value.length, offset));
        textarea.setSelectionRange(clampedOffset, clampedOffset);
      }
    });
  };

  return (
    <NodeShell selected={selected} color={color} nodeId={id} note={data.note} className={`text-card mode-${viewMode}`}>
      <NodeHeader icon={Type} eyebrow="TEXT" title={data.title} nodeId={id} accent="blue" viewMode={viewMode} color={color} />
      <div className="node-body text-node-content">
        {editing ? (
          <textarea
            ref={editorRef}
            className="text-editor is-editing nodrag nowheel"
            value={data.content}
            placeholder={t('Enter your contentâ€¦', 'Nháº­p ná»™i dung cá»§a báº¡n...')}
            onChange={(event) => updateNode(id, { content: event.target.value })}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <div ref={editorRef} className="text-editor text-display nowheel" onDoubleClick={beginEditing}>
            {data.content || <span className="text-placeholder">{t('Double-click to enter contentâ€¦', 'Double-click Ä‘á»ƒ nháº­p ná»™i dung...')}</span>}
          </div>
        )}
      </div>
      <span className="node-external-meta">{data.content.length} {t('characters', 'kÃ½ tá»±')}</span>
      <div className="node-border-copy"><CopyButton value={data.content} /></div>
      <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
    </NodeShell>
  );
});

const CarouselNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { uploadCarouselImage, updateNode } = useContext(NodeActionsContext);
  const editorRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const viewMode = data.viewMode || 'expanded';
  const color = data.color || '#06b6d4';
  const images = Array.isArray(data.images) ? data.images : [];
  const content = data.content || '';
  const uploadCardImage = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadCarouselImage(id, file);
    event.target.value = '';
  };
  const removeCard = (cardId) => updateNode(id, { images: images.filter((item) => item.id !== cardId) });
  useEffect(() => {
    if (images.length <= 1) return undefined;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % images.length), 5200);
    return () => window.clearInterval(timer);
  }, [images.length]);
  useEffect(() => {
    if (activeIndex >= images.length) setActiveIndex(0);
  }, [activeIndex, images.length]);
  const showcaseSlots = [-1, 0, 1, 2];
  const showcaseCards = showcaseSlots.map((offset) => {
    const position = offset === 0 ? 'center' : offset === -1 ? 'left' : offset === 1 ? 'right' : 'back';
    if (!images.length) return { id: `empty-${offset}`, empty: true, position };
    if (images.length === 1 && offset !== 0) return { id: `empty-${offset}`, empty: true, position };
    const index = (activeIndex + offset + images.length) % images.length;
    return { ...images[index], position };
  });
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (viewMode === 'expanded') {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
    } else {
      editor.style.height = '';
    }
  }, [content, viewMode]);
  return (
    <NodeShell selected={selected} color={color} nodeId={id} note={data.note} className={`carousel-card mode-${viewMode}`}>
      <NodeHeader
        title={data.title}
        nodeId={id}
        viewMode={viewMode}
        color={color}
        topContent={(
          <div className={`carousel-showcase ${images.length > 1 ? 'is-cycling' : ''} ${images.length > 3 ? 'has-back-card' : ''}`}>
            {showcaseCards.map((card, index) => (
              card.empty ? (
                <label className={`carousel-showcase-card is-empty is-${card.position} nodrag`} key={`${card.id}-${index}`} title={t('Add illustration image')}>
                  <Upload size={card.position === 'center' ? 18 : 14} />
                  <input type="file" accept="image/*" onChange={uploadCardImage} />
                </label>
              ) : (
                <div className={`carousel-showcase-card is-${card.position}`} key={`${card.id}-${card.position}`}>
                  <img src={card.image} alt={card.fileName || data.title || t('Carousel illustration')} draggable="false" />
                  <button className="carousel-card-remove nodrag" onClick={(event) => { event.stopPropagation(); removeCard(card.id); }} aria-label={t('Remove image')} title={t('Remove image')}><X size={13} /></button>
                </div>
              )
            ))}
          </div>
        )}
      />
      <div className="carousel-content">
        <textarea
          ref={editorRef}
          className="carousel-text-editor nodrag nowheel"
          value={content}
          placeholder={'{\n  "prompt": "Write JSON text here"\n}'}
          onChange={(event) => updateNode(id, { content: event.target.value })}
        />
      </div>
      <span className="node-external-meta">{content.length} {t('characters')}</span>
      <div className="node-border-copy"><CopyButton value={content} /></div>
      <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
    </NodeShell>
  );
});

const ImageNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { uploadImage, showToast, revealAsset, updateNode } = useContext(NodeActionsContext);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [dimensions, setDimensions] = useState({ width: data.imageWidth || 0, height: data.imageHeight || 0 });
  const [lightboxView, setLightboxView] = useState({ zoom: 1, x: 0, y: 0, panning: false });
  const [lightboxFit, setLightboxFit] = useState({ width: 0, height: 0 });
  const lightboxStageRef = useRef(null);
  const lightboxDragRef = useRef(null);
  const viewMode = data.viewMode || 'expanded';
  const color = data.color || '#f59e0b';
  const isTallPortrait = dimensions.width > 0 && dimensions.height / dimensions.width > 1.45;
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast(t('Please choose a valid image file', 'Vui lÃ²ng chá»n Ä‘Ãºng Ä‘á»‹nh dáº¡ng áº£nh'), 'error');
    setUploading(true);
    try {
      await uploadImage(id, file);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };
  const onDropImage = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setDragOver(false);
    const file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/'));
    if (!file) return showToast(t('Drop a valid image file into the Image Node', 'HÃ£y tháº£ Ä‘Ãºng file áº£nh vÃ o Image Node'), 'error');
    setUploading(true);
    try { await uploadImage(id, file); }
    finally { setUploading(false); }
  };
  useEffect(() => {
    if (!previewOpen) return undefined;
    setLightboxView({ zoom: 1, x: 0, y: 0, panning: false });
    const onKeyDown = (event) => { if (event.key === 'Escape') setPreviewOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [previewOpen]);
  useLayoutEffect(() => {
    const stage = lightboxStageRef.current;
    if (!previewOpen || !stage || !dimensions.width || !dimensions.height) return undefined;
    const updateFit = () => {
      const viewportWidth = Math.max(1, stage.clientWidth - 32);
      const viewportHeight = Math.max(1, stage.clientHeight - 32);
      const scale = Math.min(1, viewportWidth / dimensions.width, viewportHeight / dimensions.height);
      const next = { width: Math.floor(dimensions.width * scale), height: Math.floor(dimensions.height * scale) };
      setLightboxFit((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [dimensions.height, dimensions.width, previewOpen]);
  const lightboxMetrics = useCallback((zoom = lightboxView.zoom) => {
    const stage = lightboxStageRef.current;
    if (!stage || !dimensions.width || !dimensions.height) return null;
    const rect = stage.getBoundingClientRect();
    const viewportWidth = Math.max(1, rect.width - 32);
    const viewportHeight = Math.max(1, rect.height - 32);
    const fitScale = Math.min(1, viewportWidth / dimensions.width, viewportHeight / dimensions.height);
    const maxZoom = Math.min(12, Math.max(1, 1 / fitScale));
    return {
      rect,
      fitScale,
      maxZoom,
      maxX: Math.max(0, (dimensions.width * fitScale * zoom - viewportWidth) / 2),
      maxY: Math.max(0, (dimensions.height * fitScale * zoom - viewportHeight) / 2),
    };
  }, [dimensions.height, dimensions.width, lightboxView.zoom]);
  const clampLightboxPan = useCallback((x, y, zoom) => {
    const metrics = lightboxMetrics(zoom);
    if (!metrics) return { x: 0, y: 0 };
    return { x: Math.max(-metrics.maxX, Math.min(metrics.maxX, x)), y: Math.max(-metrics.maxY, Math.min(metrics.maxY, y)) };
  }, [lightboxMetrics]);
  const zoomLightbox = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const metrics = lightboxMetrics();
    if (!metrics || metrics.maxZoom <= 1) return;
    const nextZoom = Math.max(1, Math.min(metrics.maxZoom, lightboxView.zoom * Math.exp(-event.deltaY * 0.0018)));
    if (Math.abs(nextZoom - lightboxView.zoom) < 0.001) return;
    const pointerX = event.clientX - (metrics.rect.left + metrics.rect.width / 2);
    const pointerY = event.clientY - (metrics.rect.top + metrics.rect.height / 2);
    const ratio = nextZoom / lightboxView.zoom;
    const nextPan = clampLightboxPan(pointerX - (pointerX - lightboxView.x) * ratio, pointerY - (pointerY - lightboxView.y) * ratio, nextZoom);
    setLightboxView({ zoom: nextZoom, ...nextPan, panning: false });
  }, [clampLightboxPan, lightboxMetrics, lightboxView]);
  const beginLightboxPan = useCallback((event) => {
    if (event.button !== 0 || lightboxView.zoom <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    lightboxDragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: lightboxView.x, y: lightboxView.y };
    setLightboxView((current) => ({ ...current, panning: true }));
  }, [lightboxView]);
  const moveLightboxPan = useCallback((event) => {
    const drag = lightboxDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextPan = clampLightboxPan(drag.x + event.clientX - drag.clientX, drag.y + event.clientY - drag.clientY, lightboxView.zoom);
    setLightboxView((current) => ({ ...current, ...nextPan, panning: true }));
  }, [clampLightboxPan, lightboxView.zoom]);
  const finishLightboxPan = useCallback((event) => {
    if (lightboxDragRef.current?.pointerId !== event.pointerId) return;
    lightboxDragRef.current = null;
    setLightboxView((current) => ({ ...current, panning: false }));
  }, []);
  return (
    <>
      <NodeShell
        selected={selected}
        color={color}
        nodeId={id}
        note={data.note}
        className={`image-card mode-${viewMode} ${dragOver ? 'is-drag-over' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(true); }}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }}
        onDrop={onDropImage}
      >
        <NodeHeader icon={ImageIcon} title={data.title} nodeId={id} viewMode={viewMode} color={color} />
        <div className="node-body image-node-content">
          {data.image ? (
            <div className={`image-preview ${isTallPortrait ? 'is-height-limited' : ''}`} onDoubleClick={(event) => { event.stopPropagation(); setPreviewOpen(true); }}>
              <img src={data.image} alt={data.title || t('Image resource', 'TÃ i nguyÃªn áº£nh')} draggable="false" onLoad={(event) => { const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setDimensions(next); if (next.width !== data.imageWidth || next.height !== data.imageHeight) updateNode(id, { imageWidth: next.width, imageHeight: next.height }); }} />
              {!!dimensions.width && <span className="image-dimensions">{dimensions.width} × {dimensions.height}</span>}
              {selected && <div className="image-selection-gradient" />}
              {selected && <label className="replace-image nodrag" title={t('Replace image', 'Äá»•i áº£nh')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label>}
            </div>
          ) : (
            <div className="empty-image-surface"><label className="replace-image compact-upload-button nodrag" title={uploading ? t('Savingâ€¦', 'Äang sao lÆ°u...') : t('Upload image', 'Táº£i áº£nh lÃªn')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label></div>
          )}
        </div>
        <span className="node-external-meta file-name">{data.fileName || t('No image', 'ChÆ°a cÃ³ áº£nh')}</span>
        {data.image && <div className="node-border-copy"><CopyButton value={data.image} kind="image" /></div>}
        <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
      </NodeShell>
      {previewOpen && createPortal(
        <div className="image-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}>
          <section className="image-lightbox-panel" role="dialog" aria-modal="true" aria-label={t('Large image preview', 'Xem áº£nh kÃ­ch thÆ°á»›c lá»›n')}>
            <header><span><ImageIcon size={16} /><strong>{data.fileName || data.title}</strong></span><button onClick={() => setPreviewOpen(false)} aria-label={t('Close', 'ÄÃ³ng')}><X size={18} /></button></header>
            <div
              ref={lightboxStageRef}
              className={`image-lightbox-stage ${lightboxView.zoom > 1 ? 'is-zoomed' : ''} ${lightboxView.panning ? 'is-panning' : ''}`}
              onWheel={zoomLightbox}
              onPointerDown={beginLightboxPan}
              onPointerMove={moveLightboxPan}
              onPointerUp={finishLightboxPan}
              onPointerCancel={finishLightboxPan}
              onDoubleClick={() => setLightboxView({ zoom: 1, x: 0, y: 0, panning: false })}
            ><img src={data.image} alt={data.title || data.fileName} draggable="false" style={{ width: lightboxFit.width || undefined, height: lightboxFit.height || undefined, maxWidth: lightboxFit.width ? 'none' : undefined, maxHeight: lightboxFit.height ? 'none' : undefined, transform: `translate(${lightboxView.x}px, ${lightboxView.y}px) scale(${lightboxView.zoom})` }} /></div>
            <footer><span>{dimensions.width || '—'} × {dimensions.height || '—'} px · {t('Zoom')} {Math.round(lightboxView.zoom * 100)}%{lightboxView.zoom > 1 ? ` · ${t('drag to pan')}` : ''}</span><button onClick={() => revealAsset(data.assetFile)}><FolderOpen size={15} />{t('Open containing folder', 'Mở folder chứa ảnh')}</button></footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
});

function ExampleImageLightbox({ open, onClose, image, title, fileName, assetFile, dimensions, revealAsset }) {
  const t = useTranslation();
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0, panning: false });
  const [fit, setFit] = useState({ width: 0, height: 0 });
  const stageRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setView({ zoom: 1, x: 0, y: 0, panning: false });
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage || !dimensions.width || !dimensions.height) return undefined;
    const updateFit = () => {
      const viewportWidth = Math.max(1, stage.clientWidth - 32);
      const viewportHeight = Math.max(1, stage.clientHeight - 32);
      const scale = Math.min(1, viewportWidth / dimensions.width, viewportHeight / dimensions.height);
      const next = { width: Math.floor(dimensions.width * scale), height: Math.floor(dimensions.height * scale) };
      setFit((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [dimensions.height, dimensions.width, open]);

  const metrics = useCallback((zoom = view.zoom) => {
    const stage = stageRef.current;
    if (!stage || !dimensions.width || !dimensions.height) return null;
    const rect = stage.getBoundingClientRect();
    const viewportWidth = Math.max(1, rect.width - 32);
    const viewportHeight = Math.max(1, rect.height - 32);
    const fitScale = Math.min(1, viewportWidth / dimensions.width, viewportHeight / dimensions.height);
    const maxZoom = Math.min(12, Math.max(1, 1 / fitScale));
    return {
      rect,
      maxZoom,
      maxX: Math.max(0, (dimensions.width * fitScale * zoom - viewportWidth) / 2),
      maxY: Math.max(0, (dimensions.height * fitScale * zoom - viewportHeight) / 2),
    };
  }, [dimensions.height, dimensions.width, view.zoom]);
  const clampPan = useCallback((x, y, zoom) => {
    const limits = metrics(zoom);
    if (!limits) return { x: 0, y: 0 };
    return { x: Math.max(-limits.maxX, Math.min(limits.maxX, x)), y: Math.max(-limits.maxY, Math.min(limits.maxY, y)) };
  }, [metrics]);
  const onWheel = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const limits = metrics();
    if (!limits || limits.maxZoom <= 1) return;
    const nextZoom = Math.max(1, Math.min(limits.maxZoom, view.zoom * Math.exp(-event.deltaY * 0.0018)));
    if (Math.abs(nextZoom - view.zoom) < 0.001) return;
    const pointerX = event.clientX - (limits.rect.left + limits.rect.width / 2);
    const pointerY = event.clientY - (limits.rect.top + limits.rect.height / 2);
    const ratio = nextZoom / view.zoom;
    const nextPan = clampPan(pointerX - (pointerX - view.x) * ratio, pointerY - (pointerY - view.y) * ratio, nextZoom);
    setView({ zoom: nextZoom, ...nextPan, panning: false });
  }, [clampPan, metrics, view]);
  const beginPan = useCallback((event) => {
    if (event.button !== 0 || view.zoom <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y };
    setView((current) => ({ ...current, panning: true }));
  }, [view]);
  const movePan = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextPan = clampPan(drag.x + event.clientX - drag.clientX, drag.y + event.clientY - drag.clientY, view.zoom);
    setView((current) => ({ ...current, ...nextPan, panning: true }));
  }, [clampPan, view.zoom]);
  const finishPan = useCallback((event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setView((current) => ({ ...current, panning: false }));
  }, []);

  if (!open) return null;
  return createPortal(
    <div className="image-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="image-lightbox-panel" role="dialog" aria-modal="true" aria-label={t('Large image preview')}>
        <header><span><BookOpenCheck size={16} /><strong>{fileName || title}</strong></span><button onClick={onClose} aria-label={t('Close')}><X size={18} /></button></header>
        <div ref={stageRef} className={`image-lightbox-stage ${view.zoom > 1 ? 'is-zoomed' : ''} ${view.panning ? 'is-panning' : ''}`} onWheel={onWheel} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={finishPan} onPointerCancel={finishPan} onDoubleClick={() => setView({ zoom: 1, x: 0, y: 0, panning: false })}>
          <img src={image} alt={title || fileName} draggable="false" style={{ width: fit.width || undefined, height: fit.height || undefined, maxWidth: fit.width ? 'none' : undefined, maxHeight: fit.height ? 'none' : undefined, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />
        </div>
        <footer><span>{dimensions.width || '—'} × {dimensions.height || '—'} px · {t('Zoom')} {Math.round(view.zoom * 100)}%{view.zoom > 1 ? ` · ${t('drag to pan')}` : ''}</span>{assetFile && <button onClick={() => revealAsset(assetFile)}><FolderOpen size={15} />{t('Open containing folder', 'Mở folder chứa ảnh')}</button>}</footer>
      </section>
    </div>,
    document.body,
  );
}

const MixerNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { focusNode, updateNode } = useContext(NodeActionsContext);
  const resources = data.resources || [];
  const viewMode = data.viewMode || 'expanded';
  const imageResources = resources.filter((resource) => resource.kind === 'image');
  const textResources = resources.filter((resource) => resource.kind !== 'image');
  const [imageOrientations, setImageOrientations] = useState({});
  const [segmentMenu, setSegmentMenu] = useState(null);
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [editingDraft, setEditingDraft] = useState('');
  const segmentEditorRef = useRef(null);
  const imageCount = imageResources.length;
  const textResource = resources.find((resource) => resource.kind === 'text');
  const color = data.color || '#7c6cf2';
  useEffect(() => {
    if (selected) return undefined;
    setSegmentMenu(null);
    setEditingSegmentId(null);
    return undefined;
  }, [selected]);
  useEffect(() => {
    if (!segmentMenu) return undefined;
    const closeMenu = (event) => {
      if (event.target?.closest?.('.mixer-segment-menu')) return;
      setSegmentMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSegmentMenu(null);
    };
    document.addEventListener('pointerdown', closeMenu, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeMenu, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [segmentMenu]);
  const fitSegmentEditor = useCallback((element = segmentEditorRef.current) => {
    if (!element) return;
    const selectionStart = element.selectionStart;
    const selectionEnd = element.selectionEnd;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
    if (document.activeElement === element && Number.isFinite(selectionStart) && Number.isFinite(selectionEnd)) {
      element.setSelectionRange(selectionStart, selectionEnd);
    }
  }, []);
  useLayoutEffect(() => {
    if (!editingSegmentId) return;
    const editor = segmentEditorRef.current;
    if (!editor) return;
    fitSegmentEditor(editor);
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }, [editingSegmentId, fitSegmentEditor]);
  const isPortraitImage = useCallback((resource) => imageOrientations[resource.sourceId]
    ? imageOrientations[resource.sourceId] === 'portrait'
    : Number(resource.imageHeight || 0) > Number(resource.imageWidth || 0), [imageOrientations]);
  const portraitCount = imageResources.filter(isPortraitImage).length;
  const registerImageOrientation = useCallback((resource, element) => {
    const orientation = element.naturalHeight > element.naturalWidth ? 'portrait' : 'landscape';
    setImageOrientations((current) => current[resource.sourceId] === orientation
      ? current
      : { ...current, [resource.sourceId]: orientation });
  }, []);
  const renderImageResource = (resource, index) => {
    const usePortraitGrid = portraitCount > 1 && isPortraitImage(resource);
    return (
      <section className={`resource-block image-resource-block ${usePortraitGrid ? 'is-portrait-grid' : 'is-full-row'}`} key={`${resource.sourceId}-${index}`}>
        <div className="mixer-image-wrap">
          <img className="mixer-image" src={resource.value} alt={resource.title} draggable="false" onLoad={(event) => registerImageOrientation(resource, event.currentTarget)} />
          <button className={`mixer-image-title-link nodrag ${(resource.title || '').length > 25 ? 'is-long' : ''}`} style={{ color: resource.sourceColor || color }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(resource.sourceId); }} aria-label={t(`Go to ${resource.title}`, `Äi tá»›i ${resource.title}`)} title={resource.title}><span>{resource.title || t('Untitled Image', 'áº¢nh chÆ°a Ä‘áº·t tÃªn')}</span></button>
          <div className="mixer-image-copy"><CopyButton value={resource.value} kind="image" /></div>
        </div>
      </section>
    );
  };
  const openSegmentMenu = useCallback((event, segment) => {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    setSegmentMenu({
      x: event.clientX,
      y: event.clientY,
      sourceId: segment.sourceId,
      title: segment.title || t('Untitled Text', 'Text chÆ°a Ä‘áº·t tÃªn'),
      value: segment.value || '',
    });
  }, [selected, t]);
  const startEditingSegment = useCallback(() => {
    if (!segmentMenu?.sourceId) return;
    setEditingSegmentId(segmentMenu.sourceId);
    setEditingDraft(segmentMenu.value || '');
    setSegmentMenu(null);
  }, [segmentMenu]);
  const renderTextSegment = (segment, segmentIndex) => {
    const editing = editingSegmentId === segment.sourceId;
    return (
      <section
        className={`mixer-text-segment tone-${segmentIndex % 2 ? 'b' : 'a'} ${editing ? 'is-editing' : ''}`}
        key={segment.sourceId}
        onContextMenu={(event) => openSegmentMenu(event, segment)}
      >
        <div className="mixer-segment-source">
          <button className="mixer-segment-title-link nodrag" style={{ color: segment.color || color }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(segment.sourceId); }} aria-label={t(`Go to ${segment.title || 'text node'}`, `Äi tá»›i ${segment.title || 'node text'}`)} title={t('Go to source node', 'Äi tá»›i node nguá»“n')}>{segment.title || t('Untitled Text', 'Text chÆ°a Ä‘áº·t tÃªn')}</button>
        </div>
        {editing ? (
          <textarea
            ref={segmentEditorRef}
            className="mixer-segment-editor nodrag nopan nowheel"
            value={editingDraft}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              setEditingDraft(event.target.value);
              updateNode(segment.sourceId, { content: event.target.value });
              fitSegmentEditor(event.currentTarget);
            }}
            onBlur={() => setEditingSegmentId(null)}
            aria-label={t(`Edit ${segment.title || 'text node'}`)}
          />
        ) : (
          <p>{segment.value}</p>
        )}
      </section>
    );
  };
  return (
    <NodeShell selected={selected} color={color} nodeId={id} note={data.note} className={`mixer-card mode-${viewMode}`}>
      <div className="mixer-port-anchor">
        <PortStack ports={data.inputPorts} type="target" position={Position.Left} color={color} />
        <NodeHeader icon={Merge} title={data.title} nodeId={id} viewMode={viewMode} color={color} hideTitle />
        <div className="mixer-content nowheel">
          {!resources.length && (
            <div className="empty-mixer"><Zap size={23} /><strong>{t('Connect resources', 'Káº¿t ná»‘i tÃ i nguyÃªn')}</strong><span>{t('Drag a connector from Text or Image into the left port.', 'KÃ©o dÃ¢y tá»« Text hoáº·c Image vÃ o cá»•ng bÃªn trÃ¡i.')}</span></div>
          )}
          {!!imageResources.length && <div className={`mixer-image-grid ${portraitCount > 1 ? 'has-portrait-pairs' : ''}`}>{imageResources.map(renderImageResource)}</div>}
          {textResources.map((resource, index) => (
            <section className="resource-block" key={`${resource.sourceId}-${index}`}>
              <div className="resource-meta"><span className={`resource-kind ${resource.kind}`}>{resource.title}</span><CopyButton value={resource.value} kind={resource.kind} /></div>
              {resource.segments?.length
                ? <div className="mixer-text mixer-text-group">{resource.segments.map(renderTextSegment)}</div>
                : <p className="mixer-text">{resource.value || <em>{t('Empty content', 'Ná»™i dung trá»‘ng')}</em>}</p>}
            </section>
          ))}
        </div>
        <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
      </div>
      <div className="mixer-footer-note is-outside">
        <span>{imageCount} {t('images')}</span><span>{textResource ? `${textResource.count} text · ${t('merged')}` : '0 text'}</span>
      </div>
      {segmentMenu && createPortal(
        <div
          className="canvas-context-menu mixer-segment-menu"
          style={{ left: segmentMenu.x, top: segmentMenu.y }}
          role="menu"
          aria-label={t('Text block options', 'TÃ¹y chá»n block text')}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="context-menu-title"><span>{segmentMenu.title}</span><kbd>Right click</kbd></div>
          <button role="menuitem" onClick={startEditingSegment}><span className="menu-icon blue"><Pencil size={15} /></span><span>{t('Edit this text block', 'Sá»­a block text nÃ y')}</span><ArrowRight size={13} /></button>
        </div>,
        document.body,
      )}
    </NodeShell>
  );
});

const ExampleNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { uploadImage, showToast, focusNode, updateNode, revealAsset } = useContext(NodeActionsContext);
  const [uploading, setUploading] = useState(false);
  const [editingText, setEditingText] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: data.imageWidth || 0, height: data.imageHeight || 0 });
  const textEditorRef = useRef(null);
  const updateNodeInternals = useUpdateNodeInternals();
  const viewMode = data.viewMode || 'expanded';
  const inputTitles = data.inputTitles || [];
  const inputImageCount = inputTitles.filter((item) => item.kind === 'image' || item.kind === 'example').length;
  const inputTextCount = inputTitles.filter((item) => item.kind === 'text').length;
  const inputTitleListText = inputTitles.map((item) => item.title || t('Untitled node', 'Node chÆ°a Ä‘áº·t tÃªn')).join('\n');
  const color = data.color || '#10b981';
  const exampleText = data.content || '';
  const exampleMode = data.exampleMode || (data.image ? 'image' : exampleText ? 'text' : '');
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast(t('Please choose a valid image file', 'Vui lÃ²ng chá»n Ä‘Ãºng Ä‘á»‹nh dáº¡ng áº£nh'), 'error');
    setUploading(true);
    try {
      await uploadImage(id, file);
      updateNode(id, { exampleMode: 'image', content: null });
    }
    finally { setUploading(false); event.target.value = ''; }
  };
  useLayoutEffect(() => {
    if (!textEditorRef.current || viewMode !== 'expanded') return;
    textEditorRef.current.style.height = 'auto';
    textEditorRef.current.style.height = `${textEditorRef.current.scrollHeight}px`;
  }, [editingText, exampleText, viewMode]);
  useLayoutEffect(() => {
    requestAnimationFrame(() => updateNodeInternals(id));
  }, [id, inputTitles.length, inputTitleListText, exampleMode, exampleText, data.image, viewMode, updateNodeInternals]);
  const beginTextEditing = (event) => {
    event?.stopPropagation();
    if (!exampleMode) updateNode(id, { exampleMode: 'text', image: '', assetFile: '', fileName: '', imageWidth: 0, imageHeight: 0 });
    setEditingText(true);
    requestAnimationFrame(() => textEditorRef.current?.focus());
  };
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  return (
    <>
    <NodeShell selected={selected} color={color} nodeId={id} note={data.note} className={`example-card mode-${viewMode}`}>
      <PortStack ports={data.inputPorts} type="target" position={Position.Left} color={color} />
      <NodeHeader icon={BookOpenCheck} title={data.title} nodeId={id} viewMode={viewMode} color={color} />
      <div className="example-content nowheel">
        {!exampleMode && (
          <div className="example-content-actions nodrag">
            <label title={uploading ? t('Saving…') : t('Upload example image')}>
              <Upload size={13} /><span>{t('Upload Image')}</span>
              <input type="file" accept="image/*" onChange={onFile} disabled={uploading} />
            </label>
            <button type="button" onClick={beginTextEditing} title={t('Write example text')}>
              <FileText size={13} /><span>{t('Write Text')}</span>
            </button>
          </div>
        )}
        {exampleMode === 'image' && data.image ? (
          <div className="image-preview example-preview" onDoubleClick={(event) => { event.stopPropagation(); setPreviewOpen(true); }}>
            <img src={data.image} alt={data.title || t('Example image', 'áº¢nh example')} draggable="false" onLoad={(event) => { const imageWidth = event.currentTarget.naturalWidth; const imageHeight = event.currentTarget.naturalHeight; setImageDimensions({ width: imageWidth, height: imageHeight }); if (imageWidth !== data.imageWidth || imageHeight !== data.imageHeight) updateNode(id, { imageWidth, imageHeight }); }} />
            {selected && <label className="replace-image compact-upload-button nodrag" title={t('Replace example image')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label>}
            <div className="example-resource-copy"><CopyButton value={data.image} kind="image" /></div>
          </div>
        ) : exampleMode === 'image' ? (
          <div className="empty-image-surface"><label className="replace-image compact-upload-button nodrag" title={uploading ? t('Saving…') : t('Upload example image')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label></div>
        ) : null}
        {exampleMode === 'text' && (
          <div className="example-text-surface">
            {editingText ? (
              <textarea
                ref={textEditorRef}
                className="example-text-editor nodrag nowheel"
                value={exampleText}
                placeholder={t('Write an example…')}
                onChange={(event) => updateNode(id, { content: event.target.value })}
                onBlur={() => setEditingText(false)}
                autoFocus
              />
            ) : (
              <div ref={textEditorRef} className={`example-text-display ${exampleText ? '' : 'is-empty'}`} onDoubleClick={beginTextEditing}>{exampleText || t('Double-click to write example text…')}</div>
            )}
            {exampleText && <div className="example-resource-copy"><CopyButton value={exampleText} /></div>}
          </div>
        )}
        {!exampleMode && <div className="example-content-empty">{t('Choose this Example node type once. The selected type will remain fixed.')}</div>}
        <div className="mixer-footer-note example-resource-count"><span>{inputImageCount} {t('images', 'áº£nh')}</span><span>{inputTextCount} text</span></div>
        <section className="example-inputs">
          <div className="example-inputs-label"><Layers3 size={12} /> INPUT NODE · {inputTitles.length}</div>
          {inputTitles.length ? inputTitles.map((item) => (
            <div className={`example-title-row ${item.kind}`} key={item.id}>
              {item.kind === 'example' ? <BookOpenCheck size={13} /> : item.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
              <button className="example-title-link nodrag" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(item.id); }} aria-label={t(`Go to ${item.title || 'input node'}`, `Äi tá»›i ${item.title || 'node input'}`)} title={t('Go to input node', 'Äi tá»›i node input')}>{item.title || t('Untitled node', 'Node chÆ°a Ä‘áº·t tÃªn')}</button>
              {item.previewImage && (
                <div className="example-input-preview" aria-hidden="true">
                  <img src={item.previewImage} alt="" draggable="false" />
                </div>
              )}
            </div>
          )) : <div className="example-empty">{t('Connect Text, Image, or Mixer to the left port.', 'Cáº¯m Text, Image hoáº·c Mixer vÃ o cá»•ng bÃªn trÃ¡i.')}</div>}
        </section>
      </div>
      <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
      <div className="node-border-copy example-input-title-copy" title={t('Copy input node title list')}>
        <CopyButton value={inputTitleListText} />
      </div>
    </NodeShell>
    <ExampleImageLightbox open={previewOpen} onClose={closePreview} image={data.image} title={data.title} fileName={data.fileName} assetFile={data.assetFile} dimensions={imageDimensions} revealAsset={revealAsset} />
    </>
  );
});

const GenNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { generateImage, focusNode, revealAsset, downloadGeneratedImage, updateNode } = useContext(NodeActionsContext);
  const [previewOpen, setPreviewOpen] = useState(false);
  const inputTitles = data.inputTitles || [];
  const imageInputs = data.imageInputs || [];
  const promptText = data.promptText || '';
  const isGenerating = Boolean(data.isGenerating);
  const color = data.color || '#a855f7';
  const viewMode = data.viewMode || 'expanded';
  const imageOrientation = normalizeGenOrientation(data.imageOrientation);
  const isPortrait = imageOrientation === 'portrait';
  const inputTextCount = data.inputTextCount || inputTitles.filter((item) => item.kind === 'text').length;
  const inputImageCount = data.inputImageCount || imageInputs.length;
  const inputTitleListText = inputTitles.map((item) => item.title || t('Untitled node', 'Node chÆ°a Ä‘áº·t tÃªn')).join('\n');
  const imageLimitExceeded = inputImageCount > 4;
  const canGenerate = !isGenerating && promptText.trim() && inputImageCount > 0 && !imageLimitExceeded;

  return (
    <>
      <NodeShell selected={selected} color={color} nodeId={id} note={data.note} className={`gen-card mode-${viewMode} ${isGenerating ? 'is-generating' : ''}`}>
        <PortStack ports={data.inputPorts} type="target" position={Position.Left} color={color} />
        <NodeHeader icon={Zap} title={data.title} nodeId={id} viewMode={viewMode} color={color} />
        <div className="gen-content nowheel">
          <div className={`gen-preview orientation-${imageOrientation} ${isGenerating ? 'is-generating' : ''}`} onDoubleClick={(event) => { if (data.image) { event.stopPropagation(); setPreviewOpen(true); } }}>
            {data.image ? (
              <>
                <img src={data.image} alt={data.title || t('Generated image')} draggable="false" />
                <div className="example-resource-copy"><CopyButton value={data.image} kind="image" /></div>
                {selected && (
                  <button
                    className="gen-download-button nodrag"
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); downloadGeneratedImage(id); }}
                    aria-label={t('Download generated image', 'Táº£i áº£nh Ä‘Ã£ táº¡o')}
                    title={t('Save another copy', 'LÆ°u thÃªm má»™t báº£n')}
                  >
                    <Download size={15} />
                  </button>
                )}
              </>
            ) : (
              <div className="gen-empty-preview"><Zap size={24} /><span>{isGenerating ? t('Generating image...', 'Äang táº¡o áº£nh...') : t('No generated image yet', 'ChÆ°a cÃ³ áº£nh táº¡o')}</span></div>
            )}
            {isGenerating && <div className="gen-progress-overlay"><span></span></div>}
          </div>
          <button
            className="gen-generate-button nodrag"
            type="button"
            disabled={!canGenerate}
            onClick={() => generateImage(id, { prompt: promptText, imageInputs, orientation: imageOrientation })}
            title={imageLimitExceeded ? t('Use at most 4 image inputs', 'Tá»‘i Ä‘a 4 áº£nh input') : !promptText.trim() ? t('Connect text input for prompt', 'Cáº¯m text input Ä‘á»ƒ lÃ m prompt') : !inputImageCount ? t('Connect image input', 'Cáº¯m áº£nh input') : t('Generate image', 'Táº¡o áº£nh')}
          >
            {isGenerating ? <><span className="gen-spinner"></span>{t('Generating', 'Äang táº¡o')}</> : <><Zap size={14} />{t('Generate', 'Táº¡o áº£nh')}</>}
          </button>
          {data.generationError && <div className="gen-error">{data.generationError}</div>}
          <div className="mixer-footer-note example-resource-count"><span>{inputImageCount}/4 {t('images', 'áº£nh')}</span><span>{inputTextCount} text</span></div>
          <section className="example-inputs gen-inputs">
            <div className="example-inputs-label"><Layers3 size={12} /> INPUT NODE · {inputTitles.length}</div>
            {inputTitles.length ? inputTitles.map((item) => (
              <div className={`example-title-row ${item.kind}`} key={item.id}>
                {item.kind === 'example' ? <BookOpenCheck size={13} /> : item.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
                <button className="example-title-link nodrag" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(item.id); }} aria-label={t(`Go to ${item.title || 'input node'}`, `Äi tá»›i ${item.title || 'node input'}`)} title={t('Go to input node', 'Äi tá»›i node input')}>{item.title || t('Untitled node', 'Node chÆ°a Ä‘áº·t tÃªn')}</button>
                {item.previewImage && (
                  <div className="example-input-preview" aria-hidden="true">
                    <img src={item.previewImage} alt="" draggable="false" />
                  </div>
                )}
              </div>
            )) : <div className="example-empty">{t('Connect Text and up to 4 Image inputs.', 'Cáº¯m Text vÃ  tá»‘i Ä‘a 4 áº£nh input.')}</div>}
          </section>
        </div>
        <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
        <button
          className={`node-border-copy gen-orientation-toggle ${isPortrait ? 'is-portrait' : 'is-landscape'}`}
          type="button"
          aria-pressed={isPortrait}
          aria-label={isPortrait ? t('Use landscape output', 'Chuyển sang ảnh ngang') : t('Use portrait output', 'Chuyển sang ảnh dọc')}
          title={isPortrait ? t('Portrait output · click for landscape', 'Ảnh dọc · bấm để chuyển ảnh ngang') : t('Landscape output · click for portrait', 'Ảnh ngang · bấm để chuyển ảnh dọc')}
          disabled={isGenerating}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            updateNode(id, { imageOrientation: isPortrait ? 'landscape' : 'portrait' });
          }}
        >
          <span className="gen-orientation-icon" aria-hidden="true"></span>
        </button>
        <div className="node-border-copy example-input-title-copy" title={t('Copy input node title list')}>
          <CopyButton value={inputTitleListText} />
        </div>
      </NodeShell>
      <ExampleImageLightbox open={previewOpen} onClose={() => setPreviewOpen(false)} image={data.image} title={data.title} fileName={data.fileName} assetFile={data.assetFile} dimensions={{ width: data.imageWidth || 0, height: data.imageHeight || 0 }} revealAsset={revealAsset} />
    </>
  );
});

const CanvasImageNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { updateNode } = useContext(NodeActionsContext);
  return (
    <div className={`canvas-image-node ${selected ? 'is-selected' : ''}`} style={{ width: data.width || 320, height: data.height || 240 }} title={t('Free image Â· right-click to make a node', 'áº¢nh tá»± do Â· chuá»™t pháº£i Ä‘á»ƒ Make node')}>
      <NodeNoteControl nodeId={id} note={data.note} color="#8b7cf6" selected={selected} />
      <NodeResizer
        isVisible={selected}
        minWidth={80}
        minHeight={60}
        keepAspectRatio
        color="#8b7cf6"
        handleClassName="canvas-image-resize-handle"
        lineClassName="canvas-image-resize-line"
        onResize={(_event, params) => updateNode(id, { width: params.width, height: params.height })}
      />
      <img src={data.image} alt={data.fileName || t('Canvas image', 'áº¢nh trÃªn canvas')} draggable="false" />
    </div>
  );
});

const JoinNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const color = data.color || '#8b7cf6';
  const reversed = Boolean(data.joinReversed);
  const updateNodeInternals = useUpdateNodeInternals();
  useLayoutEffect(() => { updateNodeInternals(id); }, [id, reversed, updateNodeInternals]);
  return (
    <div className={`join-point ${reversed ? 'is-reversed' : ''} ${selected ? 'is-selected' : ''} ${data.moveEnabled ? 'is-move-enabled' : ''}`} style={{ '--join-color': color }} title={data.moveEnabled ? t('Drag to move Join Point') : reversed ? t('Join Point · input right, output left') : t('Join Point · input left, output right')}>
      <Handle id="join-in" type="target" position={reversed ? Position.Right : Position.Left} className={`join-unified-handle join-target-zone ${reversed ? 'is-right' : 'is-left'}`} aria-label={t('Join Point input')} title={t('Input')} />
      <Handle id="join-out" type="source" position={reversed ? Position.Left : Position.Right} className={`join-unified-handle join-source-zone ${reversed ? 'is-left' : 'is-right'}`} aria-label={t('Join Point output')} title={t('Output')} />
      <Waypoints size={16} strokeWidth={2.6} />
    </div>
  );
});

const SectionNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { updateNode, removeNode } = useContext(NodeActionsContext);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const actionsRef = useRef(null);
  const color = data.color || '#3b82f6';
  const sectionOpacity = Math.max(0, Math.min(1, Number(data.opacity ?? 0.5)));
  const titleScale = Math.min(20, Math.max(1, 1 / (data.zoom || 1)));
  const resizeScale = Math.min(10, Math.max(1, 1 / Math.max(data.zoom || 1, 0.05)));

  useEffect(() => {
    if (!paletteOpen) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (actionsRef.current?.contains(event.target)) return;
      setPaletteOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [paletteOpen]);

  return (
    <section className={`section-frame ${selected ? 'is-selected' : ''}`} style={{ width: data.width || 420, height: data.height || 260, '--section-color': color, '--section-opacity': `${Math.round(sectionOpacity * 100)}%`, '--section-resize-scale': resizeScale }}>
      <NodeNoteControl nodeId={id} note={data.note} color={color} selected={selected} />
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={120}
        color={color}
        handleClassName="section-resize-handle"
        lineClassName="section-resize-line"
        onResize={(_event, params) => updateNode(id, { width: params.width, height: params.height })}
      />
      <div className="section-title-wrap nodrag" style={{ transform: `scale(${titleScale})` }}>
        <input value={data.title || 'Section'} onChange={(event) => updateNode(id, { title: event.target.value })} aria-label={t('Section name', 'TÃªn Section')} />
      </div>
      {selected && !data?.relatedHighlighted && (
        <label className="section-opacity-control nodrag" title={t('Section opacity')} onPointerDown={(event) => event.stopPropagation()}>
          <input type="range" min="0" max="100" step="5" value={Math.round(sectionOpacity * 100)} onChange={(event) => updateNode(id, { opacity: Number(event.target.value) / 100 })} aria-label={t('Section opacity')} />
          <span>{Math.round(sectionOpacity * 100)}%</span>
        </label>
      )}
      {selected && !data?.relatedHighlighted && (
        <div className="section-actions nodrag" ref={actionsRef}>
          <button onClick={() => setPaletteOpen((value) => !value)} aria-label={t('Choose Section color', 'Chá»n mÃ u Section')} title={t('Choose Section color', 'Chá»n mÃ u Section')}><Palette size={14} /></button>
          <button onClick={() => removeNode(id)} aria-label={t('Delete Section', 'XÃ³a Section')} title={t('Delete Section', 'XÃ³a Section')}><Trash2 size={14} /></button>
          {paletteOpen && <div className="section-palette">{NODE_COLORS.map((item) => <button key={item} style={{ '--swatch': item }} onClick={() => { updateNode(id, { color: item }); setPaletteOpen(false); }} aria-label={t(`Section color ${item}`, `MÃ u Section ${item}`)} />)}</div>}
        </div>
      )}
    </section>
  );
});

const nodeTypes = { textNode: TextNode, carouselNode: CarouselNode, imageNode: ImageNode, mixerNode: MixerNode, exampleNode: ExampleNode, genNode: GenNode, canvasImageNode: CanvasImageNode, joinNode: JoinNode, sectionNode: SectionNode };

function routeAroundNodes(start, end, obstacles) {
  const xs = [...new Set([start.x, end.x, ...obstacles.flatMap((rect) => [rect.left, rect.right])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap((rect) => [rect.top, rect.bottom])])].sort((a, b) => a - b);
  const isInside = (point) => obstacles.some((rect) => point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom);
  const isBlocked = (a, b) => obstacles.some((rect) => {
    if (a.y === b.y) {
      const minX = Math.min(a.x, b.x); const maxX = Math.max(a.x, b.x);
      return a.y > rect.top && a.y < rect.bottom && maxX > rect.left && minX < rect.right;
    }
    const minY = Math.min(a.y, b.y); const maxY = Math.max(a.y, b.y);
    return a.x > rect.left && a.x < rect.right && maxY > rect.top && minY < rect.bottom;
  });
  const points = [];
  const pointIndex = new Map();
  ys.forEach((y) => xs.forEach((x) => {
    const point = { x, y };
    if ((x === start.x && y === start.y) || (x === end.x && y === end.y) || !isInside(point)) {
      pointIndex.set(`${x}|${y}`, points.length);
      points.push(point);
    }
  }));
  const adjacency = Array.from({ length: points.length }, () => []);
  const connectLine = (indices, axis) => {
    indices.sort((a, b) => points[a][axis] - points[b][axis]);
    for (let index = 0; index < indices.length - 1; index += 1) {
      const from = indices[index]; const to = indices[index + 1];
      if (isBlocked(points[from], points[to])) continue;
      const distance = Math.abs(points[from].x - points[to].x) + Math.abs(points[from].y - points[to].y);
      const direction = points[from].x === points[to].x ? 'v' : 'h';
      adjacency[from].push({ to, distance, direction });
      adjacency[to].push({ to: from, distance, direction });
    }
  };
  ys.forEach((y) => connectLine(points.map((point, index) => point.y === y ? index : -1).filter((index) => index >= 0), 'x'));
  xs.forEach((x) => connectLine(points.map((point, index) => point.x === x ? index : -1).filter((index) => index >= 0), 'y'));
  const startIndex = pointIndex.get(`${start.x}|${start.y}`);
  const endIndex = pointIndex.get(`${end.x}|${end.y}`);
  if (startIndex == null || endIndex == null) return [start, end];
  const queue = [];
  const distances = new Map();
  const previous = new Map();
  const push = (item) => {
    queue.push(item);
    let child = queue.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (queue[parent].cost <= queue[child].cost) break;
      [queue[parent], queue[child]] = [queue[child], queue[parent]];
      child = parent;
    }
  };
  const pop = () => {
    const first = queue[0]; const last = queue.pop();
    if (queue.length && last) {
      queue[0] = last;
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1; const right = left + 1;
        let smallest = parent;
        if (left < queue.length && queue[left].cost < queue[smallest].cost) smallest = left;
        if (right < queue.length && queue[right].cost < queue[smallest].cost) smallest = right;
        if (smallest === parent) break;
        [queue[parent], queue[smallest]] = [queue[smallest], queue[parent]];
        parent = smallest;
      }
    }
    return first;
  };
  ['h', 'v'].forEach((direction) => {
    const key = `${startIndex}:${direction}`;
    distances.set(key, 0); push({ node: startIndex, direction, cost: 0, key });
  });
  let finalKey = null;
  while (queue.length) {
    const current = pop();
    if (current.cost !== distances.get(current.key)) continue;
    if (current.node === endIndex) { finalKey = current.key; break; }
    adjacency[current.node].forEach((edge) => {
      const bendPenalty = edge.direction === current.direction ? 0 : 12;
      const nextCost = current.cost + edge.distance + bendPenalty;
      const nextKey = `${edge.to}:${edge.direction}`;
      if (nextCost >= (distances.get(nextKey) ?? Infinity)) return;
      distances.set(nextKey, nextCost);
      previous.set(nextKey, current.key);
      push({ node: edge.to, direction: edge.direction, cost: nextCost, key: nextKey });
    });
  }
  if (!finalKey) return null;
  const route = [];
  let cursor = finalKey;
  while (cursor) {
    route.push(points[Number(cursor.split(':')[0])]);
    cursor = previous.get(cursor);
  }
  route.reverse();
  return route.filter((point, index, all) => {
    if (!index || index === all.length - 1) return true;
    const before = all[index - 1]; const after = all[index + 1];
    return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y));
  });
}

function roundedRoutePath(points, radius = 14) {
  if (points.length < 2) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]; const current = points[index]; const next = points[index + 1];
    const incoming = Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
    const outgoing = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    const cornerRadius = Math.min(radius, incoming / 2, outgoing / 2);
    const before = {
      x: current.x + Math.sign(previous.x - current.x) * cornerRadius,
      y: current.y + Math.sign(previous.y - current.y) * cornerRadius,
    };
    const after = {
      x: current.x + Math.sign(next.x - current.x) * cornerRadius,
      y: current.y + Math.sign(next.y - current.y) * cornerRadius,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function routeMidpoint(points) {
  const lengths = points.slice(1).map((point, index) => Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y));
  const target = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (travelled + lengths[index] >= target) {
      const ratio = lengths[index] ? (target - travelled) / lengths[index] : 0;
      return { x: points[index].x + (points[index + 1].x - points[index].x) * ratio, y: points[index].y + (points[index + 1].y - points[index].y) * ratio };
    }
    travelled += lengths[index];
  }
  return points[Math.floor(points.length / 2)];
}

function makeOrthogonalRoute(sourcePoint, targetPoint, obstacles, sourceLead = 28, targetLead = 28, sourceDirection = 1, targetDirection = -1) {
  const sourceStub = { x: sourcePoint.x + sourceLead * sourceDirection, y: sourcePoint.y };
  const targetStub = { x: targetPoint.x + targetLead * targetDirection, y: targetPoint.y };
  const middleRoute = routeAroundNodes(sourceStub, targetStub, obstacles);
  if (!middleRoute) return null;
  return [sourcePoint, sourceStub, ...middleRoute.slice(1, -1), targetStub, targetPoint]
    .filter((point, index, all) => !index || point.x !== all[index - 1].x || point.y !== all[index - 1].y)
    .filter((point, index, all) => {
      if (!index || index === all.length - 1) return true;
      const before = all[index - 1]; const after = all[index + 1];
      return !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y));
    });
}

function routeSegmentsAsObstacles(points, padding = 16) {
  return points.slice(1).map((point, index) => {
    const previous = points[index];
    return {
      left: Math.min(previous.x, point.x) - padding,
      right: Math.max(previous.x, point.x) + padding,
      top: Math.min(previous.y, point.y) - padding,
      bottom: Math.max(previous.y, point.y) + padding,
    };
  });
}

function createSpatialObstacleIndex(obstacles = [], cellSize = 320) {
  const grid = new Map();
  const index = { cellSize, grid, obstacles: [] };
  obstacles.forEach((obstacle) => addSpatialObstacle(index, obstacle));
  return index;
}

function addSpatialObstacle(index, obstacle) {
  const obstacleIndex = index.obstacles.length;
  index.obstacles.push(obstacle);
  const minColumn = Math.floor(obstacle.left / index.cellSize);
  const maxColumn = Math.floor(obstacle.right / index.cellSize);
  const minRow = Math.floor(obstacle.top / index.cellSize);
  const maxRow = Math.floor(obstacle.bottom / index.cellSize);
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      const key = `${column}|${row}`;
      if (!index.grid.has(key)) index.grid.set(key, []);
      index.grid.get(key).push(obstacleIndex);
    }
  }
}

function querySpatialObstacles(index, bounds) {
  const minColumn = Math.floor(bounds.left / index.cellSize);
  const maxColumn = Math.floor(bounds.right / index.cellSize);
  const minRow = Math.floor(bounds.top / index.cellSize);
  const maxRow = Math.floor(bounds.bottom / index.cellSize);
  const cellCount = (maxColumn - minColumn + 1) * (maxRow - minRow + 1);
  if (cellCount > Math.max(64, index.grid.size * 2)) {
    return index.obstacles.filter((obstacle) => obstacle.right >= bounds.left && obstacle.left <= bounds.right && obstacle.bottom >= bounds.top && obstacle.top <= bounds.bottom);
  }
  const candidates = new Set();
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      (index.grid.get(`${column}|${row}`) || []).forEach((obstacleIndex) => candidates.add(obstacleIndex));
    }
  }
  return [...candidates]
    .map((obstacleIndex) => index.obstacles[obstacleIndex])
    .filter((obstacle) => obstacle.right >= bounds.left && obstacle.left <= bounds.right && obstacle.bottom >= bounds.top && obstacle.top <= bounds.bottom);
}

function routingSearchBounds(start, end, margin = 280) {
  return {
    left: Math.min(start.x, end.x) - margin,
    right: Math.max(start.x, end.x) + margin,
    top: Math.min(start.y, end.y) - margin,
    bottom: Math.max(start.y, end.y) + margin,
  };
}

function obstacleRoutingSignature(obstacles) {
  return obstacles.map((obstacle) => `${obstacle.id || ''}:${Math.round(obstacle.left)},${Math.round(obstacle.top)},${Math.round(obstacle.right)},${Math.round(obstacle.bottom)}`).join(';');
}

function offsetPointOnEdgePath(pathElement, clickPoint, screenGap, zoom) {
  if (!pathElement?.getTotalLength || !pathElement?.getPointAtLength) return clickPoint;
  const total = pathElement.getTotalLength();
  if (!Number.isFinite(total) || total <= 0) return clickPoint;
  const distanceAt = (length) => {
    const point = pathElement.getPointAtLength(length);
    return (point.x - clickPoint.x) ** 2 + (point.y - clickPoint.y) ** 2;
  };
  const samples = Math.max(40, Math.min(240, Math.ceil(total / 10)));
  let nearestLength = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index <= samples; index += 1) {
    const length = total * index / samples;
    const distance = distanceAt(length);
    if (distance < nearestDistance) { nearestDistance = distance; nearestLength = length; }
  }
  const sampleStep = total / samples;
  let low = Math.max(0, nearestLength - sampleStep);
  let high = Math.min(total, nearestLength + sampleStep);
  for (let index = 0; index < 12; index += 1) {
    const first = low + (high - low) / 3;
    const second = high - (high - low) / 3;
    if (distanceAt(first) <= distanceAt(second)) high = second;
    else low = first;
  }
  nearestLength = (low + high) / 2;
  const forwardRoom = total - nearestLength;
  const backwardRoom = nearestLength;
  const direction = forwardRoom >= backwardRoom ? 1 : -1;
  const available = Math.max(forwardRoom, backwardRoom);
  const gap = Math.min(screenGap / Math.max(zoom, 0.05), available * 0.72);
  const point = pathElement.getPointAtLength(nearestLength + direction * gap);
  return { x: point.x, y: point.y };
}

const BeamEdge = memo(({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  data,
}) => {
  const t = useTranslation();
  const { removeEdge } = useContext(EdgeActionsContext);
  const colorMode = data?.color || 'gradient';
  const isGradient = colorMode === 'gradient';
  const sourceColor = data?.sourceColor || '#8b7cf6';
  const targetColor = data?.targetColor || '#8b7cf6';
  const color = isGradient ? targetColor : colorMode;
  const gradientId = `beam-gradient-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const edgeStroke = isGradient ? `url(#${gradientId})` : color;
  const connectionHighlighted = selected || Boolean(data?.relatedHighlighted);
  const [edgePath, labelX, labelY] = useMemo(() => {
    const sourcePoint = data?.sourcePoint || { x: sourceX, y: sourceY };
    const targetPoint = data?.targetPoint || { x: targetX, y: targetY };
    const obstacles = data?.routingObstacles || [];
    const plannedRoute = data?.routingComputed
      ? data?.routedPoints
      : (data?.routedPoints || makeOrthogonalRoute(sourcePoint, targetPoint, obstacles, data?.sourceLead, data?.targetLead, data?.sourceDirection, data?.targetDirection));
    if (!plannedRoute) return getSmoothStepPath({ sourceX: sourcePoint.x, sourceY: sourcePoint.y, targetX: targetPoint.x, targetY: targetPoint.y, sourcePosition, targetPosition, borderRadius: 18 }).slice(0, 3);
    let route = plannedRoute.map((point, index) => index === 0 ? sourcePoint : index === plannedRoute.length - 1 ? targetPoint : point);
    const hasDiagonal = route.slice(1).some((point, index) => point.x !== route[index].x && point.y !== route[index].y);
    if (hasDiagonal) {
      const correctedRoute = makeOrthogonalRoute(sourcePoint, targetPoint, obstacles, data?.sourceLead, data?.targetLead, data?.sourceDirection, data?.targetDirection);
      if (!correctedRoute) return getSmoothStepPath({ sourceX: sourcePoint.x, sourceY: sourcePoint.y, targetX: targetPoint.x, targetY: targetPoint.y, sourcePosition, targetPosition, borderRadius: 18 }).slice(0, 3);
      route = correctedRoute;
    }
    const midpoint = routeMidpoint(route);
    return [roundedRoutePath(route), midpoint.x, midpoint.y];
  }, [data?.routedPoints, data?.routingKey, data?.sourcePoint, data?.targetPoint, source, sourcePosition, sourceX, sourceY, target, targetPosition, targetX, targetY]);
  const cutX = data?.cutPoint?.x ?? labelX;
  const cutY = data?.cutPoint?.y ?? labelY;

  return (
    <>
      <defs>
        {isGradient && <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={data?.sourcePoint?.x ?? sourceX} y1={data?.sourcePoint?.y ?? sourceY} x2={data?.targetPoint?.x ?? targetX} y2={data?.targetPoint?.y ?? targetY}><stop offset="0%" stopColor={sourceColor} /><stop offset="100%" stopColor={targetColor} /></linearGradient>}
      </defs>
      <BaseEdge id={id} path={edgePath} className={`beam-edge ${connectionHighlighted ? 'is-active' : ''}`} style={{ stroke: edgeStroke }} interactionWidth={32} />
      {connectionHighlighted && <path d={edgePath} className="beam-selection-glow" style={{ stroke: edgeStroke }} />}
      {connectionHighlighted && <path d={edgePath} className="beam-runner" />}
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="edge-cut-button nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${cutX}px, ${cutY}px)` }}
            onClick={(event) => { event.stopPropagation(); removeEdge(id); }}
            aria-label={t('Disconnect', 'Ngáº¯t káº¿t ná»‘i')}
            title={t('Disconnect', 'Ngáº¯t káº¿t ná»‘i')}
          >
            <Scissors size={20} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const edgeTypes = { beam: BeamEdge };

function ProjectManager({ projects, activeProjectId, onSelect, onCreate, onRename, onDelete, onReorder }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [deletePending, setDeletePending] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const managerRef = useRef(null);
  const active = projects.find((project) => project.id === activeProjectId);

  const finishReorder = useCallback((targetId) => {
    if (!draggingId || !targetId || draggingId === targetId) return;
    const fromIndex = projects.findIndex((project) => project.id === draggingId);
    const toIndex = projects.findIndex((project) => project.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...projects];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next);
  }, [draggingId, onReorder, projects]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (managerRef.current?.contains(event.target)) return;
      setOpen(false);
      setEditingId(null);
      setDeletePending(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [open]);

  return (
    <div className="project-manager" ref={managerRef}>
      <button className="project-current" onClick={() => setOpen((value) => !value)} aria-label={t('Project list', 'Danh sÃ¡ch project')}>
        <span className="project-folder"><FolderKanban size={15} /></span>
        <span><strong>{active?.name || t('Loadingâ€¦', 'Äang táº£i...')}</strong><small>{active?.folder || t('Project storage', 'Bá»™ nhá»› project')}</small></span>
        <ChevronDown size={14} className={open ? 'rotated' : ''} />
      </button>
      {open && (
        <div className="project-popover">
          <div className="project-list">
            {projects.map((project) => (
              <div
                className={`project-row ${project.id === activeProjectId ? 'active' : ''} ${draggingId === project.id ? 'is-dragging' : ''} ${dragOverId === project.id && draggingId !== project.id ? 'is-drag-over' : ''}`}
                key={project.id}
                onDragOver={(event) => { if (draggingId) { event.preventDefault(); setDragOverId(project.id); } }}
                onDragLeave={() => setDragOverId((current) => current === project.id ? null : current)}
                onDrop={(event) => { event.preventDefault(); finishReorder(project.id); setDraggingId(null); setDragOverId(null); }}
              >
                {editingId === project.id ? (
                  <>
                    <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { onRename(project.id, editingName); setEditingId(null); } }} aria-label={t('New project name', 'TÃªn project má»›i')} />
                    <button onClick={() => { onRename(project.id, editingName); setEditingId(null); }} aria-label={t('Save name', 'LÆ°u tÃªn')}><Check size={12} /></button>
                    <button onClick={() => setEditingId(null)} aria-label={t('Cancel rename', 'Há»§y Ä‘á»•i tÃªn')}><X size={12} /></button>
                  </>
                ) : deletePending === project.id ? (
                  <><span className="delete-question">{t(`Delete â€œ${project.name}â€?`, `XÃ³a â€œ${project.name}â€?`)}</span><button className="confirm-delete" onClick={() => { onDelete(project.id); setDeletePending(null); }} aria-label={t('Confirm delete', 'XÃ¡c nháº­n xÃ³a')}><Check size={12} /></button><button onClick={() => setDeletePending(null)} aria-label={t('Cancel delete', 'Há»§y xÃ³a')}><X size={12} /></button></>
                ) : (
                  <>
                    <button
                      className="project-drag-handle"
                      draggable
                      onDragStart={(event) => { setDraggingId(project.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', project.id); }}
                      onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                      aria-label={t(`Drag ${project.name} to reorder`, `KÃƒÂ©o ${project.name} Ã„â€˜Ã¡Â»Æ’ sÃ¡ÂºÂ¯p xÃ¡ÂºÂ¿p`)}
                      title={t('Drag to reorder', 'KÃƒÂ©o Ã„â€˜Ã¡Â»Æ’ sÃ¡ÂºÂ¯p xÃ¡ÂºÂ¿p')}
                    ><GripVertical size={13} /></button>
                    <button className="project-select" onClick={() => { onSelect(project.id); setOpen(false); }}>
                      <span className="project-dot"></span><span><strong>{project.name}</strong><small>{project.nodeCount || 0} nodes · {project.edgeCount || 0} links</small></span>
                    </button>
                    <button onClick={() => { setEditingId(project.id); setEditingName(project.name); }} aria-label={t(`Rename ${project.name}`, `Äá»•i tÃªn ${project.name}`)}><Pencil size={11} /></button>
                    <button disabled={projects.length <= 1} onClick={() => setDeletePending(project.id)} aria-label={t(`Delete ${project.name}`, `XÃ³a ${project.name}`)}><Trash2 size={11} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      <form className="project-create" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) { onCreate(newName.trim()); setNewName(''); setOpen(false); } }}>
        <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('New project name', 'TÃªn project má»›i')} aria-label={t('New project name', 'TÃªn project má»›i')} />
        <button type="submit" disabled={!newName.trim()} aria-label={t('Create project', 'Táº¡o project')}><FolderPlus size={14} /></button>
      </form>
    </div>
  );
}

function Sidebar({ collapsed, setCollapsed, addNode, resetProject, openSettings, projects, activeProjectId, onSelectProject, onCreateProject, onRenameProject, onDeleteProject, onReorderProjects }) {
  const t = useTranslation();
  const [confirmBaseTemplate, setConfirmBaseTemplate] = useState(false);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark"><Merge size={20} /></div>
        {!collapsed && <div><strong>mergeboard</strong><span>visual composer</span></div>}
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={t('Collapse sidebar', 'Thu gá»n thanh bÃªn')}>
          {collapsed ? <Menu size={17} /> : <ChevronLeft size={17} />}
        </button>
      </div>

      {!collapsed && <ProjectManager projects={projects} activeProjectId={activeProjectId} onSelect={onSelectProject} onCreate={onCreateProject} onRename={onRenameProject} onDelete={onDeleteProject} onReorder={onReorderProjects} />}

      <nav className="node-menu">
        <button onClick={() => addNode('textNode')}><span className="menu-icon blue"><Type size={17} /></span>{!collapsed && <><span><strong>Text</strong><small>{t('Text content', 'Ná»™i dung vÄƒn báº£n')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('carouselNode')}><span className="menu-icon blue"><FileImage size={17} /></span>{!collapsed && <><span><strong>Carousel</strong><small>{t('JSON text & images')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('imageNode')}><span className="menu-icon orange"><ImageIcon size={17} /></span>{!collapsed && <><span><strong>Image</strong><small>{t('Image & visual', 'áº¢nh & visual')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('mixerNode')}><span className="menu-icon violet"><Merge size={17} /></span>{!collapsed && <><span><strong>Mixer</strong><small>{t('Collect resources', 'Gom tÃ i nguyÃªn')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('exampleNode')}><span className="menu-icon green"><BookOpenCheck size={17} /></span>{!collapsed && <><span><strong>Example</strong><small>{t('Reference image & input', 'áº¢nh máº«u & input')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('genNode')}><span className="menu-icon violet"><Zap size={17} /></span>{!collapsed && <><span><strong>Gen Node</strong><small>{t('Generate image', 'Táº¡o áº£nh')}</small></span><Plus size={15} /></>}</button>
      </nav>

      <div className="sidebar-bottom">
        <button onClick={openSettings} title={t('Settings', 'CÃ i Ä‘áº·t')}><Settings size={16} />{!collapsed && <span>{t('Settings', 'CÃ i Ä‘áº·t')}</span>}</button>
        <button className="base-template-icon" onClick={() => setConfirmBaseTemplate((value) => !value)} title={t('Reset Base Template', 'Táº¡o láº¡i Base Template')} aria-label={t('Reset Base Template', 'Táº¡o láº¡i Base Template')}><RotateCcw size={16} /></button>
        {confirmBaseTemplate && (
          <div className="base-template-confirm">
            <span>{t('Reset to Base Template?', 'Reset vá» Base Template?')}</span>
            <button onClick={() => { resetProject(); setConfirmBaseTemplate(false); }} aria-label={t('Confirm reset', 'XÃ¡c nháº­n reset')}><Check size={12} /></button>
            <button onClick={() => setConfirmBaseTemplate(false)} aria-label={t('Cancel reset', 'Há»§y reset')}><X size={12} /></button>
          </div>
        )}
      </div>
    </aside>
  );
}

function FlowCanvas() {
  const initial = useMemo(loadProject, []);
  const [nodes, setNodes] = useState(initial.nodes);
  const [edges, setEdges] = useState(initial.edges);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'dark');
  const [shopAIKey, setShopAIKey] = useState(() => localStorage.getItem(SHOPAIKEY_API_KEY) || '');
  const [localProjectRootPath, setLocalProjectRootPath] = useState(() => localStorage.getItem(LOCAL_PROJECT_ROOT_PATH_KEY) || '');
  const t = translateEnglish;
  const [storageReady, setStorageReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState('loading');
  const [contextMenu, setContextMenu] = useState(null);
  const [edgeMenu, setEdgeMenu] = useState(null);
  const [joinMenu, setJoinMenu] = useState(null);
  const [canvasImageMenu, setCanvasImageMenu] = useState(null);
  const [movableJoinId, setMovableJoinId] = useState(null);
  const [edgeCutPoints, setEdgeCutPoints] = useState({});
  const [viewportZoom, setViewportZoom] = useState(1);
  const [toolMode, setToolMode] = useState('select');
  const [routingDragNodeIds, setRoutingDragNodeIds] = useState([]);
  const [sectionDraft, setSectionDraft] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appSettings, setAppSettings] = useState(null);
  const [choosingAssetFolder, setChoosingAssetFolder] = useState(false);
  const [storageGate, setStorageGate] = useState('checking');
  const rememberedRootRef = useRef(null);
  const projectsRef = useRef([]);
  const canvasRef = useRef(null);
  const connectionStartRef = useRef(null);
  const connectionCompletedRef = useRef(false);
  const selectionPointerRef = useRef(null);
  const historyRef = useRef({ past: [], future: [], current: null });
  const historyProjectRef = useRef(null);
  const historyTimerRef = useRef(null);
  const historyApplyingRef = useRef(false);
  const latestSnapshotRef = useRef(null);
  const duplicateDeltaRef = useRef({ x: 42, y: 42 });
  const pendingDuplicateRef = useRef(null);
  const routeCacheRef = useRef(new Map());
  const { screenToFlowPosition, fitView, getNode, setCenter, getViewport, setViewport } = useReactFlow();
  const renderedNodeLayout = useStore(selectRenderedNodeLayout, sameRenderedNodeLayout);

  useEffect(() => {
    if (!contextMenu && !edgeMenu && !joinMenu && !canvasImageMenu) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (event.target?.closest?.('.canvas-context-menu, .edge-color-menu')) return;
      setContextMenu(null);
      setEdgeMenu(null);
      setJoinMenu(null);
      setCanvasImageMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [canvasImageMenu, contextMenu, edgeMenu, joinMenu]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || toolMode !== 'section') return undefined;
    const zoomSectionCanvas = (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const flowElement = canvas.querySelector('.react-flow');
      const rect = (flowElement || canvas).getBoundingClientRect();
      const viewport = getViewport();
      const normalizedDelta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      const nextZoom = Math.max(0.05, Math.min(1.8, viewport.zoom * Math.exp(-normalizedDelta * 0.002)));
      if (nextZoom === viewport.zoom) return;
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const flowX = (pointerX - viewport.x) / viewport.zoom;
      const flowY = (pointerY - viewport.y) / viewport.zoom;
      setViewport({
        x: pointerX - flowX * nextZoom,
        y: pointerY - flowY * nextZoom,
        zoom: nextZoom,
      }, { duration: 0 });
    };
    canvas.addEventListener('wheel', zoomSectionCanvas, { passive: false, capture: true });
    return () => canvas.removeEventListener('wheel', zoomSectionCanvas, { capture: true });
  }, [getViewport, setViewport, toolMode]);
  const renderedNodeLayoutById = useMemo(() => new Map(renderedNodeLayout.map((node) => [node.id, node])), [renderedNodeLayout]);

  const joinReversedById = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incomingByTarget = new Map();
    edges.forEach((edge) => {
      if (!incomingByTarget.has(edge.target)) incomingByTarget.set(edge.target, []);
      incomingByTarget.get(edge.target).push(edge);
    });
    const lineageCache = new Map();
    const collectInputSourceIds = (targetId, visiting = new Set()) => {
      if (lineageCache.has(targetId)) return lineageCache.get(targetId);
      if (visiting.has(targetId)) return [];
      const nextVisiting = new Set(visiting).add(targetId);
      const sourceIds = (incomingByTarget.get(targetId) || []).flatMap((edge) => {
        const source = nodeById.get(edge.source);
        if (!source) return [];
        if (['textNode', 'carouselNode', 'imageNode', 'exampleNode', 'genNode'].includes(source.type)) return [source.id];
        if (['mixerNode', 'joinNode'].includes(source.type)) return collectInputSourceIds(source.id, nextVisiting);
        return [];
      });
      const uniqueIds = [...new Set(sourceIds)];
      lineageCache.set(targetId, uniqueIds);
      return uniqueIds;
    };
    const centerX = (node) => {
      const layout = renderedNodeLayoutById.get(node.id);
      const width = layout?.width || node.measured?.width || node.width || (node.type === 'joinNode' ? 54 : 292);
      return (layout?.x ?? node.position?.x ?? 0) + width / 2;
    };
    return new Map(nodes.filter((node) => node.type === 'joinNode').map((joinNode) => {
      const joinCenterX = centerX(joinNode);
      const inputSources = collectInputSourceIds(joinNode.id);
      const rightCount = inputSources.filter((sourceId) => {
        const source = nodeById.get(sourceId);
        return source && centerX(source) > joinCenterX;
      }).length;
      const leftCount = inputSources.filter((sourceId) => {
        const source = nodeById.get(sourceId);
        return source && centerX(source) < joinCenterX;
      }).length;
      return [joinNode.id, rightCount > leftCount];
    }));
  }, [nodes, edges, renderedNodeLayoutById]);

  const selectedCanvasImageIds = useMemo(
    () => nodes.filter((node) => node.type === 'canvasImageNode' && node.selected).map((node) => node.id),
    [nodes],
  );

  const selectedBatchInputIds = useMemo(
    () => nodes
      .filter((node) => ['textNode', 'carouselNode', 'imageNode', 'exampleNode', 'genNode', 'canvasImageNode'].includes(node.type) && node.selected)
      .map((node) => node.id),
    [nodes],
  );

  const rememberSelectionStart = useCallback((event) => {
    if (event.button === 0) selectionPointerRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const finishSmartSelection = useCallback((event) => {
    const start = selectionPointerRef.current;
    selectionPointerRef.current = null;
    if (!start) return;
    const rect = {
      left: Math.min(start.x, event.clientX),
      right: Math.max(start.x, event.clientX),
      top: Math.min(start.y, event.clientY),
      bottom: Math.max(start.y, event.clientY),
    };
    const intersectsRect = (bounds) => bounds.right >= rect.left && bounds.left <= rect.right && bounds.bottom >= rect.top && bounds.top <= rect.bottom;
    const escapeId = (id) => window.CSS?.escape ? window.CSS.escape(id) : id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const selectedNodeIds = new Set(nodes.filter((node) => {
      const element = document.querySelector(`.react-flow__node[data-id="${escapeId(node.id)}"]`);
      return element ? intersectsRect(element.getBoundingClientRect()) : false;
    }).map((node) => node.id));

    if (selectedNodeIds.size) {
      setNodes((current) => current.map((node) => ({ ...node, selected: selectedNodeIds.has(node.id) })));
      setEdges((current) => current.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
      return;
    }

    const selectedEdgeIds = new Set(edges.filter((edge) => {
      const path = document.querySelector(`.react-flow__edge[data-id="${escapeId(edge.id)}"] .react-flow__edge-path`);
      if (!path || !intersectsRect(path.getBoundingClientRect())) return false;
      const length = path.getTotalLength?.() || 0;
      const matrix = path.getScreenCTM?.();
      if (!length || !matrix) return false;
      const samples = Math.max(2, Math.ceil(length * viewportZoom / 6));
      for (let index = 0; index <= samples; index += 1) {
        const point = path.getPointAtLength((length * index) / samples);
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        if (screenPoint.x >= rect.left && screenPoint.x <= rect.right && screenPoint.y >= rect.top && screenPoint.y <= rect.bottom) return true;
      }
      return false;
    }).map((edge) => edge.id));
    setNodes((current) => current.map((node) => node.selected ? { ...node, selected: false } : node));
    setEdges((current) => current.map((edge) => ({ ...edge, selected: selectedEdgeIds.has(edge.id) })));
  }, [edges, nodes, viewportZoom]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!storageReady || !activeProjectId) return undefined;
    const snapshot = createGraphSnapshot(nodes, edges);
    latestSnapshotRef.current = snapshot;
    if (historyProjectRef.current !== activeProjectId) {
      clearTimeout(historyTimerRef.current);
      historyProjectRef.current = activeProjectId;
      historyRef.current = { past: [], future: [], current: snapshot };
      historyApplyingRef.current = false;
      return undefined;
    }
    if (historyApplyingRef.current) {
      clearTimeout(historyTimerRef.current);
      historyRef.current.current = snapshot;
      historyApplyingRef.current = false;
      return undefined;
    }
    if (snapshot.signature === historyRef.current.current?.signature) return undefined;
    clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(() => {
      const next = latestSnapshotRef.current;
      const history = historyRef.current;
      if (!next || next.signature === history.current?.signature) return;
      history.past.push(history.current);
      if (history.past.length > 100) history.past.shift();
      history.current = next;
      history.future = [];
    }, 260);
    return () => clearTimeout(historyTimerRef.current);
  }, [activeProjectId, edges, nodes, storageReady]);

  const commitPendingHistory = useCallback(() => {
    clearTimeout(historyTimerRef.current);
    const next = latestSnapshotRef.current;
    const history = historyRef.current;
    if (!next || next.signature === history.current?.signature) return;
    history.past.push(history.current);
    if (history.past.length > 100) history.past.shift();
    history.current = next;
    history.future = [];
  }, []);

  const restoreHistorySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    historyApplyingRef.current = true;
    latestSnapshotRef.current = snapshot;
    setNodes(snapshot.nodes.map((node) => ({ ...node, data: { ...(node.data || {}) } })));
    setEdges(snapshot.edges.map((edge) => ({ ...edge, data: { ...(edge.data || {}) } })));
    setContextMenu(null); setEdgeMenu(null); setJoinMenu(null); setCanvasImageMenu(null); setSectionDraft(null);
  }, []);

  const undoGraph = useCallback(() => {
    commitPendingHistory();
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) return showToast(t('Nothing to undo', 'KhÃ´ng cÃ²n thao tÃ¡c Ä‘á»ƒ hoÃ n tÃ¡c'), 'error');
    history.future.push(history.current);
    history.current = previous;
    restoreHistorySnapshot(previous);
    showToast(t('Undid the last action', 'ÄÃ£ hoÃ n tÃ¡c thao tÃ¡c gáº§n nháº¥t'));
  }, [commitPendingHistory, restoreHistorySnapshot, showToast, t]);

  const redoGraph = useCallback(() => {
    commitPendingHistory();
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return showToast(t('Nothing to redo', 'KhÃ´ng cÃ²n thao tÃ¡c Ä‘á»ƒ lÃ m láº¡i'), 'error');
    history.past.push(history.current);
    history.current = next;
    restoreHistorySnapshot(next);
    showToast(t('Redid the last action', 'ÄÃ£ lÃ m láº¡i thao tÃ¡c gáº§n nháº¥t'));
  }, [commitPendingHistory, restoreHistorySnapshot, showToast, t]);

  const updateProjects = useCallback((updater) => {
    setProjects((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      projectsRef.current = next;
      return next;
    });
  }, []);

  const openSettingsPanel = useCallback(() => {
    setSettingsOpen(true);
    setAppSettings({ projectRoot: fileStorage.getRootName() });
  }, []);

  const loadProjectById = useCallback(async (projectId) => {
    setStorageReady(false); setSaveStatus('loading'); setContextMenu(null); setEdgeMenu(null); setJoinMenu(null); setCanvasImageMenu(null); setMovableJoinId(null); setEdgeCutPoints({}); setToolMode('select'); setSectionDraft(null);
    const entry = projectsRef.current.find((project) => project.id === projectId);
    if (!entry) throw new Error(t('Project not found', 'KhÃ´ng tÃ¬m tháº¥y project'));
    const project = await fileStorage.readProject(entry);
    const loadedNodes = project.nodes || [];
    const loadedEdges = (project.edges || []).map((edge) => ({ ...edge, type: 'beam' }));
    setNodes(loadedNodes);
    setEdges(removeDuplicateInputEdges(loadedNodes, loadedEdges));
    setActiveProjectId(projectId);
    localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    setSaveStatus('saved'); setStorageReady(true);
    setTimeout(() => fitView({ padding: .18, duration: 450 }), 80);
  }, [fitView, t]);

  const loadRootProjects = useCallback(async () => {
    let list = await fileStorage.scanProjects();
    if (!list.length) list = [await fileStorage.createProject('Main Project', [])];
    updateProjects(list);
    setAppSettings({ projectRoot: fileStorage.getRootName() });
    setStorageGate('ready');
    const remembered = localStorage.getItem(ACTIVE_PROJECT_KEY);
    const selected = list.find((item) => item.id === remembered)?.id || list[0].id;
    await loadProjectById(selected);
    return list;
  }, [loadProjectById, updateProjects]);

  const connectRememberedFolder = useCallback(async () => {
    const handle = rememberedRootRef.current;
    if (!handle) return;
    setChoosingAssetFolder(true);
    try {
      const permission = await fileStorage.rootPermission(handle, true);
      if (permission !== 'granted') throw new Error(t('Read and write access was not granted', 'Báº¡n chÆ°a cho phÃ©p Ä‘á»c vÃ  ghi folder'));
      await fileStorage.useRoot(handle);
      await loadRootProjects();
      showToast(t('Project folder reconnected', 'ÄÃ£ káº¿t ná»‘i láº¡i Folder lÆ°u Project'));
    } catch (error) {
      showToast(error.message || t('Could not connect the project folder', 'KhÃ´ng thá»ƒ káº¿t ná»‘i folder project'), 'error');
    } finally {
      setChoosingAssetFolder(false);
    }
  }, [loadRootProjects, showToast, t]);

  const chooseProjectFolder = useCallback(async () => {
    const wasReady = storageGate === 'ready';
    if (wasReady) setStorageReady(false);
    setChoosingAssetFolder(true);
    try {
      await fileStorage.chooseRoot();
      rememberedRootRef.current = await fileStorage.getRememberedRoot();
      const list = await loadRootProjects();
      showToast(t(`Folder connected Â· ${list.length} project(s) found`, `ÄÃ£ káº¿t ná»‘i folder vÃ  nháº­n ${list.length} project`));
    } catch (error) {
      if (error?.name !== 'AbortError') showToast(error.message || t('Could not select the project folder', 'KhÃ´ng thá»ƒ chá»n Folder lÆ°u Project'), 'error');
    } finally {
      if (wasReady && fileStorage.getRootName()) setStorageReady(true);
      setChoosingAssetFolder(false);
    }
  }, [loadRootProjects, showToast, storageGate, t]);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const cleanedEdges = removeDuplicateInputEdges(nodes, edges);
    if (cleanedEdges.length !== edges.length) setEdges(cleanedEdges);
  }, [nodes, edges]);

  useEffect(() => {
    let cancelled = false;
    const initializeStorage = async () => {
      try {
        if (!fileStorage.isFileSystemAccessSupported()) {
          setStorageGate('unsupported');
          return;
        }
        const handle = await fileStorage.getRememberedRoot();
        if (cancelled) return;
        if (!handle) {
          setStorageGate('needs-folder');
          return;
        }
        rememberedRootRef.current = handle;
        const permission = await fileStorage.rootPermission(handle, false);
        if (permission !== 'granted') {
          setStorageGate('needs-permission');
          return;
        }
        await fileStorage.useRoot(handle);
        if (!cancelled) await loadRootProjects();
      } catch (error) {
        setSaveStatus('error');
        setStorageGate('needs-folder');
        showToast(error.message || t('Could not open project storage', 'KhÃ´ng thá»ƒ má»Ÿ bá»™ nhá»› project'), 'error');
      }
    };
    initializeStorage();
    return () => { cancelled = true; };
  }, [loadRootProjects, showToast, t]);

  useEffect(() => {
    if (!storageReady || !activeProjectId) return;
    let cancelled = false;
    setSaveStatus('saving');
    const timeout = setTimeout(async () => {
      try {
        const project = projectsRef.current.find((item) => item.id === activeProjectId);
        if (!project) throw new Error(t('The active project was not found', 'KhÃ´ng tÃ¬m tháº¥y project Ä‘ang má»Ÿ'));
        const saved = await fileStorage.saveProject(project, nodes, edges);
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges }));
        updateProjects((current) => current.map((item) => item.id === activeProjectId ? { ...item, ...saved } : item));
        if (!cancelled) setSaveStatus('saved');
      } catch {
        if (!cancelled) setSaveStatus('error');
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [nodes, edges, storageReady, activeProjectId, updateProjects, t]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(SHOPAIKEY_API_KEY, shopAIKey);
  }, [shopAIKey]);

  useEffect(() => {
    localStorage.setItem(LOCAL_PROJECT_ROOT_PATH_KEY, localProjectRootPath);
  }, [localProjectRootPath]);

  useEffect(() => {
    localStorage.removeItem('mergeboard-language-v1');
    document.documentElement.lang = 'en';
  }, []);

  const updateNode = useCallback((id, patch) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node));
  }, []);

  const generateImage = useCallback(async (id, { prompt = '', imageInputs = [], orientation = 'landscape' } = {}) => {
    const cleanPrompt = String(prompt || '').trim();
    const cleanApiKey = shopAIKey.trim();
    const imageOrientation = normalizeGenOrientation(orientation);
    if (!cleanApiKey) return showToast(t('Add ShopAIKey API key in Settings first', 'HÃ£y nháº­p ShopAIKey API key trong Settings trÆ°á»›c'), 'error');
    if (!cleanPrompt) return showToast(t('Connect text inputs to build the prompt first', 'HÃ£y káº¿t ná»‘i text input Ä‘á»ƒ táº¡o prompt trÆ°á»›c'), 'error');
    if (!imageInputs.length) return showToast(t('Connect at least one image input', 'HÃ£y káº¿t ná»‘i Ã­t nháº¥t 1 áº£nh input'), 'error');
    if (imageInputs.length > 4) return showToast(t('Gen Node supports at most 4 image inputs', 'Gen Node chá»‰ há»— trá»£ tá»‘i Ä‘a 4 áº£nh input'), 'error');
    const activeProject = projectsRef.current.find((item) => item.id === activeProjectId);
    if (!activeProject) return showToast(t('No active project found', 'KhÃ´ng tÃ¬m tháº¥y project Ä‘ang má»Ÿ'), 'error');

    updateNode(id, { isGenerating: true, generationError: '' });
    try {
      const images = await Promise.all(imageInputs.map((image, index) => imageUrlToNamedBlob(image.value, image.fileName || `input-${index + 1}.png`)));
      const generatedBlob = await callShopAIKeyImageEdit({
        apiKey: cleanApiKey,
        model: SHOPAIKEY_IMAGE_MODEL,
        prompt: cleanPrompt,
        images,
        size: GEN_IMAGE_SIZES[imageOrientation],
      });
      const uploaded = await fileStorage.uploadAsset(activeProject, generatedBlob, `gen-node-${Date.now()}.png`);
      const dimensions = await getImageSize(uploaded.url);
      updateNode(id, {
        image: uploaded.url,
        assetFile: uploaded.assetFile,
        fileName: uploaded.fileName,
        imageWidth: dimensions.width,
        imageHeight: dimensions.height,
        imageOrientation,
        generatedAt: new Date().toISOString(),
        isGenerating: false,
        generationError: '',
      });
      showToast(t('Image generated', 'ÄÃ£ táº¡o áº£nh'));
    } catch (error) {
      const message = error.message || t('Image generation failed', 'Táº¡o áº£nh tháº¥t báº¡i');
      updateNode(id, { isGenerating: false, generationError: message });
      showToast(message, 'error');
    }
  }, [activeProjectId, shopAIKey, showToast, t, updateNode]);

  const downloadGeneratedImage = useCallback(async (id) => {
    const node = nodes.find((item) => item.id === id);
    if (!node?.data?.image) return showToast(t('This Gen Node has no generated image yet', 'Gen Node nÃ y chÆ°a cÃ³ áº£nh Ä‘á»ƒ táº£i'), 'error');
    try {
      const response = await fetch(node.data.image);
      if (!response.ok) throw new Error(t('Could not read generated image', 'KhÃ´ng thá»ƒ Ä‘á»c áº£nh Ä‘Ã£ táº¡o'));
      const blob = await response.blob();
      await saveImageBlobAs(blob, node.data.fileName || `${node.data.title || 'gen-node'}.png`);
      showToast(t('Generated image saved', 'ÄÃ£ lÆ°u thÃªm áº£nh Ä‘Ã£ táº¡o'));
    } catch (error) {
      if (error.name === 'AbortError') return;
      showToast(error.message || t('Could not save generated image', 'KhÃ´ng thá»ƒ lÆ°u áº£nh Ä‘Ã£ táº¡o'), 'error');
    }
  }, [nodes, showToast, t]);

  const focusNode = useCallback((nodeId) => {
    const target = getNode(nodeId);
    if (!target) return showToast(t('Input node not found', 'KhÃ´ng tÃ¬m tháº¥y node input'), 'error');
    const position = target.positionAbsolute || target.position;
    const width = target.measured?.width || target.width || 300;
    const height = target.measured?.height || target.height || 180;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    setToolMode('select'); setContextMenu(null); setEdgeMenu(null);
    setCenter(position.x + width / 2, position.y + height / 2, { zoom: viewportZoom < 0.85 ? 1 : Math.min(viewportZoom, 1.2), duration: 650 });
    showToast(t(`Moved to â€œ${target.data?.title || 'input node'}â€`, `ÄÃ£ di chuyá»ƒn tá»›i â€œ${target.data?.title || 'node input'}â€`));
  }, [getNode, setCenter, showToast, viewportZoom, t]);

  const uploadImage = useCallback(async (id, file) => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'ChÆ°a chá»n project'));
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      const uploaded = await fileStorage.uploadAsset(project, file, file.name);
      updateNode(id, { image: uploaded.url, assetFile: uploaded.assetFile, fileName: uploaded.fileName });
      showToast(t('Image saved to the project folder', 'ÄÃ£ sao lÆ°u áº£nh vÃ o folder project'));
    } catch (error) {
      showToast(error.message || t('Could not save the image', 'KhÃ´ng thá»ƒ sao lÆ°u áº£nh'), 'error');
      throw error;
    }
  }, [showToast, updateNode, activeProjectId, t]);

  const uploadCarouselImage = useCallback(async (id, file) => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'ChÆ°a chá»n project'));
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      const uploaded = await fileStorage.uploadAsset(project, file, file.name);
      setNodes((current) => current.map((node) => {
        if (node.id !== id) return node;
        const images = Array.isArray(node.data?.images) ? node.data.images : [];
        return {
          ...node,
          data: {
            ...node.data,
            images: [...images, { id: `carousel-card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, image: uploaded.url, assetFile: uploaded.assetFile, fileName: uploaded.fileName }],
          },
        };
      }));
      showToast(t('Image added to Carousel Node'));
    } catch (error) {
      showToast(error.message || t('Could not save the image', 'KhÃ´ng thá»ƒ sao lÆ°u áº£nh'), 'error');
      throw error;
    }
  }, [activeProjectId, showToast, t]);

  const revealAsset = useCallback(async (assetFile) => {
    try {
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      await fileStorage.revealAsset(project, assetFile, localProjectRootPath);
    } catch (error) {
      showToast(error.message || t('Could not open the containing folder', 'Không thể mở folder chứa ảnh'), 'error');
    }
  }, [activeProjectId, localProjectRootPath, showToast, t]);

  const addCanvasImages = useCallback(async (files, clientPoint = null) => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'Chua ch?n project'));
      const imageFiles = files.filter((file) => file?.type?.startsWith('image/'));
      if (!imageFiles.length) return;
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      const center = screenToFlowPosition(clientPoint || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const columns = Math.min(3, Math.ceil(Math.sqrt(imageFiles.length)));
      const createdAt = Date.now();
      const createdNodes = await Promise.all(imageFiles.map(async (file, index) => {
        const dataUrl = await fileToDataUrl(file);
        const imageSize = await getImageSize(dataUrl);
        const fileName = file.name || `clipboard-image-${createdAt}-${index}.${file.type?.split('/')[1] || 'png'}`;
        const uploaded = await fileStorage.uploadAsset(project, file, fileName);
        const scale = Math.min(1, 420 / imageSize.width, 340 / imageSize.height);
        const width = Math.max(80, Math.round(imageSize.width * scale));
        const height = Math.max(60, Math.round(imageSize.height * scale));
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
          id: `canvasImageNode-${createdAt}-${index}`,
          type: 'canvasImageNode',
          position: {
            x: center.x - width / 2 + column * 460,
            y: center.y - height / 2 + row * 380,
          },
          data: { image: uploaded.url, assetFile: uploaded.assetFile, fileName: uploaded.fileName, width, height },
          selected: true,
        };
      }));
      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...createdNodes]);
      showToast(imageFiles.length === 1 ? t('Image pasted onto the canvas', 'Ðã dán ?nh vào canvas') : t(`${imageFiles.length} images pasted onto the canvas`, `Ðã dán ${imageFiles.length} ?nh vào canvas`));
    } catch (error) {
      showToast(error.message || t('Could not paste the image onto the canvas', 'Không th? dán ?nh vào canvas'), 'error');
    }
  }, [activeProjectId, screenToFlowPosition, showToast, t]);

  const addCanvasImage = useCallback((file, clientPoint = null) => addCanvasImages([file], clientPoint), [addCanvasImages]);
  const onCanvasImageDragOver = useCallback((event) => {
    const hasImage = [...(event.dataTransfer?.items || [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'))
      || [...(event.dataTransfer?.files || [])].some((file) => file.type.startsWith('image/'))
      || event.dataTransfer?.types?.includes('text/uri-list')
      || event.dataTransfer?.types?.includes('text/html');
    if (!hasImage) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onCanvasImageDrop = useCallback(async (event) => {
    if (event.target?.closest?.('.react-flow__node')) return;
    let files = [...(event.dataTransfer?.files || [])].filter((item) => item.type.startsWith('image/'));
    if (!files.length) {
      const html = event.dataTransfer?.getData('text/html');
      const sources = html
        ? [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')].map((image) => image.src).filter(Boolean)
        : event.dataTransfer?.getData('text/uri-list')?.split(/\r?\n/).filter((line) => line && !line.startsWith('#')) || [];
      files = (await Promise.all(sources.map(async (source, index) => {
        try {
          const blob = await (await fetch(source)).blob();
          return blob.type.startsWith('image/') ? new File([blob], `dropped-image-${Date.now()}-${index}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }) : null;
        } catch { return null; /* a remote image can be blocked by CORS */ }
      }))).filter(Boolean);
    }
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    await addCanvasImages(files, { x: event.clientX, y: event.clientY });
  }, [addCanvasImages]);

  const addTextNodeFromClipboard = useCallback((content) => {
    const value = String(content || '').trim();
    if (!value) return false;
    const id = `textNode-${Date.now()}`;
    const position = screenToFlowPosition({ x: window.innerWidth / 2 + 80, y: window.innerHeight / 2 });
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
      id,
      type: 'textNode',
      position,
      data: {
        title: t('Pasted Text', 'Text đã paste'),
        content: value,
        viewMode: 'expanded',
        color: '#3b82f6',
      },
      selected: true,
    }]);
    showToast(t('Text pasted as a new node', 'Đã paste text thành node mới'));
    return true;
  }, [screenToFlowPosition, showToast, t]);

  useEffect(() => {
    const onPaste = async (event) => {
      const editingTarget = event.target?.closest?.('input, textarea, [contenteditable="true"]');
      let files = [...(event.clipboardData?.files || [])].filter((item) => item.type.startsWith('image/'));
      if (!files.length) {
        files = [...(event.clipboardData?.items || [])]
          .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
          .map((item) => item.getAsFile())
          .filter(Boolean);
      }
      if (!files.length) {
        const html = event.clipboardData?.getData('text/html');
        const sources = html ? [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')].map((image) => image.src).filter(Boolean) : [];
        if (sources.length) {
          files = (await Promise.all(sources.map(async (source, index) => {
            try {
              const blob = await (await fetch(source)).blob();
              return blob.type.startsWith('image/') ? new File([blob], `web-image-${Date.now()}-${index}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type }) : null;
            } catch { return null; /* copied web image may be blocked by CORS */ }
          }))).filter(Boolean);
        }
      }
      if (!files.length) {
        if (editingTarget) return;
        const text = event.clipboardData?.getData('text/plain');
        const selectedCarouselNode = nodes.find((node) => node.selected && node.type === 'carouselNode');
        if (selectedCarouselNode && String(text || '').trim()) {
          event.preventDefault();
          updateNode(selectedCarouselNode.id, { content: String(text).trim() });
          showToast(t('Text pasted into the Carousel node'));
          return;
        }
        const selectedExampleNode = nodes.find((node) => node.selected && node.type === 'exampleNode');
        if (selectedExampleNode && String(text || '').trim()) {
          event.preventDefault();
          const exampleMode = selectedExampleNode.data?.exampleMode
            || (selectedExampleNode.data?.image ? 'image' : selectedExampleNode.data?.content?.trim() ? 'text' : '');
          if (exampleMode === 'image') {
            showToast(t('This Example node is locked to Image mode'), 'error');
            return;
          }
          updateNode(selectedExampleNode.id, {
            exampleMode: 'text',
            content: String(text).trim(),
            image: '',
            assetFile: '',
            fileName: '',
            imageWidth: 0,
            imageHeight: 0,
          });
          showToast(t('Text pasted into the Example node'));
          return;
        }
        if (addTextNodeFromClipboard(text)) event.preventDefault();
        return;
      }
      const selectedCarouselNode = nodes.find((node) => node.selected && node.type === 'carouselNode');
      if (editingTarget && !selectedCarouselNode) return;
      event.preventDefault();
      if (selectedCarouselNode) {
        await Promise.all(files.map((file) => uploadCarouselImage(selectedCarouselNode.id, file)));
        return;
      }
      const selectedExampleNode = nodes.find((node) => node.selected && node.type === 'exampleNode');
      if (selectedExampleNode) {
        const exampleMode = selectedExampleNode.data?.exampleMode
          || (selectedExampleNode.data?.image ? 'image' : selectedExampleNode.data?.content?.trim() ? 'text' : '');
        if (exampleMode === 'text') {
          showToast(t('This Example node is locked to Text mode'), 'error');
          return;
        }
        await uploadImage(selectedExampleNode.id, files[0]);
        updateNode(selectedExampleNode.id, { exampleMode: 'image', content: null });
        showToast(t('Image pasted into the Example node'));
        return;
      }
      const selectedImageNode = nodes.find((node) => node.selected && node.type === 'imageNode');
      if (selectedImageNode) await uploadImage(selectedImageNode.id, files[0]);
      else await addCanvasImages(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addCanvasImages, addTextNodeFromClipboard, nodes, showToast, t, updateNode, uploadCarouselImage, uploadImage]);

  const removeNode = useCallback((id) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => bridgeDeletedJoinPoints(nodes, current, [id]));
    showToast(t('Node deleted', 'ÄÃ£ xÃ³a node'));
  }, [nodes, showToast, t]);

  const removeEdge = useCallback((id) => {
    setEdges((current) => current.filter((edge) => edge.id !== id));
    setEdgeCutPoints((current) => { const next = { ...current }; delete next[id]; return next; });
    showToast(t('Connection removed', 'ÄÃ£ ngáº¯t káº¿t ná»‘i'));
  }, [showToast, t]);

  const copyResource = useCallback(async (value, kind) => {
    if (!value) return showToast(t('This resource is empty', 'TÃ i nguyÃªn Ä‘ang trá»‘ng'), 'error');
    try {
      if (kind === 'image' && window.ClipboardItem) {
        const blob = await (await fetch(value)).blob();
        const pngBlob = blob.type === 'image/png' ? blob : await convertImageToPng(value);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        showToast(t('Image copied to clipboard', 'ÄÃ£ copy áº£nh vÃ o clipboard'));
      } else {
        await navigator.clipboard.writeText(value);
        showToast(kind === 'image' ? t('Image URL copied', 'ÄÃ£ copy Ä‘Æ°á»ng dáº«n áº£nh') : t('Content copied', 'ÄÃ£ copy ná»™i dung'));
      }
    } catch {
      try {
        await navigator.clipboard.writeText(value);
        showToast(t('Resource copied', 'ÄÃ£ copy tÃ i nguyÃªn'));
      } catch { showToast(t('Clipboard access is not allowed', 'TrÃ¬nh duyá»‡t chÆ°a cho phÃ©p truy cáº­p clipboard'), 'error'); }
    }
  }, [showToast, t]);

  const onNodesChange = useCallback((changes) => {
    const deletedNodeIds = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    setNodes((current) => {
      if (deletedNodeIds.length) {
        setEdges((currentEdges) => bridgeDeletedJoinPoints(current, currentEdges, deletedNodeIds));
      }
      return applyNodeChanges(changes, current);
    });
  }, []);
  const onEdgesChange = useCallback((changes) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const setEdgeColor = useCallback((edgeId, color) => {
    setEdges((current) => current.map((edge) => edge.id === edgeId ? { ...edge, data: { ...(edge.data || {}), color } } : edge));
    setEdgeMenu(null);
    showToast(t('Connector color updated', 'ÄÃ£ Ä‘á»•i mÃ u dÃ¢y ná»‘i'));
  }, [showToast, t]);
  const connectNodes = useCallback((connection) => {
    const target = nodes.find((node) => node.id === connection.target);
    if (!['mixerNode', 'exampleNode', 'genNode', 'joinNode'].includes(target?.type)) return showToast(t('Only Mixer, Example, Gen Node, or Join Point can receive input', 'Chá»‰ Mixer, Example, Gen Node hoáº·c Join Point má»›i nháº­n Ä‘áº§u vÃ o'), 'error');
    if (connection.source === connection.target) return;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const collectSourceLineage = (nodeId, graphEdges, visited = new Set()) => {
      if (visited.has(nodeId)) return new Set();
      const sourceNode = nodeById.get(nodeId);
      if (!sourceNode) return new Set();
      if (['textNode', 'carouselNode', 'imageNode', 'exampleNode', 'genNode'].includes(sourceNode.type)) return new Set([sourceNode.id]);
      const nextVisited = new Set(visited).add(nodeId);
      const lineage = new Set();
      graphEdges.filter((edge) => edge.target === nodeId).forEach((edge) => {
        collectSourceLineage(edge.source, graphEdges, nextVisited).forEach((sourceId) => lineage.add(sourceId));
      });
      return lineage;
    };
    const findDuplicateInputs = (graphEdges) => {
      const duplicates = new Map();
      nodes.filter((node) => ['mixerNode', 'exampleNode', 'genNode', 'joinNode'].includes(node.type)).forEach((receiver) => {
        const seenSources = new Set();
        graphEdges.filter((edge) => edge.target === receiver.id).forEach((edge) => {
          collectSourceLineage(edge.source, graphEdges).forEach((sourceId) => {
            const signature = `${receiver.id}:${sourceId}`;
            if (seenSources.has(sourceId)) duplicates.set(signature, { receiverId: receiver.id, sourceId });
            seenSources.add(sourceId);
          });
        });
      });
      return duplicates;
    };
    const currentDuplicates = findDuplicateInputs(edges);
    const proposedDuplicates = findDuplicateInputs([...edges, { source: connection.source, target: connection.target }]);
    const newDuplicates = [...proposedDuplicates.entries()]
      .filter(([signature]) => !currentDuplicates.has(signature))
      .map(([, duplicate]) => duplicate);
    if (newDuplicates.length) {
      const duplicateNames = [...new Set(newDuplicates.map(({ sourceId }) => nodeById.get(sourceId)?.data?.title || 'Input'))].join(', ');
      const affectedNames = [...new Set(newDuplicates.map(({ receiverId }) => nodeById.get(receiverId)?.data?.title || t('receiver node', 'node nháº­n')))].join(', ');
      showToast(t(`Duplicate input: ${duplicateNames} at ${affectedNames}`, `Bá»‹ trÃ¹ng input: ${duplicateNames} táº¡i ${affectedNames}`), 'error');
      return false;
    }
    const alreadyConnected = edges.some((edge) => (
      (edge.source === connection.source && edge.target === connection.target)
      || (edge.source === connection.target && edge.target === connection.source)
    ));
    if (alreadyConnected) {
      showToast(t('These nodes are already connected Â· only one connector is allowed', 'Hai node nÃ y Ä‘Ã£ cÃ³ connector Â· chá»‰ cho phÃ©p tá»‘i Ä‘a 1 dÃ¢y'), 'error');
      return false;
    }
    const createsCycle = (start, sought, visited = new Set()) => {
      if (start === sought) return true;
      if (visited.has(start)) return false;
      visited.add(start);
      return edges.filter((edge) => edge.source === start).some((edge) => createsCycle(edge.target, sought, visited));
    };
    if (createsCycle(connection.target, connection.source)) return showToast(t('A loop cannot be created between nodes', 'KhÃ´ng thá»ƒ táº¡o vÃ²ng láº·p giá»¯a cÃ¡c node'), 'error');
    const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setEdges((current) => addEdge({
      ...connection,
      id: edgeId,
      sourceHandle: `out-${edgeId}`,
      targetHandle: `in-${edgeId}`,
      type: 'beam',
      data: { color: 'gradient' },
    }, current));
    showToast(target.type === 'exampleNode' ? t('Connected to Example Node', 'ÄÃ£ káº¿t ná»‘i vÃ o Node Example') : target.type === 'genNode' ? t('Connected to Gen Node', 'ÄÃ£ káº¿t ná»‘i vÃ o Gen Node') : target.type === 'joinNode' ? t('Connected to Join Point', 'ÄÃ£ káº¿t ná»‘i vÃ o Join Point') : t('Connected to Mixer', 'ÄÃ£ káº¿t ná»‘i vÃ o Mixer'));
    return true;
  }, [nodes, edges, showToast, t]);

  const onConnect = useCallback((connection) => {
    connectionCompletedRef.current = Boolean(connectNodes(connection));
  }, [connectNodes]);

  const onConnectStart = useCallback((_event, params) => {
    connectionCompletedRef.current = false;
    connectionStartRef.current = params.handleType === 'source'
      ? { source: params.nodeId, sourceHandle: params.handleId }
      : null;
  }, []);

  const onConnectEnd = useCallback((event) => {
    const start = connectionStartRef.current;
    connectionStartRef.current = null;
    if (!start || connectionCompletedRef.current) return;
    const pointer = event.changedTouches?.[0] || event.touches?.[0] || event;
    if (!Number.isFinite(pointer.clientX) || !Number.isFinite(pointer.clientY)) return;
    const targetElement = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest?.('.react-flow__node');
    const targetId = targetElement?.getAttribute('data-id');
    if (!targetId) return;
    connectNodes({ ...start, target: targetId, targetHandle: 'target-new' });
  }, [connectNodes]);

  const addNode = useCallback((type, requestedPosition = null) => {
    const id = `${type}-${Date.now()}`;
    const basePosition = requestedPosition || screenToFlowPosition({ x: window.innerWidth / 2 + 80, y: window.innerHeight / 2 });
    const position = type === 'joinNode' ? { x: basePosition.x - 22, y: basePosition.y - 22 } : basePosition;
    const defaults = {
      textNode: { title: t('New Text', 'Text má»›i'), content: '', viewMode: 'expanded', color: '#3b82f6' },
      carouselNode: { title: t('New Carousel'), content: '', images: [], viewMode: 'expanded', color: '#06b6d4' },
      imageNode: { title: t('New Image', 'áº¢nh má»›i'), image: '', fileName: '', viewMode: 'expanded', color: '#f59e0b' },
      mixerNode: { title: t('New Mixer', 'Mixer má»›i'), viewMode: 'expanded', color: '#7c6cf2' },
      exampleNode: { title: t('Example Node'), exampleMode: '', image: '', fileName: '', content: '', viewMode: 'expanded', color: '#10b981' },
      genNode: { title: t('Gen Node'), image: '', fileName: '', viewMode: 'expanded', color: '#a855f7', imageOrientation: 'landscape' },
      joinNode: { color: '#8b7cf6' },
    };
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { id, type, position, data: defaults[type], selected: true }]);
    setContextMenu(null);
    const label = type === 'textNode' ? 'Text' : type === 'carouselNode' ? 'Carousel' : type === 'imageNode' ? 'Image' : type === 'mixerNode' ? 'Mixer' : type === 'genNode' ? 'Gen Node' : type === 'joinNode' ? 'Join Point' : t('Example Node');
    showToast(t(`Added ${label}`, `ÄÃ£ thÃªm ${label}`));
  }, [screenToFlowPosition, showToast, t]);

  const duplicateSelected = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    if (!selectedNodes.length) {
      showToast(t('Select at least one node before duplicating', 'HÃ£y chá»n node trÆ°á»›c khi nhÃ¢n báº£n'), 'error');
      return;
    }
    const timestamp = Date.now();
    const delta = duplicateDeltaRef.current;
    const copies = selectedNodes.map((node, index) => ({
      ...node,
      id: `${node.type}-${timestamp}-${index}`,
      position: { x: node.position.x + delta.x, y: node.position.y + delta.y },
      selected: true,
      data: { ...node.data, title: `${node.data.title || 'Node'} · ${t('copy')}` },
    }));
    pendingDuplicateRef.current = {
      pairs: selectedNodes.map((node, index) => ({
        sourceId: node.id,
        copyId: copies[index].id,
        sourcePosition: { x: node.position.x, y: node.position.y },
      })),
    };
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    showToast(t(`Duplicated ${copies.length} node(s)`, `ÄÃ£ nhÃ¢n báº£n ${copies.length} node`));
  }, [nodes, showToast, t]);

  const rememberDuplicateSpacing = useCallback((_event, node, draggedNodes = []) => {
    if (node.id === movableJoinId) setMovableJoinId(null);
    const pending = pendingDuplicateRef.current;
    if (!pending?.pairs?.length) return;
    const draggedList = Array.isArray(draggedNodes) && draggedNodes.length ? draggedNodes : [node];
    const draggedIds = new Set(draggedList.map((item) => item.id));
    if (!pending.pairs.some((pair) => draggedIds.has(pair.copyId))) return;
    const currentPositions = new Map(nodes.map((item) => [item.id, item.position]));
    draggedList.forEach((item) => currentPositions.set(item.id, item.position));
    const deltas = pending.pairs
      .map((pair) => {
        const position = currentPositions.get(pair.copyId);
        if (!position) return null;
        return {
          x: position.x - pair.sourcePosition.x,
          y: position.y - pair.sourcePosition.y,
        };
      })
      .filter(Boolean);
    if (!deltas.length) return;
    const average = deltas.reduce((sum, delta) => ({ x: sum.x + delta.x, y: sum.y + delta.y }), { x: 0, y: 0 });
    duplicateDeltaRef.current = {
      x: Math.round((average.x / deltas.length) * 100) / 100,
      y: Math.round((average.y / deltas.length) * 100) / 100,
    };
  }, [movableJoinId, nodes]);

  const beginNodeRoutingDrag = useCallback((_event, node) => {
    const selectedIds = nodes.filter((item) => item.selected).map((item) => item.id);
    setRoutingDragNodeIds(selectedIds.includes(node.id) ? selectedIds : [node.id]);
  }, [nodes]);

  const finishNodeRoutingDrag = useCallback((event, node, draggedNodes = []) => {
    rememberDuplicateSpacing(event, node, draggedNodes);
    setRoutingDragNodeIds([]);
  }, [rememberDuplicateSpacing]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { setContextMenu(null); setEdgeMenu(null); setJoinMenu(null); setCanvasImageMenu(null); setMovableJoinId(null); }
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoGraph(); else undoGraph();
        return;
      }
      if (modifier && key === 'y') {
        event.preventDefault();
        redoGraph();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'v') {
        event.preventDefault(); setToolMode('select'); setSectionDraft(null); return;
      }
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault(); setToolMode('section'); setContextMenu(null); setEdgeMenu(null); return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'd') return;
      event.preventDefault();
      duplicateSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [duplicateSelected, redoGraph, undoGraph]);

  const openCanvasMenu = useCallback((event) => {
    event.preventDefault();
    setEdgeMenu(null);
    setJoinMenu(null);
    setCanvasImageMenu(null);
    const menuWidth = 188;
    const menuHeight = 268;
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 10),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 10),
      flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [screenToFlowPosition]);

  const beginSection = useCallback((event) => {
    if (event.button !== 0 || toolMode !== 'section') return;
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setSectionDraft({
      startClient: { x: event.clientX, y: event.clientY },
      startLocal: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      currentLocal: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      startFlow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [screenToFlowPosition, toolMode]);

  const moveSection = useCallback((event) => {
    if (!sectionDraft) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSectionDraft((current) => current ? { ...current, currentLocal: { x: event.clientX - rect.left, y: event.clientY - rect.top } } : null);
  }, [sectionDraft]);

  const finishSection = useCallback((event) => {
    if (!sectionDraft) return;
    const endFlow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const clientWidth = Math.abs(event.clientX - sectionDraft.startClient.x);
    const clientHeight = Math.abs(event.clientY - sectionDraft.startClient.y);
    setSectionDraft(null);
    if (clientWidth < 70 || clientHeight < 50) return showToast(t('Drag a larger area to create a Section', 'KÃ©o má»™t vÃ¹ng lá»›n hÆ¡n Ä‘á»ƒ táº¡o Section'), 'error');
    const id = `sectionNode-${Date.now()}`;
    const color = NODE_COLORS[nodes.filter((node) => node.type === 'sectionNode').length % NODE_COLORS.length];
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
      id,
      type: 'sectionNode',
      position: { x: Math.min(sectionDraft.startFlow.x, endFlow.x), y: Math.min(sectionDraft.startFlow.y, endFlow.y) },
      data: {
        title: `Section ${current.filter((node) => node.type === 'sectionNode').length + 1}`,
        color,
        width: Math.abs(endFlow.x - sectionDraft.startFlow.x),
        height: Math.abs(endFlow.y - sectionDraft.startFlow.y),
        opacity: 0.2,
      },
      selected: true,
    }]);
    showToast(t('Section Group created Â· press V to return to Select', 'ÄÃ£ táº¡o Section Group Â· nháº¥n V Ä‘á»ƒ quay láº¡i Select'));
  }, [nodes, screenToFlowPosition, sectionDraft, showToast, t]);

  const openEdgeMenu = useCallback((event, edge) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setJoinMenu(null);
    setCanvasImageMenu(null);
    setEdgeMenu({
      x: Math.min(event.clientX, window.innerWidth - 190),
      y: Math.min(event.clientY, window.innerHeight - 155),
      edgeId: edge.id,
      color: edge.data?.color || 'gradient',
      edge: { source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null },
      flowPosition: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    });
  }, [screenToFlowPosition]);

  const openJoinMenu = useCallback((event, node) => {
    if (!['joinNode', 'mixerNode', 'exampleNode', 'genNode', 'textNode', 'canvasImageNode'].includes(node.type)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setEdgeMenu(null);
    if (node.type === 'canvasImageNode') {
      const nodeIds = node.selected && selectedCanvasImageIds.length
        ? selectedCanvasImageIds
        : [node.id];
      setJoinMenu(null);
      setCanvasImageMenu({
        nodeId: node.id,
        nodeIds,
        x: Math.min(event.clientX, window.innerWidth - 198),
        y: Math.min(event.clientY, window.innerHeight - 92),
      });
      return;
    }
    setCanvasImageMenu(null);
    setJoinMenu({
      nodeId: node.id,
      nodeType: node.type,
      color: node.data?.color || '#8b7cf6',
      paletteOpen: false,
      x: Math.min(event.clientX, window.innerWidth - 198),
      y: Math.min(event.clientY, window.innerHeight - (node.type === 'joinNode' ? 300 : 148)),
    });
  }, [selectedCanvasImageIds]);

  const enableJoinMove = useCallback(() => {
    if (!joinMenu?.nodeId) return;
    setMovableJoinId(joinMenu.nodeId);
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === joinMenu.nodeId })));
    setJoinMenu(null);
    showToast(t('Drag the Join Point to a new position', 'KÃ©o Join Point tá»›i vá»‹ trÃ­ má»›i'));
  }, [joinMenu, showToast, t]);

  const setJoinPointColor = useCallback((color) => {
    if (!joinMenu?.nodeId) return;
    updateNode(joinMenu.nodeId, { color });
    setJoinMenu(null);
    showToast(t('Join Point color updated', 'ÄÃ£ Ä‘á»•i mÃ u Join Point'));
  }, [joinMenu, showToast, updateNode, t]);

  const convertMixerToJoin = useCallback(() => {
    if (!joinMenu?.nodeId || joinMenu.nodeType !== 'mixerNode') return;
    const layout = renderedNodeLayoutById.get(joinMenu.nodeId);
    setNodes((current) => current.map((node) => {
      if (node.id !== joinMenu.nodeId) return node;
      const { measured: _measured, width: _width, height: _height, ...baseNode } = node;
      const currentWidth = layout?.width || node.measured?.width || 322;
      const currentHeight = layout?.height || node.measured?.height || 180;
      return {
        ...baseNode,
        type: 'joinNode',
        position: {
          x: node.position.x + (currentWidth - 44) / 2,
          y: node.position.y + (currentHeight - 44) / 2,
        },
        data: { ...node.data, color: node.data?.color || '#7c6cf2' },
        selected: true,
      };
    }));
    setEdges((current) => current.map((edge) => ({
      ...edge,
      sourceHandle: edge.source === joinMenu.nodeId ? 'join-out' : edge.sourceHandle,
      targetHandle: edge.target === joinMenu.nodeId ? 'join-in' : edge.targetHandle,
    })));
    routeCacheRef.current.clear();
    setJoinMenu(null);
    showToast(t('Mixer converted to Join Point'));
  }, [joinMenu, renderedNodeLayoutById, showToast, t]);

  const convertJoinToMixer = useCallback(() => {
    if (!joinMenu?.nodeId || joinMenu.nodeType !== 'joinNode') return;
    const layout = renderedNodeLayoutById.get(joinMenu.nodeId);
    setNodes((current) => current.map((node) => {
      if (node.id !== joinMenu.nodeId) return node;
      const { measured: _measured, width: _width, height: _height, ...baseNode } = node;
      const currentWidth = layout?.width || node.measured?.width || 44;
      const currentHeight = layout?.height || node.measured?.height || 44;
      return {
        ...baseNode,
        type: 'mixerNode',
        position: {
          x: node.position.x + (currentWidth - 322) / 2,
          y: node.position.y + (currentHeight - 160) / 2,
        },
        data: {
          ...node.data,
          title: node.data?.title || t('Mixer'),
          viewMode: node.data?.viewMode || 'expanded',
          color: node.data?.color || '#7c6cf2',
        },
        selected: true,
      };
    }));
    setEdges((current) => current.map((edge) => ({
      ...edge,
      sourceHandle: edge.source === joinMenu.nodeId ? `out-${edge.id}` : edge.sourceHandle,
      targetHandle: edge.target === joinMenu.nodeId ? `in-${edge.id}` : edge.targetHandle,
    })));
    setMovableJoinId((current) => current === joinMenu.nodeId ? null : current);
    routeCacheRef.current.clear();
    setJoinMenu(null);
    showToast(t('Join Point converted to Mixer'));
  }, [joinMenu, renderedNodeLayoutById, showToast, t]);

  const convertTextToCarousel = useCallback(() => {
    if (!joinMenu?.nodeId || joinMenu.nodeType !== 'textNode') return;
    setNodes((current) => current.map((node) => {
      if (node.id !== joinMenu.nodeId) return node;
      return {
        ...node,
        type: 'carouselNode',
        data: {
          ...node.data,
          images: Array.isArray(node.data?.images) ? node.data.images : [],
          viewMode: node.data?.viewMode || 'expanded',
          color: node.data?.color || '#06b6d4',
        },
        selected: true,
      };
    }));
    routeCacheRef.current.clear();
    setJoinMenu(null);
    showToast(t('Text Node converted to Carousel Node'));
  }, [joinMenu, showToast, t]);

  const makeCanvasImageNode = useCallback((targetType = 'imageNode') => {
    const targetIds = canvasImageMenu?.nodeIds?.length
      ? canvasImageMenu.nodeIds
      : canvasImageMenu?.nodeId
        ? [canvasImageMenu.nodeId]
        : selectedCanvasImageIds;
    if (!targetIds.length) return;
    const targetIdSet = new Set(targetIds);
    setNodes((current) => current.map((node) => {
      if (!targetIdSet.has(node.id) || node.type !== 'canvasImageNode') return node;
      const { width: _width, height: _height, measured: _measured, ...baseNode } = node;
      const title = (node.data.fileName || t('Image', 'áº¢nh')).replace(/\.[^.]+$/, '');
      if (targetType === 'exampleNode') {
        return {
          ...baseNode,
          type: 'exampleNode',
          data: {
            title,
            exampleMode: 'image',
            image: node.data.image,
            assetFile: node.data.assetFile,
            fileName: node.data.fileName,
            content: null,
            viewMode: 'expanded',
            color: '#10b981',
          },
          selected: true,
        };
      }
      return {
        ...baseNode,
        type: 'imageNode',
        data: {
          title,
          image: node.data.image,
          assetFile: node.data.assetFile,
          fileName: node.data.fileName,
          viewMode: 'expanded',
          color: '#f59e0b',
        },
        selected: true,
      };
    }));
    setContextMenu(null);
    setCanvasImageMenu(null);
    const nodeLabel = targetType === 'exampleNode' ? 'Example Node' : 'Image Node';
    showToast(targetIds.length === 1
      ? t(`Image converted to an ${nodeLabel}`)
      : t(`${targetIds.length} images converted to ${nodeLabel}s`));
  }, [canvasImageMenu, selectedCanvasImageIds, showToast, t]);

  const connectSelectedToNode = useCallback((targetId) => {
    const targetNode = nodes.find((node) => node.id === targetId);
    if (!['mixerNode', 'exampleNode', 'genNode', 'joinNode'].includes(targetNode?.type)) return;
    const sourceIds = selectedBatchInputIds.filter((id) => id !== targetId);
    if (!sourceIds.length) {
      showToast(t('Select one or more input nodes first'), 'error');
      return;
    }

    const convertedCanvasIds = new Set();
    const nextNodes = nodes.map((node) => {
      if (!sourceIds.includes(node.id) || node.type !== 'canvasImageNode') return node;
      convertedCanvasIds.add(node.id);
      const { width: _width, height: _height, measured: _measured, ...baseNode } = node;
      const title = (node.data.fileName || t('Image', 'áº¢nh')).replace(/\.[^.]+$/, '');
      return {
        ...baseNode,
        type: 'imageNode',
        data: {
          title,
          image: node.data.image,
          assetFile: node.data.assetFile,
          fileName: node.data.fileName,
          viewMode: 'expanded',
          color: '#f59e0b',
        },
        selected: true,
      };
    });
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));
    const collectSourceLineage = (nodeId, graphEdges, visited = new Set()) => {
      if (visited.has(nodeId)) return new Set();
      const sourceNode = nodeById.get(nodeId);
      if (!sourceNode) return new Set();
      if (['textNode', 'carouselNode', 'imageNode', 'exampleNode', 'genNode'].includes(sourceNode.type)) return new Set([sourceNode.id]);
      const nextVisited = new Set(visited).add(nodeId);
      const lineage = new Set();
      graphEdges.filter((edge) => edge.target === nodeId).forEach((edge) => {
        collectSourceLineage(edge.source, graphEdges, nextVisited).forEach((sourceId) => lineage.add(sourceId));
      });
      return lineage;
    };
    const findDuplicateInputs = (graphEdges) => {
      const duplicates = new Map();
      nextNodes.filter((node) => ['mixerNode', 'exampleNode', 'genNode', 'joinNode'].includes(node.type)).forEach((receiver) => {
        const seenSources = new Set();
        graphEdges.filter((edge) => edge.target === receiver.id).forEach((edge) => {
          collectSourceLineage(edge.source, graphEdges).forEach((sourceId) => {
            const signature = `${receiver.id}:${sourceId}`;
            if (seenSources.has(sourceId)) duplicates.set(signature, { receiverId: receiver.id, sourceId });
            seenSources.add(sourceId);
          });
        });
      });
      return duplicates;
    };
    const createsCycle = (graphEdges, start, sought, visited = new Set()) => {
      if (start === sought) return true;
      if (visited.has(start)) return false;
      visited.add(start);
      return graphEdges.filter((edge) => edge.source === start).some((edge) => createsCycle(graphEdges, edge.target, sought, visited));
    };

    let nextEdges = edges;
    let connectedCount = 0;
    let skippedCount = 0;
    sourceIds.forEach((sourceId, index) => {
      const sourceNode = nodeById.get(sourceId);
      if (!['textNode', 'carouselNode', 'imageNode', 'exampleNode', 'genNode'].includes(sourceNode?.type)) {
        skippedCount += 1;
        return;
      }
      const alreadyConnected = nextEdges.some((edge) => (
        (edge.source === sourceId && edge.target === targetId)
        || (edge.source === targetId && edge.target === sourceId)
      ));
      if (alreadyConnected || createsCycle(nextEdges, targetId, sourceId)) {
        skippedCount += 1;
        return;
      }
      const currentDuplicates = findDuplicateInputs(nextEdges);
      const proposedConnection = { source: sourceId, target: targetId };
      const proposedDuplicates = findDuplicateInputs([...nextEdges, proposedConnection]);
      const hasNewDuplicate = [...proposedDuplicates.keys()].some((signature) => !currentDuplicates.has(signature));
      if (hasNewDuplicate) {
        skippedCount += 1;
        return;
      }
      const edgeId = `edge-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
      nextEdges = addEdge({
        id: edgeId,
        source: sourceId,
        target: targetId,
        sourceHandle: `out-${edgeId}`,
        targetHandle: `in-${edgeId}`,
        type: 'beam',
        data: { color: 'gradient' },
      }, nextEdges);
      connectedCount += 1;
    });

    if (!connectedCount) {
      showToast(t('No selected inputs could be connected'), 'error');
      return;
    }
    setNodes(nextNodes);
    setEdges(nextEdges);
    setContextMenu(null);
    setJoinMenu(null);
    setCanvasImageMenu(null);
    const convertedText = convertedCanvasIds.size ? ` · ${convertedCanvasIds.size} canvas image(s) converted` : '';
    showToast(t(`Connected ${connectedCount} input(s)${convertedText}${skippedCount ? ` · ${skippedCount} skipped` : ''}`));
  }, [edges, nodes, selectedBatchInputIds, showToast, t]);

  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation();
    setEdgeMenu(null);
    setCanvasImageMenu(null);
    const clickPoint = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const edgeGroup = event.target.closest?.('.react-flow__edge');
    const pathElement = edgeGroup?.querySelector('.react-flow__edge-path');
    const cutPoint = offsetPointOnEdgePath(pathElement, clickPoint, 54, viewportZoom);
    setEdgeCutPoints((current) => ({ ...current, [edge.id]: cutPoint }));
  }, [screenToFlowPosition, viewportZoom]);

  const createJoinPoint = useCallback(() => {
    if (!edgeMenu?.edge) return;
    const joinId = `joinNode-${Date.now()}`;
    const edgeColor = edgeMenu.color || 'gradient';
    const { source, target, sourceHandle, targetHandle } = edgeMenu.edge;
    const joinColor = edgeColor === 'gradient' ? (nodes.find((node) => node.id === source)?.data?.color || '#8b7cf6') : edgeColor;
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
      id: joinId,
      type: 'joinNode',
      position: { x: edgeMenu.flowPosition.x - 18, y: edgeMenu.flowPosition.y - 18 },
      data: { title: 'Join Point', color: joinColor },
      selected: true,
    }]);
    setEdges((current) => [
      ...current.filter((edge) => edge.id !== edgeMenu.edgeId),
      { id: `${edgeMenu.edgeId}-in-${joinId}`, source, target: joinId, sourceHandle, targetHandle: null, type: 'beam', data: { color: edgeColor } },
      { id: `${edgeMenu.edgeId}-out-${joinId}`, source: joinId, target, sourceHandle: null, targetHandle, type: 'beam', data: { color: edgeColor } },
    ]);
    setEdgeMenu(null);
    showToast(t('Join Point created on the connector', 'ÄÃ£ táº¡o Join Point trÃªn dÃ¢y ná»‘i'));
  }, [edgeMenu, nodes, showToast, t]);

  const resetProject = useCallback(async () => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'ChÆ°a chá»n project'));
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      const restoredNodes = await Promise.all(initialNodes.map(async (node) => {
        if (node.type !== 'imageNode' || !node.data?.image?.startsWith('data:')) return node;
        const blob = await dataUrlToBlob(node.data.image);
        const uploaded = await fileStorage.uploadAsset(project, blob, node.data.fileName || 'image');
        return { ...node, data: { ...node.data, image: uploaded.url, assetFile: uploaded.assetFile, fileName: uploaded.fileName } };
      }));
      setNodes(restoredNodes);
      setEdges(initialEdges.map((edge) => ({ ...edge, data: { ...edge.data } })));
      localStorage.removeItem(STORAGE_KEY);
      showToast(t('Base Template restored and saved', 'ÄÃ£ táº¡o vÃ  sao lÆ°u Base Template'));
      setTimeout(() => fitView({ padding: 0.18, duration: 600 }), 80);
    } catch (error) {
      showToast(error.message || t('Could not restore the project', 'KhÃ´ng thá»ƒ khÃ´i phá»¥c project'), 'error');
    }
  }, [fitView, showToast, activeProjectId, t]);

  const selectProject = useCallback(async (projectId) => {
    if (projectId === activeProjectId) return;
    try {
      if (activeProjectId && storageReady) {
        const current = projectsRef.current.find((item) => item.id === activeProjectId);
        await fileStorage.saveProject(current, nodes, edges);
      }
      await loadProjectById(projectId);
      showToast(t('Project switched', 'ÄÃ£ chuyá»ƒn project'));
    } catch (error) { showToast(error.message || t('Could not switch projects', 'KhÃ´ng thá»ƒ chuyá»ƒn project'), 'error'); setStorageReady(true); }
  }, [activeProjectId, storageReady, nodes, edges, loadProjectById, showToast, t]);

  const createProject = useCallback(async (name) => {
    try {
      if (activeProjectId && storageReady) {
        const current = projectsRef.current.find((item) => item.id === activeProjectId);
        await fileStorage.saveProject(current, nodes, edges);
      }
      const project = await fileStorage.createProject(name, projectsRef.current);
      const nextProjects = [...projectsRef.current, project];
      projectsRef.current = nextProjects;
      setProjects(nextProjects);
      await fileStorage.saveProjectOrder(nextProjects.map((item) => item.id));
      await loadProjectById(project.id);
      showToast(t(`Project â€œ${project.name}â€ created`, `ÄÃ£ táº¡o project â€œ${project.name}â€`));
    } catch (error) { showToast(error.message || t('Could not create the project', 'KhÃ´ng thá»ƒ táº¡o project'), 'error'); }
  }, [activeProjectId, storageReady, nodes, edges, loadProjectById, showToast, t]);

  const renameProject = useCallback(async (projectId, name) => {
    try {
      const project = projectsRef.current.find((item) => item.id === projectId);
      const updated = await fileStorage.renameProject(project, name, projectsRef.current);
      updateProjects((current) => current.map((item) => item.id === projectId ? updated : item));
      showToast(t('Project and folder renamed', 'ÄÃ£ Ä‘á»•i tÃªn project vÃ  folder'));
    } catch (error) { showToast(error.message || t('Could not rename the project', 'KhÃ´ng thá»ƒ Ä‘á»•i tÃªn'), 'error'); }
  }, [showToast, updateProjects, t]);

  const deleteProject = useCallback(async (projectId) => {
    try {
      if (projects.length <= 1) throw new Error(t('At least one project must remain', 'Pháº£i giá»¯ láº¡i Ã­t nháº¥t má»™t project'));
      const project = projects.find((item) => item.id === projectId);
      await fileStorage.deleteProject(project);
      const remaining = projects.filter((project) => project.id !== projectId);
      projectsRef.current = remaining;
      setProjects(remaining);
      await fileStorage.saveProjectOrder(remaining.map((item) => item.id));
      if (projectId === activeProjectId && remaining[0]) await loadProjectById(remaining[0].id);
      showToast(t('Project and its resource folder deleted', 'ÄÃ£ xÃ³a project vÃ  toÃ n bá»™ folder tÃ i nguyÃªn'));
    } catch (error) { showToast(error.message || t('Could not delete the project', 'KhÃ´ng thá»ƒ xÃ³a project'), 'error'); }
  }, [projects, activeProjectId, loadProjectById, showToast, t]);

  const reorderProjects = useCallback(async (orderedProjects) => {
    projectsRef.current = orderedProjects;
    setProjects(orderedProjects);
    try {
      await fileStorage.saveProjectOrder(orderedProjects.map((project) => project.id));
      showToast(t('Project order saved', 'Ã„ÂÃƒÂ£ lÃ†Â°u thÃ¡Â»Â© tÃ¡Â»Â± project'));
    } catch (error) {
      showToast(error.message || t('Could not save project order', 'KhÃƒÂ´ng thÃ¡Â»Æ’ lÃ†Â°u thÃ¡Â»Â© tÃ¡Â»Â± project'), 'error');
    }
  }, [showToast, t]);

  const displayNodes = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const getNodeCenterY = (nodeId) => {
      const linkedNode = nodeById.get(nodeId);
      if (!linkedNode) return 0;
      const renderedNode = renderedNodeLayoutById.get(nodeId);
      return (renderedNode?.y ?? linkedNode.position?.y ?? 0) + (renderedNode?.height || linkedNode.measured?.height || linkedNode.height || 0) / 2;
    };

    const collectResources = (mixerId, visited = new Set()) => {
      if (visited.has(mixerId)) return [];
      const nextVisited = new Set(visited).add(mixerId);
      return edges.filter((edge) => edge.target === mixerId).flatMap((edge) => {
        const source = nodeById.get(edge.source);
        if (!source) return [];
        if (source.type === 'textNode' || source.type === 'carouselNode') {
          return [{ sourceId: source.id, kind: 'text', title: source.data.title, value: source.data.content, sourceColor: source.data.color }];
        }
        if (source.type === 'imageNode') {
          return source.data.image
            ? [{ sourceId: source.id, kind: 'image', title: source.data.title, value: source.data.image, sourceColor: source.data.color, imageWidth: source.data.imageWidth, imageHeight: source.data.imageHeight, fileName: source.data.fileName }]
            : [];
        }
        if (source.type === 'exampleNode') {
          const exampleResources = [];
          const sourceMode = source.data.exampleMode || (source.data.image ? 'image' : source.data.content?.trim() ? 'text' : '');
          if (sourceMode === 'image' && source.data.image) exampleResources.push({ sourceId: source.id, kind: 'image', title: source.data.title, value: source.data.image, sourceColor: source.data.color, imageWidth: source.data.imageWidth, imageHeight: source.data.imageHeight, fileName: source.data.fileName });
          if (sourceMode === 'text' && source.data.content?.trim()) exampleResources.push({ sourceId: source.id, kind: 'text', title: source.data.title, value: source.data.content, sourceColor: source.data.color });
          return exampleResources;
        }
        if (source.type === 'genNode') {
          return source.data.image
            ? [{ sourceId: source.id, kind: 'image', title: source.data.title, value: source.data.image, sourceColor: source.data.color, imageWidth: source.data.imageWidth, imageHeight: source.data.imageHeight, fileName: source.data.fileName }]
            : [];
        }
        if (['mixerNode', 'joinNode'].includes(source.type)) return collectResources(source.id, nextVisited);
        return [];
      });
    };

    const collectInputNodes = (targetId, visited = new Set()) => {
      if (visited.has(targetId)) return [];
      const nextVisited = new Set(visited).add(targetId);
      return edges.filter((edge) => edge.target === targetId).flatMap((edge) => {
        const source = nodeById.get(edge.source);
        if (!source) return [];
        if (source.type === 'textNode' || source.type === 'carouselNode') return [{ id: source.id, kind: 'text', title: source.data.title }];
        if (source.type === 'imageNode') return [{ id: source.id, kind: 'image', title: source.data.title, previewImage: source.data.image || '' }];
        if (source.type === 'exampleNode') return [{ id: source.id, kind: 'example', title: source.data.title, previewImage: source.data.image || '' }];
        if (source.type === 'genNode') return [{ id: source.id, kind: 'image', title: source.data.title, previewImage: source.data.image || '' }];
        if (['mixerNode', 'joinNode'].includes(source.type)) return collectInputNodes(source.id, nextVisited);
        return [];
      });
    };

    return nodes.map((node) => {
      const inputPorts = edges
        .filter((edge) => edge.target === node.id)
        .map((edge) => ({ id: edge.targetHandle || `in-${edge.id}`, color: (edge.data?.color || 'gradient') === 'gradient' ? (node.data?.color || NODE_COLORS[0]) : edge.data.color, orderY: getNodeCenterY(edge.source) }))
        .sort((a, b) => a.orderY - b.orderY || a.id.localeCompare(b.id));
      const outputPorts = edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => ({ id: edge.sourceHandle || `out-${edge.id}`, color: (edge.data?.color || 'gradient') === 'gradient' ? (node.data?.color || NODE_COLORS[0]) : edge.data.color, orderY: getNodeCenterY(edge.target) }))
        .sort((a, b) => a.orderY - b.orderY || a.id.localeCompare(b.id));
      const nodeData = { ...node.data, inputPorts, outputPorts, moveEnabled: node.id === movableJoinId, joinReversed: joinReversedById.get(node.id) || false };
      if (node.type === 'sectionNode') return { ...node, zIndex: -1000, data: { ...node.data, zoom: viewportZoom } };
      if (node.type === 'exampleNode') {
        const collected = collectInputNodes(node.id);
        const inputTitles = sortInputTitles(collected.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
        return { ...node, data: { ...nodeData, inputTitles } };
      }
      if (node.type === 'genNode') {
        const collectedInputs = collectInputNodes(node.id);
        const inputTitles = sortInputTitles(collectedInputs.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
        const collected = collectResources(node.id);
        const unique = collected.filter((resource, index, all) => all.findIndex((item) => item.sourceId === resource.sourceId && item.kind === resource.kind) === index);
        const textInputs = unique.filter((resource) => resource.kind === 'text' && resource.value?.trim()).sort(compareByInputTitle);
        const imageInputs = unique.filter((resource) => resource.kind === 'image' && resource.value).sort(compareByInputTitle);
        return { ...node, data: { ...nodeData, inputTitles, promptText: textInputs.map((resource) => resource.value.trim()).join('\n\n'), imageInputs, inputTextCount: textInputs.length, inputImageCount: imageInputs.length } };
      }
      if (node.type !== 'mixerNode') return { ...node, data: nodeData };
      const collectedInputs = collectInputNodes(node.id);
      const inputTitles = sortInputTitles(collectedInputs.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
      const collected = collectResources(node.id);
      const unique = collected.filter((resource, index, all) => all.findIndex((item) => item.sourceId === resource.sourceId && item.kind === resource.kind) === index);
      const images = unique.filter((resource) => resource.kind === 'image').sort(compareByInputTitle);
      const texts = unique.filter((resource) => resource.kind === 'text' && resource.value?.trim()).sort(compareByInputTitle);
      const combinedText = texts.length ? [{
        sourceId: texts.map((resource) => resource.sourceId).join('-'),
        kind: 'text',
        title: texts.length === 1 ? texts[0].title : t(`${texts.length} text entries`, `${texts.length} ná»™i dung text`),
        value: texts.map((resource) => resource.value.trim()).join('\n\n'),
        segments: texts.map((resource) => ({ sourceId: resource.sourceId, title: resource.title, value: resource.value.trim(), color: resource.sourceColor })),
        count: texts.length,
      }] : [];
      return { ...node, data: { ...nodeData, resources: [...images, ...combinedText], resourceCount: unique.length, inputTitles } };
    });
  }, [nodes, edges, viewportZoom, movableJoinId, renderedNodeLayoutById, joinReversedById, t]);

  const displayEdges = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodeTypeById = new Map(nodes.map((node) => [node.id, node.type]));
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
    const activelyDraggedNodeIds = new Set(routingDragNodeIds);
    const geometryFor = (nodeId) => {
      const node = nodeById.get(nodeId);
      if (!node) return null;
      const renderedNode = renderedNodeLayoutById.get(nodeId);
      const fallbackPosition = node.position || { x: 0, y: 0 };
      const isJoin = node.type === 'joinNode';
      return {
        x: renderedNode?.x ?? fallbackPosition.x,
        y: renderedNode?.y ?? fallbackPosition.y,
        width: renderedNode?.width || node.measured?.width || node.width || (isJoin ? 54 : 292),
        height: renderedNode?.height || node.measured?.height || node.height || (isJoin ? 54 : 180),
        isJoin,
      };
    };
    const centerYFor = (nodeId) => {
      const geometry = geometryFor(nodeId);
      return geometry ? geometry.y + geometry.height / 2 : 0;
    };
    const sourceEdgesByNode = new Map();
    const targetEdgesByNode = new Map();
    const incidentEdgesByNode = new Map();
    edges.forEach((edge) => {
      if (!sourceEdgesByNode.has(edge.source)) sourceEdgesByNode.set(edge.source, []);
      if (!targetEdgesByNode.has(edge.target)) targetEdgesByNode.set(edge.target, []);
      sourceEdgesByNode.get(edge.source).push(edge);
      targetEdgesByNode.get(edge.target).push(edge);
      if (!incidentEdgesByNode.has(edge.source)) incidentEdgesByNode.set(edge.source, []);
      if (!incidentEdgesByNode.has(edge.target)) incidentEdgesByNode.set(edge.target, []);
      incidentEdgesByNode.get(edge.source).push(edge);
      incidentEdgesByNode.get(edge.target).push(edge);
    });
    const relatedEdgeIds = new Set();
    const highlightQueue = [];
    selectedNodeIds.forEach((nodeId) => {
      (incidentEdgesByNode.get(nodeId) || []).forEach((edge) => {
        relatedEdgeIds.add(edge.id);
        const otherNodeId = edge.source === nodeId ? edge.target : edge.source;
        if (nodeTypeById.get(otherNodeId) !== 'joinNode') return;
        highlightQueue.push({ nodeId: otherNodeId, direction: edge.target === otherNodeId ? 'forward' : 'backward' });
      });
      if (nodeTypeById.get(nodeId) === 'joinNode') {
        highlightQueue.push({ nodeId, direction: 'forward' }, { nodeId, direction: 'backward' });
      }
    });
    const expandedHighlightStates = new Set();
    while (highlightQueue.length) {
      const { nodeId, direction } = highlightQueue.shift();
      const stateKey = `${nodeId}:${direction}`;
      if (expandedHighlightStates.has(stateKey)) continue;
      expandedHighlightStates.add(stateKey);
      const directionalEdges = direction === 'forward' ? (sourceEdgesByNode.get(nodeId) || []) : (targetEdgesByNode.get(nodeId) || []);
      directionalEdges.forEach((edge) => {
        relatedEdgeIds.add(edge.id);
        const otherNodeId = direction === 'forward' ? edge.target : edge.source;
        if (nodeTypeById.get(otherNodeId) === 'joinNode') highlightQueue.push({ nodeId: otherNodeId, direction });
      });
    }
    const placementByEdge = (groups, direction) => {
      const placements = new Map();
      groups.forEach((connectedEdges, nodeId) => {
        connectedEdges.sort((a, b) => {
          const aOther = direction === 'source' ? a.target : a.source;
          const bOther = direction === 'source' ? b.target : b.source;
          return centerYFor(aOther) - centerYFor(bOther) || a.id.localeCompare(b.id);
        });
        const totalHeight = connectedEdges.length * 18 + Math.max(0, connectedEdges.length - 1) * 24;
        connectedEdges.forEach((edge, index) => placements.set(edge.id, nodeTypeById.get(nodeId) === 'joinNode'
          ? { offset: 0, index }
          : { offset: -totalHeight / 2 + 9 + index * 42, index }));
      });
      return placements;
    };
    const sourcePlacements = placementByEdge(sourceEdgesByNode, 'source');
    const targetPlacements = placementByEdge(targetEdgesByNode, 'target');
    const routingObstacles = nodes
      .filter((node) => node.type !== 'sectionNode' && !activelyDraggedNodeIds.has(node.id))
      .map((node) => {
        const renderedNode = renderedNodeLayoutById.get(node.id);
        const fallbackPosition = node.position || { x: 0, y: 0 };
        const position = { x: renderedNode?.x ?? fallbackPosition.x, y: renderedNode?.y ?? fallbackPosition.y };
        const isJoin = node.type === 'joinNode';
        const width = renderedNode?.width || node.measured?.width || node.width || (isJoin ? 54 : 292);
        const height = renderedNode?.height || node.measured?.height || node.height || (isJoin ? 54 : 180);
        const sidePadding = isJoin ? 20 : 18;
        return {
          id: node.id,
          left: position.x - sidePadding,
          right: position.x + width + sidePadding,
          top: position.y - (isJoin ? 20 : 42),
          bottom: position.y + height + (isJoin ? 20 : 18),
        };
      });
    const nodeObstacleIndex = createSpatialObstacleIndex(routingObstacles);
    const lineObstacleIndex = createSpatialObstacleIndex([], 240);
    const routeCache = routeCacheRef.current;
    const activeEdgeIds = new Set(edges.map((edge) => edge.id));
    [...routeCache.keys()].forEach((edgeId) => { if (!activeEdgeIds.has(edgeId)) routeCache.delete(edgeId); });
    return edges.map((edge) => {
      const sourceGeometry = geometryFor(edge.source);
      const targetGeometry = geometryFor(edge.target);
      let routedPoints = null;
      let sourceLead = 28;
      let targetLead = 28;
      let sourceDirection = 1;
      let targetDirection = -1;
      let localRoutingObstacles = routingObstacles;
      let routingKey = edge.id;
      let renderSourcePoint = null;
      let renderTargetPoint = null;
      if (sourceGeometry && targetGeometry) {
        const sourcePlacement = sourcePlacements.get(edge.id) || { offset: 0, index: 0 };
        const targetPlacement = targetPlacements.get(edge.id) || { offset: 0, index: 0 };
        sourceLead = 28 + sourcePlacement.index * 24;
        targetLead = 28 + targetPlacement.index * 24;
        const sourceJoinReversed = nodeTypeById.get(edge.source) === 'joinNode' && joinReversedById.get(edge.source);
        const targetJoinReversed = nodeTypeById.get(edge.target) === 'joinNode' && joinReversedById.get(edge.target);
        sourceDirection = sourceJoinReversed ? -1 : 1;
        targetDirection = targetJoinReversed ? 1 : -1;
        const sourcePoint = { x: sourceJoinReversed ? sourceGeometry.x : sourceGeometry.x + sourceGeometry.width, y: sourceGeometry.y + sourceGeometry.height / 2 + sourcePlacement.offset };
        const targetPoint = { x: targetJoinReversed ? targetGeometry.x + targetGeometry.width : targetGeometry.x, y: targetGeometry.y + targetGeometry.height / 2 + targetPlacement.offset };
        renderSourcePoint = sourcePoint;
        renderTargetPoint = targetPoint;
        const nodeSearchBounds = routingSearchBounds(sourcePoint, targetPoint, 280);
        const lineSearchBounds = routingSearchBounds(sourcePoint, targetPoint, 100);
        localRoutingObstacles = querySpatialObstacles(nodeObstacleIndex, nodeSearchBounds);
        const localLineObstacles = querySpatialObstacles(lineObstacleIndex, lineSearchBounds);
        routingKey = `${Math.round(sourcePoint.x)},${Math.round(sourcePoint.y)}>${Math.round(targetPoint.x)},${Math.round(targetPoint.y)}|${sourceLead},${targetLead}|D:${sourceDirection},${targetDirection}|N:${obstacleRoutingSignature(localRoutingObstacles)}|L:${obstacleRoutingSignature(localLineObstacles)}`;
        const cachedRoute = routeCache.get(edge.id);
        if (cachedRoute?.key === routingKey) routedPoints = cachedRoute.points;
        else {
          routedPoints = makeOrthogonalRoute(sourcePoint, targetPoint, [...localRoutingObstacles, ...localLineObstacles], sourceLead, targetLead, sourceDirection, targetDirection)
            || makeOrthogonalRoute(sourcePoint, targetPoint, localRoutingObstacles, sourceLead, targetLead, sourceDirection, targetDirection);
          routeCache.set(edge.id, { key: routingKey, points: routedPoints });
        }
        if (routedPoints) routeSegmentsAsObstacles(routedPoints).forEach((obstacle, index) => addSpatialObstacle(lineObstacleIndex, { ...obstacle, id: `${edge.id}:${index}` }));
      }
      return {
        ...edge,
        sourceHandle: nodeTypeById.get(edge.source) === 'joinNode' ? 'join-out' : (edge.sourceHandle || `out-${edge.id}`),
        targetHandle: nodeTypeById.get(edge.target) === 'joinNode' ? 'join-in' : (edge.targetHandle || `in-${edge.id}`),
        data: {
          ...(edge.data || {}),
          color: edge.data?.color || 'gradient',
          sourceColor: nodeById.get(edge.source)?.data?.color || NODE_COLORS[0],
          targetColor: nodeById.get(edge.target)?.data?.color || NODE_COLORS[0],
          relatedHighlighted: relatedEdgeIds.has(edge.id),
          cutPoint: edgeCutPoints[edge.id],
          routingObstacles: localRoutingObstacles,
          routedPoints,
          routingKey,
          routingComputed: Boolean(sourceGeometry && targetGeometry),
          sourcePoint: renderSourcePoint,
          targetPoint: renderTargetPoint,
          sourceLead,
          targetLead,
          sourceDirection,
          targetDirection,
        },
      };
    });
  }, [nodes, edges, edgeCutPoints, renderedNodeLayoutById, routingDragNodeIds, joinReversedById]);
  const fullZoomCompensation = Math.max(1, 1 / viewportZoom);
  const connectorScale = Math.min(6.7, 1 + (fullZoomCompensation - 1) * 0.3);
  const connectorStyle = {
    '--connector-size': '30px',
    '--connector-offset': '-15px',
    '--connector-border': '6px',
    '--connector-ring': '2.5px',
    '--connector-hover-ring': '3.5px',
    '--connection-port-size': '18px',
    '--connection-port-border': '3px',
    '--connector-visual-scale': connectorScale,
    '--connector-hover-visual-scale': connectorScale * 1.14,
  };

  const actions = useMemo(() => ({ updateNode, removeNode, copyResource, showToast, uploadImage, uploadCarouselImage, revealAsset, focusNode, generateImage, downloadGeneratedImage }), [updateNode, removeNode, copyResource, showToast, uploadImage, uploadCarouselImage, revealAsset, focusNode, generateImage, downloadGeneratedImage]);
  const edgeActions = useMemo(() => ({ removeEdge }), [removeEdge]);

  return (
    <NodeActionsContext.Provider value={actions}>
      <EdgeActionsContext.Provider value={edgeActions}>
      <main className={`app-shell theme-${theme}`} style={connectorStyle}>
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} addNode={addNode} resetProject={resetProject} openSettings={openSettingsPanel} projects={projects} activeProjectId={activeProjectId} onSelectProject={selectProject} onCreateProject={createProject} onRenameProject={renameProject} onDeleteProject={deleteProject} onReorderProjects={reorderProjects} />
        <section
          className="canvas-area"
          ref={canvasRef}
          onContextMenu={openCanvasMenu}
          onPointerDownCapture={rememberSelectionStart}
          onDragOver={onCanvasImageDragOver}
          onDrop={onCanvasImageDrop}
        >
          <div className="canvas-topbar">
            <div><span className="project-kicker">PROJECT</span><strong>{projects.find((project) => project.id === activeProjectId)?.name || t('Loadingâ€¦', 'Äang táº£i...')}</strong></div>
            <span className={`autosave ${saveStatus}`}><span></span> {saveStatus === 'loading' ? t('Opening folder', 'Äang má»Ÿ folder') : saveStatus === 'saving' ? t('Saving locally', 'Äang lÆ°u local') : saveStatus === 'error' ? t('Local save error', 'Lá»—i lÆ°u local') : t('Saved to local folder', 'ÄÃ£ lÆ°u vÃ o folder local')}</span>
            <button
              className="top-icon theme-toggle"
              title={theme === 'dark' ? t('Switch to Light mode', 'Chuyá»ƒn sang Light mode') : t('Switch to Dark mode', 'Chuyá»ƒn sang Dark mode')}
              aria-label={theme === 'dark' ? t('Switch to Light mode', 'Chuyá»ƒn sang Light mode') : t('Switch to Dark mode', 'Chuyá»ƒn sang Dark mode')}
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
          <div className="canvas-toolbox" aria-label={t('Canvas tools', 'CÃ´ng cá»¥ canvas')}>
            <button className={toolMode === 'select' ? 'active' : ''} onClick={() => { setToolMode('select'); setSectionDraft(null); }} title="Select" aria-label="Select"><MousePointer2 size={18} /><kbd>V</kbd></button>
            <button className={toolMode === 'section' ? 'active' : ''} onClick={() => { setToolMode('section'); setContextMenu(null); setEdgeMenu(null); }} title="Section Group · S" aria-label="Section Group"><Square size={18} /><kbd>S</kbd></button>
          </div>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onEdgeClick={onEdgeClick}
            onEdgeContextMenu={openEdgeMenu}
            onNodeContextMenu={openJoinMenu}
            onNodeDragStart={beginNodeRoutingDrag}
            onNodeDragStop={finishNodeRoutingDrag}
            onPaneClick={() => { setContextMenu(null); setEdgeMenu(null); setJoinMenu(null); setCanvasImageMenu(null); }}
            onNodeClick={() => { setContextMenu(null); setEdgeMenu(null); setJoinMenu(null); setCanvasImageMenu(null); }}
            onMoveStart={() => { setContextMenu(null); setEdgeMenu(null); setJoinMenu(null); setCanvasImageMenu(null); }}
            onMove={(_event, viewport) => setViewportZoom(viewport.zoom)}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.05}
            maxZoom={1.8}
            defaultEdgeOptions={{
              type: 'smoothstep',
              style: { stroke: '#9c8ff1', strokeWidth: 2 },
            }}
            connectionLineStyle={{ stroke: '#7c67e8', strokeWidth: 2 }}
            deleteKeyCode={['Backspace', 'Delete']}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            onSelectionEnd={finishSmartSelection}
            panOnDrag={[1]}
            panOnScroll
          >
            <Background color={theme === 'dark' ? '#454250' : '#c9c8c2'} gap={22} size={1.25} />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
          {toolMode === 'section' && (
            <div className="section-draw-layer" onPointerDown={beginSection} onPointerMove={moveSection} onPointerUp={finishSection} onPointerCancel={() => setSectionDraft(null)} onContextMenu={(event) => event.preventDefault()}>
              {sectionDraft && <div className="section-draft" style={{ left: Math.min(sectionDraft.startLocal.x, sectionDraft.currentLocal.x), top: Math.min(sectionDraft.startLocal.y, sectionDraft.currentLocal.y), width: Math.abs(sectionDraft.currentLocal.x - sectionDraft.startLocal.x), height: Math.abs(sectionDraft.currentLocal.y - sectionDraft.startLocal.y) }} />}
            </div>
          )}
          {contextMenu && (
            <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label={t('Add node', 'ThÃªm node')}>
              {selectedCanvasImageIds.length > 0 ? (
                <>
                  <div className="context-menu-title"><span>{selectedCanvasImageIds.length > 1 ? `${selectedCanvasImageIds.length} SELECTED IMAGES` : 'SELECTED IMAGE'}</span><kbd>Right click</kbd></div>
                  <button role="menuitem" onClick={() => makeCanvasImageNode('imageNode')}><span className="menu-icon orange"><ImageIcon size={15} /></span><span>{selectedCanvasImageIds.length > 1 ? `Make ${selectedCanvasImageIds.length} Image Nodes` : 'Make Image Node'}</span><ArrowRight size={13} /></button>
                  <button role="menuitem" onClick={() => makeCanvasImageNode('exampleNode')}><span className="menu-icon green"><BookOpenCheck size={15} /></span><span>{selectedCanvasImageIds.length > 1 ? `Make ${selectedCanvasImageIds.length} Example Nodes` : 'Make Example Node'}</span><ArrowRight size={13} /></button>
                </>
              ) : (
                <>
                  <div className="context-menu-title"><span>{t('ADD NODE', 'THÃŠM NODE')}</span><kbd>Right click</kbd></div>
                  <button role="menuitem" onClick={() => addNode('textNode', contextMenu.flowPosition)}><span className="menu-icon blue"><Type size={15} /></span><span>Text</span><Plus size={13} /></button>
                  <button role="menuitem" onClick={() => addNode('carouselNode', contextMenu.flowPosition)}><span className="menu-icon blue"><FileImage size={15} /></span><span>Carousel</span><Plus size={13} /></button>
                  <button role="menuitem" onClick={() => addNode('imageNode', contextMenu.flowPosition)}><span className="menu-icon orange"><ImageIcon size={15} /></span><span>Image</span><Plus size={13} /></button>
                  <button role="menuitem" onClick={() => addNode('mixerNode', contextMenu.flowPosition)}><span className="menu-icon violet"><Merge size={15} /></span><span>Mixer</span><Plus size={13} /></button>
                  <button role="menuitem" onClick={() => addNode('exampleNode', contextMenu.flowPosition)}><span className="menu-icon green"><BookOpenCheck size={15} /></span><span>Example</span><Plus size={13} /></button>
                  <button role="menuitem" onClick={() => addNode('genNode', contextMenu.flowPosition)}><span className="menu-icon violet"><Zap size={15} /></span><span>Gen Node</span><Plus size={13} /></button>
                  <button role="menuitem" onClick={() => addNode('joinNode', contextMenu.flowPosition)}><span className="menu-icon violet"><Waypoints size={15} /></span><span>Join Point</span><Plus size={13} /></button>
                  <div className="context-menu-shortcut"><span>{t('Duplicate selected node', 'NhÃ¢n báº£n node Ä‘Ã£ chá»n')}</span><kbd>Ctrl D</kbd></div>
                </>
              )}
            </div>
          )}
          {joinMenu && (
            <div className="canvas-context-menu join-context-menu" style={{ left: joinMenu.x, top: joinMenu.y }} role="menu" aria-label={joinMenu.nodeType === 'mixerNode' ? t('Mixer options') : joinMenu.nodeType === 'exampleNode' ? t('Example options') : joinMenu.nodeType === 'genNode' ? t('Gen Node options') : joinMenu.nodeType === 'textNode' ? t('Text options') : t('Join Point options')}>
              <div className="context-menu-title"><span>{joinMenu.nodeType === 'mixerNode' ? 'MIXER' : joinMenu.nodeType === 'exampleNode' ? 'EXAMPLE' : joinMenu.nodeType === 'genNode' ? 'GEN NODE' : joinMenu.nodeType === 'textNode' ? 'TEXT' : 'JOIN POINT'}</span><kbd>Right click</kbd></div>
              {selectedBatchInputIds.filter((id) => id !== joinMenu.nodeId).length > 0 && (
                <button role="menuitem" onClick={() => connectSelectedToNode(joinMenu.nodeId)}><span className="menu-icon violet"><Waypoints size={15} /></span><span>{t(`Connect ${selectedBatchInputIds.filter((id) => id !== joinMenu.nodeId).length} selected here`)}</span><ArrowRight size={13} /></button>
              )}
              {joinMenu.nodeType === 'mixerNode' ? (
                <button role="menuitem" onClick={convertMixerToJoin}><span className="menu-icon violet"><Waypoints size={15} /></span><span>{t('Convert to Join Point')}</span><ArrowRight size={13} /></button>
              ) : joinMenu.nodeType === 'textNode' ? (
                <button role="menuitem" onClick={convertTextToCarousel}><span className="menu-icon blue"><FileImage size={15} /></span><span>{t('Convert to Carousel Node')}</span><ArrowRight size={13} /></button>
              ) : joinMenu.nodeType === 'joinNode' ? (
                <>
                  <button role="menuitem" onClick={enableJoinMove}><span className="menu-icon violet"><MousePointer2 size={15} /></span><span>{t('Move Join Point')}</span><ArrowRight size={13} /></button>
                  <button role="menuitem" onClick={() => setJoinMenu((current) => current ? { ...current, paletteOpen: !current.paletteOpen } : null)}><span className="menu-icon violet"><Palette size={15} /></span><span>{t('Change color')}</span><ChevronDown size={13} /></button>
                  {joinMenu.paletteOpen && (
                    <div className="join-color-grid">
                      {NODE_COLORS.map((color) => <button key={color} className={joinMenu.color === color ? 'active' : ''} style={{ '--join-swatch': color }} onClick={() => setJoinPointColor(color)} aria-label={t(`Join Point color ${color}`)} />)}
                    </div>
                  )}
                  <button role="menuitem" onClick={convertJoinToMixer}><span className="menu-icon violet"><Merge size={15} /></span><span>{t('Convert to Mixer')}</span><ArrowRight size={13} /></button>
                </>
              ) : null}
            </div>
          )}
          {canvasImageMenu && (
            <div className="canvas-context-menu canvas-image-context-menu" style={{ left: canvasImageMenu.x, top: canvasImageMenu.y }} role="menu" aria-label={t('Canvas image options', 'TÃ¹y chá»n áº£nh canvas')}>
              <div className="context-menu-title"><span>{(canvasImageMenu.nodeIds?.length || 1) > 1 ? `${canvasImageMenu.nodeIds.length} CANVAS IMAGES` : 'CANVAS IMAGE'}</span><kbd>Right click</kbd></div>
              <button role="menuitem" onClick={() => makeCanvasImageNode('imageNode')}><span className="menu-icon orange"><ImageIcon size={15} /></span><span>{(canvasImageMenu.nodeIds?.length || 1) > 1 ? 'Make Image Nodes' : 'Make Image Node'}</span><ArrowRight size={13} /></button>
              <button role="menuitem" onClick={() => makeCanvasImageNode('exampleNode')}><span className="menu-icon green"><BookOpenCheck size={15} /></span><span>{(canvasImageMenu.nodeIds?.length || 1) > 1 ? 'Make Example Nodes' : 'Make Example Node'}</span><ArrowRight size={13} /></button>
            </div>
          )}
          {edgeMenu && (
            <div className="edge-color-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} role="menu" aria-label={t('Choose connector color', 'Chá»n mÃ u dÃ¢y ná»‘i')}>
              <div className="edge-color-title"><Palette size={13} /> {t('CONNECTOR COLOR', 'MÃ€U DÃ‚Y Ná»I')}</div>
              <button className={`edge-gradient-option ${edgeMenu.color === 'gradient' ? 'active' : ''}`} onClick={() => setEdgeColor(edgeMenu.edgeId, 'gradient')}><span></span><strong>{t('Gradient from node colors', 'Gradient theo mÃ u node')}</strong></button>
              <div className="edge-color-grid">
                {EDGE_COLORS.map((color, index) => (
                  <button
                    key={color}
                    className={edgeMenu.color === color ? 'active' : ''}
                    style={{ '--edge-swatch': color }}
                    onClick={() => setEdgeColor(edgeMenu.edgeId, color)}
                    aria-label={t(`Connector color ${index + 1}`, `MÃ u dÃ¢y ${index + 1}`)}
                  />
                ))}
              </div>
              <button className="create-join-button" onClick={createJoinPoint}><Waypoints size={15} /><span><strong>{t('Create Join Point', 'Táº¡o Join Point')}</strong><small>{t('Merge flows at this position', 'Gom luá»“ng táº¡i vá»‹ trÃ­ nÃ y')}</small></span></button>
            </div>
          )}
        </section>
        {storageGate !== 'ready' && (
          <div className="storage-setup-overlay">
            <section className="storage-setup-card" role="dialog" aria-modal="true" aria-label={t('Connect project folder', 'Káº¿t ná»‘i folder project')}>
              <div className="storage-setup-icon"><FolderKanban size={28} /></div>
              <span className="storage-setup-kicker">MERGEBOARD LOCAL STORAGE</span>
              <h1>{storageGate === 'checking' ? t('Checking folderâ€¦', 'Äang kiá»ƒm tra folderâ€¦') : storageGate === 'unsupported' ? t('Browser not supported', 'TrÃ¬nh duyá»‡t chÆ°a Ä‘Æ°á»£c há»— trá»£') : storageGate === 'needs-permission' ? t('Restore folder access', 'Cho phÃ©p truy cáº­p láº¡i folder') : t('Choose project storage', 'Chá»n nÆ¡i lÆ°u project')}</h1>
              <p>{storageGate === 'unsupported' ? t('Open this page in Chrome or Microsoft Edge on a desktop computer.', 'HÃ£y má»Ÿ trang nÃ y báº±ng Chrome hoáº·c Microsoft Edge trÃªn mÃ¡y tÃ­nh.') : t('Projects, images, and content are read and written directly on your computer. No project data is uploaded to Vercel.', 'Project, áº£nh vÃ  ná»™i dung sáº½ Ä‘Æ°á»£c Ä‘á»c/ghi trá»±c tiáº¿p trÃªn mÃ¡y cá»§a báº¡n. KhÃ´ng cÃ³ dá»¯ liá»‡u project nÃ o Ä‘Æ°á»£c táº£i lÃªn Vercel.')}</p>
              {storageGate !== 'checking' && storageGate !== 'unsupported' && (
                <div className="storage-setup-actions">
                  {storageGate === 'needs-permission' && <button onClick={connectRememberedFolder} disabled={choosingAssetFolder}><Check size={17} />{choosingAssetFolder ? t('Waiting for confirmationâ€¦', 'Äang chá» xÃ¡c nháº­nâ€¦') : t('Allow access', 'Cho phÃ©p truy cáº­p')}</button>}
                  <button className={storageGate === 'needs-permission' ? 'secondary' : ''} onClick={chooseProjectFolder} disabled={choosingAssetFolder}><FolderOpen size={17} />{choosingAssetFolder ? t('Waiting for folder selectionâ€¦', 'Äang chá» chá»n folderâ€¦') : storageGate === 'needs-permission' ? t('Choose another folder', 'Chá»n folder khÃ¡c') : t('Choose project folder', 'Chá»n folder project')}</button>
                </div>
              )}
              <small>{t('Chrome/Edge will show a secure dialog for you to choose the folder.', 'Chrome/Edge sáº½ hiá»‡n há»™p thoáº¡i báº£o máº­t Ä‘á»ƒ báº¡n tá»± chá»n folder.')}</small>
            </section>
          </div>
        )}
        {settingsOpen && (
          <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !choosingAssetFolder) setSettingsOpen(false); }}>
            <section className="settings-panel" role="dialog" aria-modal="true" aria-label={t('MergeBoard Settings', 'CÃ i Ä‘áº·t MergeBoard')}>
              <header><div><Settings size={18} /><span><strong>{t('Settings', 'CÃ i Ä‘áº·t')}</strong><small>MergeBoard workspace</small></span></div><button onClick={() => setSettingsOpen(false)} disabled={choosingAssetFolder} aria-label={t('Close settings', 'ÄÃ³ng cÃ i Ä‘áº·t')}><X size={16} /></button></header>
              <div className="settings-content">
                <div className="settings-label"><FolderOpen size={15} /><span><strong>{t('Project storage folder', 'Folder lÆ°u Project')}</strong><small>{t('Each project is an independent folder containing nodes, text, and assets.', 'Má»—i project lÃ  má»™t folder Ä‘á»™c láº­p, gá»“m há»‡ thá»‘ng node, text vÃ  toÃ n bá»™ asset.')}</small></span></div>
                <div className="settings-path" title={appSettings?.projectRoot || ''}>{appSettings?.projectRoot || t('No folder connected', 'ChÆ°a káº¿t ná»‘i folder')}</div>
                <button className="choose-folder-button" onClick={chooseProjectFolder} disabled={choosingAssetFolder}><FolderOpen size={16} /><span>{choosingAssetFolder ? t('Waiting for folder selectionâ€¦', 'Äang chá» báº¡n chá»n folder...') : t('Choose folder', 'Chá»n folder')}</span></button>
                <p>{t('The browser displays only the folder name, not its full path. Choosing another folder switches workspaces; data in the old folder remains untouched.', 'TrÃ¬nh duyá»‡t chá»‰ cho phÃ©p hiá»ƒn thá»‹ tÃªn folder, khÃ´ng hiá»ƒn thá»‹ Ä‘Æ°á»ng dáº«n Ä‘áº§y Ä‘á»§. Chá»n folder khÃ¡c sáº½ chuyá»ƒn workspace; dá»¯ liá»‡u trong folder cÅ© váº«n Ä‘Æ°á»£c giá»¯ nguyÃªn.')}</p>
                <label className="settings-label settings-field-label"><FolderOpen size={15} /><span><strong>{t('Local project folder path', 'Đường dẫn folder project local')}</strong><small>{t('Used only by the local launcher to open asset folders in Explorer.', 'Chỉ dùng khi chạy local để mở folder ảnh trong Explorer.')}</small></span></label>
                <input
                  className="settings-input"
                  type="text"
                  value={localProjectRootPath}
                  onChange={(event) => setLocalProjectRootPath(event.target.value)}
                  placeholder="D:\Projects\MergeBoard"
                  spellCheck="false"
                  autoComplete="off"
                  aria-label={t('Local project folder path')}
                />
                <div className="settings-divider" />
                <label className="settings-label settings-field-label"><Zap size={15} /><span><strong>{t('ShopAIKey API key')}</strong><small>{t('Used by Gen Node for image generation. Stored locally in this browser.', 'DÃ¹ng cho Gen Node Ä‘á»ƒ táº¡o áº£nh. Chá»‰ lÆ°u local trong trÃ¬nh duyá»‡t nÃ y.')}</small></span></label>
                <input
                  className="settings-input"
                  type="password"
                  value={shopAIKey}
                  onChange={(event) => setShopAIKey(event.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                  aria-label={t('ShopAIKey API key')}
                />
                <div className="settings-path" title={SHOPAIKEY_IMAGE_MODEL}>{SHOPAIKEY_IMAGE_MODEL}</div>
              </div>
            </section>
          </div>
        )}
        {toast && <div className={`toast ${toast.type}`} key={toast.key}>{toast.type === 'success' ? <Check size={16} /> : <X size={16} />}{toast.message}</div>}
      </main>
      </EdgeActionsContext.Provider>
    </NodeActionsContext.Provider>
  );
}

async function convertImageToPng(src) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = src; });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode><ReactFlowProvider><FlowCanvas /></ReactFlowProvider></React.StrictMode>,
);
