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
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronLeft,
  Copy,
  FileImage,
  FileText,
  FolderOpen,
  FolderKanban,
  FolderPlus,
  Image as ImageIcon,
  Layers3,
  Languages,
  Menu,
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
  Sparkles,
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
const LANGUAGE_KEY = 'mergeboard-language-v1';
const NodeActionsContext = createContext(null);
const EdgeActionsContext = createContext(null);
const LanguageContext = createContext({ language: 'en', t: (english) => english });

function useTranslation() {
  return useContext(LanguageContext).t;
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
    if (['textNode', 'imageNode', 'exampleNode'].includes(node.type)) return new Set([node.id]);
    const nextVisited = new Set(visited).add(nodeId);
    const lineage = new Set();
    graphEdges.filter((edge) => edge.target === nodeId).forEach((edge) => {
      collectLineage(edge.source, nextVisited).forEach((sourceId) => lineage.add(sourceId));
    });
    return lineage;
  };
  const duplicates = new Map();
  nodes.filter((node) => ['mixerNode', 'exampleNode', 'joinNode'].includes(node.type)).forEach((receiver) => {
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

const INPUT_KIND_PRIORITY = { example: 0, image: 1, text: 2 };
function sortInputTitles(items) {
  return [...items].sort((first, second) => (INPUT_KIND_PRIORITY[first.kind] ?? 99) - (INPUT_KIND_PRIORITY[second.kind] ?? 99));
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

function NodeShell({ children, className = '', selected = false, color = NODE_COLORS[0], ...props }) {
  return <article className={`node-card ${className} ${selected ? 'is-selected' : ''}`} style={{ '--node-color': color }} {...props}>{children}</article>;
}

function PortStack({ ports = [], type, position, color, compact = false }) {
  const t = useTranslation();
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();
  const uniquePorts = ports.filter((port, index, all) => all.findIndex((item) => item.id === port.id) === index);
  const items = [...uniquePorts, { id: `${type}-new`, color, idle: true }];
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
        aria-label={type === 'target' ? t('Connector input', 'Đầu nhận connector') : t('Connector output', 'Đầu ra connector')}
        title={type === 'target' ? t('Input', 'Đầu nhận') : t('Drag to connect', 'Kéo để tạo kết nối')}
      />
    );
  });
}

function NodeHeader({ icon: Icon, title, nodeId, viewMode = 'expanded', color = NODE_COLORS[0] }) {
  const t = useTranslation();
  const { updateNode } = useContext(NodeActionsContext);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const actionsRef = useRef(null);
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
      <div className="node-floating-title nodrag">
        <Icon size={14} strokeWidth={2.4} />
        <input
          className="node-title"
          value={title}
          aria-label={t('Node name', 'Tên node')}
          onChange={(event) => updateNode(nodeId, { title: event.target.value })}
        />
      </div>
      <div ref={actionsRef} className="node-actions nodrag" onMouseLeave={() => setPaletteOpen(false)}>
        <div className="node-color-picker">
          <button className="color-trigger" onClick={() => setPaletteOpen((value) => !value)} aria-label={t('Choose node color', 'Chọn màu node')} title={t('Choose node color', 'Chọn màu node')}><Palette size={14} /></button>
          {paletteOpen && (
            <div className="node-color-popover" aria-label={t('Node color palette', 'Bảng màu node')}>
              {NODE_COLORS.map((item) => <button key={item} className={item === color ? 'active' : ''} style={{ '--swatch': item }} onClick={() => { updateNode(nodeId, { color: item }); setPaletteOpen(false); }} aria-label={t(`Node color ${item}`, `Màu node ${item}`)} />)}
            </div>
          )}
        </div>
        <button
          className="view-mode-toggle"
          onClick={() => updateNode(nodeId, { viewMode: viewMode === 'expanded' ? 'compact' : 'expanded' })}
          aria-label={viewMode === 'expanded' ? t('Compact view', 'Hiển thị rút gọn') : t('Expanded view', 'Hiển thị đầy đủ')}
          title={viewMode === 'expanded' ? t('Compact view', 'Hiển thị rút gọn') : t('Expanded view', 'Hiển thị đầy đủ')}
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
      aria-label={kind === 'image' ? t('Copy image', 'Copy ảnh') : t('Copy text', 'Copy text')}
      title={kind === 'image' ? t('Copy image', 'Copy ảnh') : t('Copy text', 'Copy text')}
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
    setEditing(true);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  return (
    <NodeShell selected={selected} color={color} className={`text-card mode-${viewMode}`}>
      <NodeHeader icon={Type} eyebrow="TEXT" title={data.title} nodeId={id} accent="blue" viewMode={viewMode} color={color} />
      <div className="node-body text-node-content">
        {editing ? (
          <textarea
            ref={editorRef}
            className="text-editor is-editing nodrag nowheel"
            value={data.content}
            placeholder={t('Enter your content…', 'Nhập nội dung của bạn...')}
            onChange={(event) => updateNode(id, { content: event.target.value })}
            onDoubleClick={(event) => event.stopPropagation()}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <div ref={editorRef} className="text-editor text-display nowheel" onDoubleClick={beginEditing}>
            {data.content || <span className="text-placeholder">{t('Double-click to enter content…', 'Double-click để nhập nội dung...')}</span>}
          </div>
        )}
      </div>
      <span className="node-external-meta">{data.content.length} {t('characters', 'ký tự')}</span>
      <div className="node-border-copy"><CopyButton value={data.content} /></div>
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
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast(t('Please choose a valid image file', 'Vui lòng chọn đúng định dạng ảnh'), 'error');
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
    if (!file) return showToast(t('Drop a valid image file into the Image Node', 'Hãy thả đúng file ảnh vào Image Node'), 'error');
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
        className={`image-card mode-${viewMode} ${dragOver ? 'is-drag-over' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); event.stopPropagation(); setDragOver(true); }}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; }}
        onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }}
        onDrop={onDropImage}
      >
        <NodeHeader icon={ImageIcon} title={data.title} nodeId={id} viewMode={viewMode} color={color} />
        <div className="node-body image-node-content">
          {data.image ? (
            <div className="image-preview" onDoubleClick={(event) => { event.stopPropagation(); setPreviewOpen(true); }}>
              <img src={data.image} alt={data.title || t('Image resource', 'Tài nguyên ảnh')} draggable="false" onLoad={(event) => { const next = { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }; setDimensions(next); if (next.width !== data.imageWidth || next.height !== data.imageHeight) updateNode(id, { imageWidth: next.width, imageHeight: next.height }); }} />
              {!!dimensions.width && <span className="image-dimensions">{dimensions.width} × {dimensions.height}</span>}
              {selected && <div className="image-selection-gradient" />}
              {selected && <label className="replace-image nodrag" title={t('Replace image', 'Đổi ảnh')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label>}
            </div>
          ) : (
            <div className="empty-image-surface"><label className="replace-image compact-upload-button nodrag" title={uploading ? t('Saving…', 'Đang sao lưu...') : t('Upload image', 'Tải ảnh lên')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label></div>
          )}
        </div>
        <span className="node-external-meta file-name">{data.fileName || t('No image', 'Chưa có ảnh')}</span>
        {data.image && <div className="node-border-copy"><CopyButton value={data.image} kind="image" /></div>}
        <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
      </NodeShell>
      {previewOpen && createPortal(
        <div className="image-lightbox" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}>
          <section className="image-lightbox-panel" role="dialog" aria-modal="true" aria-label={t('Large image preview', 'Xem ảnh kích thước lớn')}>
            <header><span><ImageIcon size={16} /><strong>{data.fileName || data.title}</strong></span><button onClick={() => setPreviewOpen(false)} aria-label={t('Close', 'Đóng')}><X size={18} /></button></header>
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
            <footer><span>{dimensions.width || '—'} × {dimensions.height || '—'} px · {t('Zoom', 'Thu phóng')} {Math.round(lightboxView.zoom * 100)}%{lightboxView.zoom > 1 ? ` · ${t('drag to pan', 'kéo để xem')}` : ''}</span><button onClick={() => revealAsset(data.assetFile)}><FolderOpen size={15} />{t('Open asset in Explorer', 'Mở asset trong Explorer')}</button></footer>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
});

const MixerNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { focusNode } = useContext(NodeActionsContext);
  const resources = data.resources || [];
  const viewMode = data.viewMode || 'expanded';
  const imageCount = resources.filter((resource) => resource.kind === 'image').length;
  const textResource = resources.find((resource) => resource.kind === 'text');
  const color = data.color || '#7c6cf2';
  return (
    <NodeShell selected={selected} color={color} className={`mixer-card mode-${viewMode}`}>
      <div className="mixer-port-anchor">
        <PortStack ports={data.inputPorts} type="target" position={Position.Left} color={color} />
        <NodeHeader icon={Merge} title={data.title} nodeId={id} viewMode={viewMode} color={color} />
        <div className="mixer-content nowheel">
          {!resources.length && (
            <div className="empty-mixer"><Zap size={23} /><strong>{t('Connect resources', 'Kết nối tài nguyên')}</strong><span>{t('Drag a connector from Text or Image into the left port.', 'Kéo dây từ Text hoặc Image vào cổng bên trái.')}</span></div>
          )}
          {resources.map((resource, index) => (
            <section className="resource-block" key={`${resource.sourceId}-${index}`}>
              {resource.kind !== 'image' && <div className="resource-meta"><span className={`resource-kind ${resource.kind}`}>{resource.title}</span><CopyButton value={resource.value} kind={resource.kind} /></div>}
              {resource.kind === 'image'
                ? <div className="mixer-image-wrap"><img className="mixer-image" src={resource.value} alt={resource.title} draggable="false" /><button className={`mixer-image-title-link nodrag ${(resource.title || '').length > 25 ? 'is-long' : ''}`} style={{ color: resource.sourceColor || color }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(resource.sourceId); }} aria-label={t(`Go to ${resource.title}`, `Đi tới ${resource.title}`)} title={resource.title}><span>{resource.title || t('Untitled Image', 'Ảnh chưa đặt tên')}</span></button><div className="mixer-image-copy"><CopyButton value={resource.value} kind="image" /></div></div>
                : resource.segments?.length
                  ? <div className="mixer-text mixer-text-group">{resource.segments.map((segment, segmentIndex) => <section className={`mixer-text-segment tone-${segmentIndex % 2 ? 'b' : 'a'}`} key={segment.sourceId}><div className="mixer-segment-source"><button className="mixer-segment-title-link nodrag" style={{ color: segment.color || color }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(segment.sourceId); }} aria-label={t(`Go to ${segment.title || 'text node'}`, `Đi tới ${segment.title || 'node text'}`)} title={t('Go to source node', 'Đi tới node nguồn')}>{segment.title || t('Untitled Text', 'Text chưa đặt tên')}</button></div><p>{segment.value}</p></section>)}</div>
                  : <p className="mixer-text">{resource.value || <em>{t('Empty content', 'Nội dung trống')}</em>}</p>}
            </section>
          ))}
        </div>
        <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
      </div>
      <div className="mixer-footer-note is-outside">
        <span>{imageCount} {t('images', 'ảnh')}</span><span>{textResource ? `${textResource.count} text · ${t('merged', 'đã gộp')}` : '0 text'}</span>
      </div>
    </NodeShell>
  );
});

const ExampleNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { uploadImage, showToast, focusNode } = useContext(NodeActionsContext);
  const [uploading, setUploading] = useState(false);
  const viewMode = data.viewMode || 'expanded';
  const inputTitles = data.inputTitles || [];
  const inputImageCount = inputTitles.filter((item) => item.kind === 'image' || item.kind === 'example').length;
  const inputTextCount = inputTitles.filter((item) => item.kind === 'text').length;
  const color = data.color || '#10b981';
  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return showToast(t('Please choose a valid image file', 'Vui lòng chọn đúng định dạng ảnh'), 'error');
    setUploading(true);
    try { await uploadImage(id, file); }
    finally { setUploading(false); event.target.value = ''; }
  };
  return (
    <NodeShell selected={selected} color={color} className={`example-card mode-${viewMode}`}>
      <PortStack ports={data.inputPorts} type="target" position={Position.Left} color={color} />
      <NodeHeader icon={BookOpenCheck} title={data.title} nodeId={id} viewMode={viewMode} color={color} />
      <div className="example-content nowheel">
        {data.image ? (
          <div className="image-preview example-preview">
            <img src={data.image} alt={data.title || t('Example image', 'Ảnh example')} draggable="false" />
            {selected && <label className="replace-image compact-upload-button nodrag" title={t('Replace example image', 'Đổi ảnh example')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label>}
          </div>
        ) : (
          <div className="empty-image-surface"><label className="replace-image compact-upload-button nodrag" title={uploading ? t('Saving…', 'Đang sao lưu...') : t('Upload example image', 'Tải ảnh example lên')}><Upload size={16} /><input type="file" accept="image/*" onChange={onFile} disabled={uploading} /></label></div>
        )}
        <div className="mixer-footer-note example-resource-count"><span>{inputImageCount} {t('images', 'ảnh')}</span><span>{inputTextCount} text</span></div>
        <section className="example-inputs">
          <div className="example-inputs-label"><Layers3 size={12} /> INPUT NODE · {inputTitles.length}</div>
          {inputTitles.length ? inputTitles.map((item) => (
            <div className={`example-title-row ${item.kind}`} key={item.id}>
              {item.kind === 'example' ? <BookOpenCheck size={13} /> : item.kind === 'image' ? <ImageIcon size={13} /> : <FileText size={13} />}
              <button className="example-title-link nodrag" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); focusNode(item.id); }} aria-label={t(`Go to ${item.title || 'input node'}`, `Đi tới ${item.title || 'node input'}`)} title={t('Go to input node', 'Đi tới node input')}>{item.title || t('Untitled node', 'Node chưa đặt tên')}</button>
            </div>
          )) : <div className="example-empty">{t('Connect Text, Image, or Mixer to the left port.', 'Cắm Text, Image hoặc Mixer vào cổng bên trái.')}</div>}
        </section>
      </div>
      {data.image && <div className="node-border-copy"><CopyButton value={data.image} kind="image" /></div>}
      <PortStack ports={data.outputPorts} type="source" position={Position.Right} color={color} />
    </NodeShell>
  );
});

const CanvasImageNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { updateNode } = useContext(NodeActionsContext);
  return (
    <div className={`canvas-image-node ${selected ? 'is-selected' : ''}`} style={{ width: data.width || 320, height: data.height || 240 }} title={t('Free image · right-click to make a node', 'Ảnh tự do · chuột phải để Make node')}>
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
      <img src={data.image} alt={data.fileName || t('Canvas image', 'Ảnh trên canvas')} draggable="false" />
    </div>
  );
});

const JoinNode = memo(({ data, selected }) => {
  const t = useTranslation();
  const color = data.color || '#8b7cf6';
  return (
    <div className={`join-point ${selected ? 'is-selected' : ''} ${data.moveEnabled ? 'is-move-enabled' : ''}`} style={{ '--join-color': color }} title={data.moveEnabled ? t('Drag to move Join Point', 'Kéo để di chuyển Join Point') : 'Join Point'}>
      <Handle id="join-in" type="target" position={Position.Left} className="join-unified-handle join-target-zone" aria-label={t('Join Point input', 'Đầu nhận Join Point')} title={t('Input', 'Đầu nhận')} />
      <Handle id="join-out" type="source" position={Position.Right} className="join-unified-handle join-source-zone" aria-label={t('Join Point output', 'Đầu ra Join Point')} title={t('Output', 'Đầu ra')} />
      <Waypoints size={16} strokeWidth={2.6} />
    </div>
  );
});

const SectionNode = memo(({ id, data, selected }) => {
  const t = useTranslation();
  const { updateNode, removeNode } = useContext(NodeActionsContext);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const color = data.color || '#3b82f6';
  const titleScale = Math.min(20, Math.max(1, 1 / (data.zoom || 1)));
  return (
    <section className={`section-frame ${selected ? 'is-selected' : ''}`} style={{ width: data.width || 420, height: data.height || 260, '--section-color': color }}>
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
        <input value={data.title || 'Section'} onChange={(event) => updateNode(id, { title: event.target.value })} aria-label={t('Section name', 'Tên Section')} />
      </div>
      {selected && !data?.relatedHighlighted && (
        <div className="section-actions nodrag">
          <button onClick={() => setPaletteOpen((value) => !value)} aria-label={t('Choose Section color', 'Chọn màu Section')} title={t('Choose Section color', 'Chọn màu Section')}><Palette size={14} /></button>
          <button onClick={() => removeNode(id)} aria-label={t('Delete Section', 'Xóa Section')} title={t('Delete Section', 'Xóa Section')}><Trash2 size={14} /></button>
          {paletteOpen && <div className="section-palette">{NODE_COLORS.map((item) => <button key={item} style={{ '--swatch': item }} onClick={() => { updateNode(id, { color: item }); setPaletteOpen(false); }} aria-label={t(`Section color ${item}`, `Màu Section ${item}`)} />)}</div>}
        </div>
      )}
    </section>
  );
});

const nodeTypes = { textNode: TextNode, imageNode: ImageNode, mixerNode: MixerNode, exampleNode: ExampleNode, canvasImageNode: CanvasImageNode, joinNode: JoinNode, sectionNode: SectionNode };

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

function makeOrthogonalRoute(sourcePoint, targetPoint, obstacles, sourceLead = 28, targetLead = 28) {
  const sourceStub = { x: sourcePoint.x + sourceLead, y: sourcePoint.y };
  const targetStub = { x: targetPoint.x - targetLead, y: targetPoint.y };
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
    const sourcePoint = { x: sourceX, y: sourceY };
    const targetPoint = { x: targetX, y: targetY };
    const obstacles = data?.routingObstacles || [];
    const plannedRoute = data?.routedPoints || makeOrthogonalRoute(sourcePoint, targetPoint, obstacles, data?.sourceLead, data?.targetLead);
    if (!plannedRoute) return getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 18 }).slice(0, 3);
    let route = plannedRoute.map((point, index) => index === 0 ? sourcePoint : index === plannedRoute.length - 1 ? targetPoint : point);
    const hasDiagonal = route.slice(1).some((point, index) => point.x !== route[index].x && point.y !== route[index].y);
    if (hasDiagonal) {
      const correctedRoute = makeOrthogonalRoute(sourcePoint, targetPoint, obstacles, data?.sourceLead, data?.targetLead);
      if (!correctedRoute) return getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 18 }).slice(0, 3);
      route = correctedRoute;
    }
    const midpoint = routeMidpoint(route);
    return [roundedRoutePath(route), midpoint.x, midpoint.y];
  }, [data?.routingObstacles, source, sourcePosition, sourceX, sourceY, target, targetPosition, targetX, targetY]);
  const cutX = data?.cutPoint?.x ?? labelX;
  const cutY = data?.cutPoint?.y ?? labelY;

  return (
    <>
      <defs>
        {isGradient && <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}><stop offset="0%" stopColor={sourceColor} /><stop offset="100%" stopColor={targetColor} /></linearGradient>}
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
            aria-label={t('Disconnect', 'Ngắt kết nối')}
            title={t('Disconnect', 'Ngắt kết nối')}
          >
            <Scissors size={20} />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const edgeTypes = { beam: BeamEdge };

function ProjectManager({ projects, activeProjectId, onSelect, onCreate, onRename, onDelete }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [deletePending, setDeletePending] = useState(null);
  const active = projects.find((project) => project.id === activeProjectId);
  return (
    <div className="project-manager">
      <button className="project-current" onClick={() => setOpen((value) => !value)} aria-label={t('Project list', 'Danh sách project')}>
        <span className="project-folder"><FolderKanban size={15} /></span>
        <span><strong>{active?.name || t('Loading…', 'Đang tải...')}</strong><small>{active?.folder || t('Project storage', 'Bộ nhớ project')}</small></span>
        <ChevronDown size={14} className={open ? 'rotated' : ''} />
      </button>
      {open && (
        <div className="project-popover">
          <div className="project-popover-title"><span>PROJECTS</span><span>{projects.length}</span></div>
          <div className="project-list">
            {projects.map((project) => (
              <div className={`project-row ${project.id === activeProjectId ? 'active' : ''}`} key={project.id}>
                {editingId === project.id ? (
                  <>
                    <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { onRename(project.id, editingName); setEditingId(null); } }} aria-label={t('New project name', 'Tên project mới')} />
                    <button onClick={() => { onRename(project.id, editingName); setEditingId(null); }} aria-label={t('Save name', 'Lưu tên')}><Check size={12} /></button>
                    <button onClick={() => setEditingId(null)} aria-label={t('Cancel rename', 'Hủy đổi tên')}><X size={12} /></button>
                  </>
                ) : deletePending === project.id ? (
                  <><span className="delete-question">{t(`Delete “${project.name}”?`, `Xóa “${project.name}”?`)}</span><button className="confirm-delete" onClick={() => { onDelete(project.id); setDeletePending(null); }} aria-label={t('Confirm delete', 'Xác nhận xóa')}><Check size={12} /></button><button onClick={() => setDeletePending(null)} aria-label={t('Cancel delete', 'Hủy xóa')}><X size={12} /></button></>
                ) : (
                  <>
                    <button className="project-select" onClick={() => { onSelect(project.id); setOpen(false); }}>
                      <span className="project-dot"></span><span><strong>{project.name}</strong><small>{project.nodeCount || 0} nodes · {project.edgeCount || 0} links</small></span>
                    </button>
                    <button onClick={() => { setEditingId(project.id); setEditingName(project.name); }} aria-label={t(`Rename ${project.name}`, `Đổi tên ${project.name}`)}><Pencil size={11} /></button>
                    <button disabled={projects.length <= 1} onClick={() => setDeletePending(project.id)} aria-label={t(`Delete ${project.name}`, `Xóa ${project.name}`)}><Trash2 size={11} /></button>
                  </>
                )}
              </div>
            ))}
          </div>
          <form className="project-create" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) { onCreate(newName.trim()); setNewName(''); setOpen(false); } }}>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t('New project name', 'Tên project mới')} aria-label={t('New project name', 'Tên project mới')} />
            <button type="submit" disabled={!newName.trim()} aria-label={t('Create project', 'Tạo project')}><FolderPlus size={14} /></button>
          </form>
        </div>
      )}
    </div>
  );
}

function Sidebar({ collapsed, setCollapsed, addNode, counts, resetProject, openSettings, projects, activeProjectId, onSelectProject, onCreateProject, onRenameProject, onDeleteProject }) {
  const t = useTranslation();
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark"><Merge size={20} /></div>
        {!collapsed && <div><strong>mergeboard</strong><span>visual composer</span></div>}
        <button className="collapse-btn" onClick={() => setCollapsed(!collapsed)} aria-label={t('Collapse sidebar', 'Thu gọn thanh bên')}>
          {collapsed ? <Menu size={17} /> : <ChevronLeft size={17} />}
        </button>
      </div>

      {!collapsed && <><p className="side-label project-label">PROJECT</p><ProjectManager projects={projects} activeProjectId={activeProjectId} onSelect={onSelectProject} onCreate={onCreateProject} onRename={onRenameProject} onDelete={onDeleteProject} /></>}

      {!collapsed && <p className="side-label">{t('ADD NODE', 'THÊM NODE')}</p>}
      <nav className="node-menu">
        <button onClick={() => addNode('textNode')}><span className="menu-icon blue"><Type size={17} /></span>{!collapsed && <><span><strong>Text</strong><small>{t('Text content', 'Nội dung văn bản')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('imageNode')}><span className="menu-icon orange"><ImageIcon size={17} /></span>{!collapsed && <><span><strong>Image</strong><small>{t('Image & visual', 'Ảnh & visual')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('mixerNode')}><span className="menu-icon violet"><Merge size={17} /></span>{!collapsed && <><span><strong>Mixer</strong><small>{t('Collect resources', 'Gom tài nguyên')}</small></span><Plus size={15} /></>}</button>
        <button onClick={() => addNode('exampleNode')}><span className="menu-icon green"><BookOpenCheck size={17} /></span>{!collapsed && <><span><strong>Example</strong><small>{t('Reference image & input', 'Ảnh mẫu & input')}</small></span><Plus size={15} /></>}</button>
      </nav>

      {!collapsed && (
        <>
          <div className="workspace-card">
            <div className="workspace-card-title"><span><Sparkles size={14} /> Workspace</span><span className="saved"><Check size={11} /> {t('Saved', 'Đã lưu')}</span></div>
            <div className="stats"><div><strong>{counts.nodes}</strong><span>Nodes</span></div><div><strong>{counts.edges}</strong><span>Links</span></div></div>
          </div>
        </>
      )}

      <div className="sidebar-bottom">
        <button onClick={openSettings} title={t('Settings', 'Cài đặt')}><Settings size={16} />{!collapsed && <span>{t('Settings', 'Cài đặt')}</span>}</button>
        <button onClick={resetProject} title={t('Reset Base Template', 'Tạo lại Base Template')}><RotateCcw size={16} />{!collapsed && <span>Base Template</span>}</button>
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
  const [language, setLanguage] = useState(() => localStorage.getItem(LANGUAGE_KEY) || 'en');
  const t = useCallback((english, vietnamese) => language === 'vi' ? vietnamese : english, [language]);
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
  const { screenToFlowPosition, fitView, getNode, setCenter, getViewport, setViewport } = useReactFlow();
  const renderedNodeLayout = useStore(selectRenderedNodeLayout, sameRenderedNodeLayout);

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
    if (!previous) return showToast(t('Nothing to undo', 'Không còn thao tác để hoàn tác'), 'error');
    history.future.push(history.current);
    history.current = previous;
    restoreHistorySnapshot(previous);
    showToast(t('Undid the last action', 'Đã hoàn tác thao tác gần nhất'));
  }, [commitPendingHistory, restoreHistorySnapshot, showToast, t]);

  const redoGraph = useCallback(() => {
    commitPendingHistory();
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return showToast(t('Nothing to redo', 'Không còn thao tác để làm lại'), 'error');
    history.past.push(history.current);
    history.current = next;
    restoreHistorySnapshot(next);
    showToast(t('Redid the last action', 'Đã làm lại thao tác gần nhất'));
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
    if (!entry) throw new Error(t('Project not found', 'Không tìm thấy project'));
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
      if (permission !== 'granted') throw new Error(t('Read and write access was not granted', 'Bạn chưa cho phép đọc và ghi folder'));
      await fileStorage.useRoot(handle);
      await loadRootProjects();
      showToast(t('Project folder reconnected', 'Đã kết nối lại Folder lưu Project'));
    } catch (error) {
      showToast(error.message || t('Could not connect the project folder', 'Không thể kết nối folder project'), 'error');
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
      showToast(t(`Folder connected · ${list.length} project(s) found`, `Đã kết nối folder và nhận ${list.length} project`));
    } catch (error) {
      if (error?.name !== 'AbortError') showToast(error.message || t('Could not select the project folder', 'Không thể chọn Folder lưu Project'), 'error');
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
        showToast(error.message || t('Could not open project storage', 'Không thể mở bộ nhớ project'), 'error');
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
        if (!project) throw new Error(t('The active project was not found', 'Không tìm thấy project đang mở'));
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
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  const updateNode = useCallback((id, patch) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node));
  }, []);

  const focusNode = useCallback((nodeId) => {
    const target = getNode(nodeId);
    if (!target) return showToast(t('Input node not found', 'Không tìm thấy node input'), 'error');
    const position = target.positionAbsolute || target.position;
    const width = target.measured?.width || target.width || 300;
    const height = target.measured?.height || target.height || 180;
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
    setToolMode('select'); setContextMenu(null); setEdgeMenu(null);
    setCenter(position.x + width / 2, position.y + height / 2, { zoom: viewportZoom < 0.85 ? 1 : Math.min(viewportZoom, 1.2), duration: 650 });
    showToast(t(`Moved to “${target.data?.title || 'input node'}”`, `Đã di chuyển tới “${target.data?.title || 'node input'}”`));
  }, [getNode, setCenter, showToast, viewportZoom, t]);

  const uploadImage = useCallback(async (id, file) => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'Chưa chọn project'));
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      const uploaded = await fileStorage.uploadAsset(project, file, file.name);
      updateNode(id, { image: uploaded.url, assetFile: uploaded.assetFile, fileName: uploaded.fileName });
      showToast(t('Image saved to the project folder', 'Đã sao lưu ảnh vào folder project'));
    } catch (error) {
      showToast(error.message || t('Could not save the image', 'Không thể sao lưu ảnh'), 'error');
      throw error;
    }
  }, [showToast, updateNode, activeProjectId, t]);

  const revealAsset = useCallback(async (assetFile) => {
    try {
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      await fileStorage.revealAsset(project, assetFile);
    } catch (error) {
      showToast(error.message || t('Could not open the asset in Explorer', 'Không thể mở asset trong Explorer'), 'error');
    }
  }, [activeProjectId, showToast, t]);

  const addCanvasImage = useCallback(async (file, clientPoint = null) => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'Chưa chọn project'));
      const dataUrl = await fileToDataUrl(file);
      const imageSize = await getImageSize(dataUrl);
      const fileName = file.name || `clipboard-image-${Date.now()}.${file.type?.split('/')[1] || 'png'}`;
      const project = projectsRef.current.find((item) => item.id === activeProjectId);
      const uploaded = await fileStorage.uploadAsset(project, file, fileName);
      const scale = Math.min(1, 420 / imageSize.width, 340 / imageSize.height);
      const width = Math.max(80, Math.round(imageSize.width * scale));
      const height = Math.max(60, Math.round(imageSize.height * scale));
      const center = screenToFlowPosition(clientPoint || { x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const id = `canvasImageNode-${Date.now()}`;
      setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), {
        id,
        type: 'canvasImageNode',
        position: { x: center.x - width / 2, y: center.y - height / 2 },
        data: { image: uploaded.url, assetFile: uploaded.assetFile, fileName: uploaded.fileName, width, height },
        selected: true,
      }]);
      showToast(t('Image pasted onto the canvas', 'Đã dán ảnh vào canvas'));
    } catch (error) {
      showToast(error.message || t('Could not paste the image onto the canvas', 'Không thể dán ảnh vào canvas'), 'error');
    }
  }, [activeProjectId, screenToFlowPosition, showToast, t]);

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
    let file = [...(event.dataTransfer?.files || [])].find((item) => item.type.startsWith('image/')) || null;
    if (!file) {
      const html = event.dataTransfer?.getData('text/html');
      const source = html ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.src : event.dataTransfer?.getData('text/uri-list')?.split(/\r?\n/).find((line) => line && !line.startsWith('#'));
      if (source) {
        try {
          const blob = await (await fetch(source)).blob();
          if (blob.type.startsWith('image/')) file = new File([blob], `dropped-image-${Date.now()}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
        } catch { /* a remote image can be blocked by CORS */ }
      }
    }
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    await addCanvasImage(file, { x: event.clientX, y: event.clientY });
  }, [addCanvasImage]);

  useEffect(() => {
    const onPaste = async (event) => {
      let file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
      if (!file) {
        const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'));
        file = imageItem?.getAsFile() || null;
      }
      if (!file) {
        const html = event.clipboardData?.getData('text/html');
        const source = html ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.src : null;
        if (source) {
          try {
            const blob = await (await fetch(source)).blob();
            if (blob.type.startsWith('image/')) file = new File([blob], `web-image-${Date.now()}.${blob.type.split('/')[1] || 'png'}`, { type: blob.type });
          } catch { /* copied web image may be blocked by CORS */ }
        }
      }
      if (!file) return;
      event.preventDefault();
      const selectedImageNode = nodes.find((node) => node.selected && node.type === 'imageNode');
      if (selectedImageNode) await uploadImage(selectedImageNode.id, file);
      else await addCanvasImage(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addCanvasImage, nodes, uploadImage]);

  const removeNode = useCallback((id) => {
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    showToast(t('Node deleted', 'Đã xóa node'));
  }, [showToast, t]);

  const removeEdge = useCallback((id) => {
    setEdges((current) => current.filter((edge) => edge.id !== id));
    setEdgeCutPoints((current) => { const next = { ...current }; delete next[id]; return next; });
    showToast(t('Connection removed', 'Đã ngắt kết nối'));
  }, [showToast, t]);

  const copyResource = useCallback(async (value, kind) => {
    if (!value) return showToast(t('This resource is empty', 'Tài nguyên đang trống'), 'error');
    try {
      if (kind === 'image' && window.ClipboardItem) {
        const blob = await (await fetch(value)).blob();
        const pngBlob = blob.type === 'image/png' ? blob : await convertImageToPng(value);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
        showToast(t('Image copied to clipboard', 'Đã copy ảnh vào clipboard'));
      } else {
        await navigator.clipboard.writeText(value);
        showToast(kind === 'image' ? t('Image URL copied', 'Đã copy đường dẫn ảnh') : t('Content copied', 'Đã copy nội dung'));
      }
    } catch {
      try {
        await navigator.clipboard.writeText(value);
        showToast(t('Resource copied', 'Đã copy tài nguyên'));
      } catch { showToast(t('Clipboard access is not allowed', 'Trình duyệt chưa cho phép truy cập clipboard'), 'error'); }
    }
  }, [showToast, t]);

  const onNodesChange = useCallback((changes) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const onEdgesChange = useCallback((changes) => setEdges((current) => applyEdgeChanges(changes, current)), []);
  const setEdgeColor = useCallback((edgeId, color) => {
    setEdges((current) => current.map((edge) => edge.id === edgeId ? { ...edge, data: { ...(edge.data || {}), color } } : edge));
    setEdgeMenu(null);
    showToast(t('Connector color updated', 'Đã đổi màu dây nối'));
  }, [showToast, t]);
  const connectNodes = useCallback((connection) => {
    const target = nodes.find((node) => node.id === connection.target);
    if (!['mixerNode', 'exampleNode', 'joinNode'].includes(target?.type)) return showToast(t('Only Mixer, Example, or Join Point can receive input', 'Chỉ Mixer, Example hoặc Join Point mới nhận đầu vào'), 'error');
    if (connection.source === connection.target) return;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const collectSourceLineage = (nodeId, graphEdges, visited = new Set()) => {
      if (visited.has(nodeId)) return new Set();
      const sourceNode = nodeById.get(nodeId);
      if (!sourceNode) return new Set();
      if (['textNode', 'imageNode', 'exampleNode'].includes(sourceNode.type)) return new Set([sourceNode.id]);
      const nextVisited = new Set(visited).add(nodeId);
      const lineage = new Set();
      graphEdges.filter((edge) => edge.target === nodeId).forEach((edge) => {
        collectSourceLineage(edge.source, graphEdges, nextVisited).forEach((sourceId) => lineage.add(sourceId));
      });
      return lineage;
    };
    const findDuplicateInputs = (graphEdges) => {
      const duplicates = new Map();
      nodes.filter((node) => ['mixerNode', 'exampleNode', 'joinNode'].includes(node.type)).forEach((receiver) => {
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
      const affectedNames = [...new Set(newDuplicates.map(({ receiverId }) => nodeById.get(receiverId)?.data?.title || t('receiver node', 'node nhận')))].join(', ');
      showToast(t(`Duplicate input: ${duplicateNames} at ${affectedNames}`, `Bị trùng input: ${duplicateNames} tại ${affectedNames}`), 'error');
      return false;
    }
    const alreadyConnected = edges.some((edge) => (
      (edge.source === connection.source && edge.target === connection.target)
      || (edge.source === connection.target && edge.target === connection.source)
    ));
    if (alreadyConnected) {
      showToast(t('These nodes are already connected · only one connector is allowed', 'Hai node này đã có connector · chỉ cho phép tối đa 1 dây'), 'error');
      return false;
    }
    const createsCycle = (start, sought, visited = new Set()) => {
      if (start === sought) return true;
      if (visited.has(start)) return false;
      visited.add(start);
      return edges.filter((edge) => edge.source === start).some((edge) => createsCycle(edge.target, sought, visited));
    };
    if (createsCycle(connection.target, connection.source)) return showToast(t('A loop cannot be created between nodes', 'Không thể tạo vòng lặp giữa các node'), 'error');
    const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setEdges((current) => addEdge({
      ...connection,
      id: edgeId,
      sourceHandle: `out-${edgeId}`,
      targetHandle: `in-${edgeId}`,
      type: 'beam',
      data: { color: 'gradient' },
    }, current));
    showToast(target.type === 'exampleNode' ? t('Connected to Example Node', 'Đã kết nối vào Node Example') : target.type === 'joinNode' ? t('Connected to Join Point', 'Đã kết nối vào Join Point') : t('Connected to Mixer', 'Đã kết nối vào Mixer'));
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
    const position = requestedPosition || screenToFlowPosition({ x: window.innerWidth / 2 + 80, y: window.innerHeight / 2 });
    const defaults = {
      textNode: { title: t('New Text', 'Text mới'), content: '', viewMode: 'expanded', color: '#3b82f6' },
      imageNode: { title: t('New Image', 'Ảnh mới'), image: '', fileName: '', viewMode: 'expanded', color: '#f59e0b' },
      mixerNode: { title: t('New Mixer', 'Mixer mới'), viewMode: 'expanded', color: '#7c6cf2' },
      exampleNode: { title: t('Example Node', 'Node Example'), image: '', fileName: '', viewMode: 'expanded', color: '#10b981' },
    };
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), { id, type, position, data: defaults[type], selected: true }]);
    setContextMenu(null);
    const label = type === 'textNode' ? 'Text' : type === 'imageNode' ? 'Image' : type === 'mixerNode' ? 'Mixer' : t('Example Node', 'Node Example');
    showToast(t(`Added ${label}`, `Đã thêm ${label}`));
  }, [screenToFlowPosition, showToast, t]);

  const duplicateSelected = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    if (!selectedNodes.length) {
      showToast(t('Select at least one node before duplicating', 'Hãy chọn node trước khi nhân bản'), 'error');
      return;
    }
    const timestamp = Date.now();
    const copies = selectedNodes.map((node, index) => ({
      ...node,
      id: `${node.type}-${timestamp}-${index}`,
      position: { x: node.position.x + 42 + index * 10, y: node.position.y + 42 + index * 10 },
      selected: true,
      data: { ...node.data, title: `${node.data.title || 'Node'} · ${t('copy', 'bản sao')}` },
    }));
    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    showToast(t(`Duplicated ${copies.length} node(s)`, `Đã nhân bản ${copies.length} node`));
  }, [nodes, showToast, t]);

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
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 's') {
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
    const menuHeight = 222;
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
    if (clientWidth < 70 || clientHeight < 50) return showToast(t('Drag a larger area to create a Section', 'Kéo một vùng lớn hơn để tạo Section'), 'error');
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
      },
      selected: true,
    }]);
    showToast(t('Section Group created · press V to return to Select', 'Đã tạo Section Group · nhấn V để quay lại Select'));
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
    if (!['joinNode', 'canvasImageNode'].includes(node.type)) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setEdgeMenu(null);
    if (node.type === 'canvasImageNode') {
      setJoinMenu(null);
      setCanvasImageMenu({
        nodeId: node.id,
        x: Math.min(event.clientX, window.innerWidth - 198),
        y: Math.min(event.clientY, window.innerHeight - 92),
      });
      return;
    }
    setCanvasImageMenu(null);
    setJoinMenu({
      nodeId: node.id,
      color: node.data?.color || '#8b7cf6',
      paletteOpen: false,
      x: Math.min(event.clientX, window.innerWidth - 198),
      y: Math.min(event.clientY, window.innerHeight - 218),
    });
  }, []);

  const enableJoinMove = useCallback(() => {
    if (!joinMenu?.nodeId) return;
    setMovableJoinId(joinMenu.nodeId);
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === joinMenu.nodeId })));
    setJoinMenu(null);
    showToast(t('Drag the Join Point to a new position', 'Kéo Join Point tới vị trí mới'));
  }, [joinMenu, showToast, t]);

  const setJoinPointColor = useCallback((color) => {
    if (!joinMenu?.nodeId) return;
    updateNode(joinMenu.nodeId, { color });
    setJoinMenu(null);
    showToast(t('Join Point color updated', 'Đã đổi màu Join Point'));
  }, [joinMenu, showToast, updateNode, t]);

  const makeCanvasImageNode = useCallback(() => {
    if (!canvasImageMenu?.nodeId) return;
    setNodes((current) => current.map((node) => {
      if (node.id !== canvasImageMenu.nodeId) return node;
      const { width: _width, height: _height, measured: _measured, ...baseNode } = node;
      const title = (node.data.fileName || t('Image', 'Ảnh')).replace(/\.[^.]+$/, '');
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
    setCanvasImageMenu(null);
    showToast(t('Image converted to an Image Node', 'Đã chuyển ảnh thành Image Node'));
  }, [canvasImageMenu, showToast, t]);

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
    showToast(t('Join Point created on the connector', 'Đã tạo Join Point trên dây nối'));
  }, [edgeMenu, nodes, showToast, t]);

  const resetProject = useCallback(async () => {
    try {
      if (!activeProjectId) throw new Error(t('No project selected', 'Chưa chọn project'));
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
      showToast(t('Base Template restored and saved', 'Đã tạo và sao lưu Base Template'));
      setTimeout(() => fitView({ padding: 0.18, duration: 600 }), 80);
    } catch (error) {
      showToast(error.message || t('Could not restore the project', 'Không thể khôi phục project'), 'error');
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
      showToast(t('Project switched', 'Đã chuyển project'));
    } catch (error) { showToast(error.message || t('Could not switch projects', 'Không thể chuyển project'), 'error'); setStorageReady(true); }
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
      await loadProjectById(project.id);
      showToast(t(`Project “${project.name}” created`, `Đã tạo project “${project.name}”`));
    } catch (error) { showToast(error.message || t('Could not create the project', 'Không thể tạo project'), 'error'); }
  }, [activeProjectId, storageReady, nodes, edges, loadProjectById, showToast, t]);

  const renameProject = useCallback(async (projectId, name) => {
    try {
      const project = projectsRef.current.find((item) => item.id === projectId);
      const updated = await fileStorage.renameProject(project, name, projectsRef.current);
      updateProjects((current) => current.map((item) => item.id === projectId ? updated : item));
      showToast(t('Project and folder renamed', 'Đã đổi tên project và folder'));
    } catch (error) { showToast(error.message || t('Could not rename the project', 'Không thể đổi tên'), 'error'); }
  }, [showToast, updateProjects, t]);

  const deleteProject = useCallback(async (projectId) => {
    try {
      if (projects.length <= 1) throw new Error(t('At least one project must remain', 'Phải giữ lại ít nhất một project'));
      const project = projects.find((item) => item.id === projectId);
      await fileStorage.deleteProject(project);
      const remaining = projects.filter((project) => project.id !== projectId);
      projectsRef.current = remaining;
      setProjects(remaining);
      if (projectId === activeProjectId && remaining[0]) await loadProjectById(remaining[0].id);
      showToast(t('Project and its resource folder deleted', 'Đã xóa project và toàn bộ folder tài nguyên'));
    } catch (error) { showToast(error.message || t('Could not delete the project', 'Không thể xóa project'), 'error'); }
  }, [projects, activeProjectId, loadProjectById, showToast, t]);

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
        if (source.type === 'textNode') {
          return [{ sourceId: source.id, kind: 'text', title: source.data.title, value: source.data.content, sourceColor: source.data.color }];
        }
        if (source.type === 'imageNode') {
          return source.data.image
            ? [{ sourceId: source.id, kind: 'image', title: source.data.title, value: source.data.image, sourceColor: source.data.color }]
            : [];
        }
        if (source.type === 'exampleNode') {
          return source.data.image
            ? [{ sourceId: source.id, kind: 'image', title: source.data.title, value: source.data.image, sourceColor: source.data.color }]
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
        if (source.type === 'textNode') return [{ id: source.id, kind: 'text', title: source.data.title }];
        if (source.type === 'imageNode') return [{ id: source.id, kind: 'image', title: source.data.title }];
        if (source.type === 'exampleNode') return [{ id: source.id, kind: 'example', title: source.data.title }];
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
      const nodeData = { ...node.data, inputPorts, outputPorts, moveEnabled: node.id === movableJoinId };
      if (node.type === 'sectionNode') return { ...node, zIndex: -1000, data: { ...node.data, zoom: viewportZoom } };
      if (node.type === 'exampleNode') {
        const collected = collectInputNodes(node.id);
        const inputTitles = sortInputTitles(collected.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
        return { ...node, data: { ...nodeData, inputTitles } };
      }
      if (node.type !== 'mixerNode') return { ...node, data: nodeData };
      const collectedInputs = collectInputNodes(node.id);
      const inputTitles = sortInputTitles(collectedInputs.filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
      const collected = collectResources(node.id);
      const unique = collected.filter((resource, index, all) => all.findIndex((item) => item.sourceId === resource.sourceId && item.kind === resource.kind) === index);
      const images = unique.filter((resource) => resource.kind === 'image');
      const texts = unique.filter((resource) => resource.kind === 'text' && resource.value?.trim());
      const combinedText = texts.length ? [{
        sourceId: texts.map((resource) => resource.sourceId).join('-'),
        kind: 'text',
        title: texts.length === 1 ? texts[0].title : t(`${texts.length} text entries`, `${texts.length} nội dung text`),
        value: texts.map((resource) => resource.value.trim()).join('\n\n'),
        segments: texts.map((resource) => ({ sourceId: resource.sourceId, title: resource.title, value: resource.value.trim(), color: resource.sourceColor })),
        count: texts.length,
      }] : [];
      return { ...node, data: { ...nodeData, resources: [...images, ...combinedText], resourceCount: unique.length, inputTitles } };
    });
  }, [nodes, edges, viewportZoom, movableJoinId, renderedNodeLayoutById, t]);

  const displayEdges = useMemo(() => {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodeTypeById = new Map(nodes.map((node) => [node.id, node.type]));
    const selectedNodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
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
    const portPlacementFor = (edge, direction) => {
      const nodeId = direction === 'source' ? edge.source : edge.target;
      const connectedEdges = edges
        .filter((candidate) => direction === 'source' ? candidate.source === nodeId : candidate.target === nodeId)
        .sort((a, b) => {
          const aOther = direction === 'source' ? a.target : a.source;
          const bOther = direction === 'source' ? b.target : b.source;
          return centerYFor(aOther) - centerYFor(bOther) || a.id.localeCompare(b.id);
        });
      const index = connectedEdges.findIndex((candidate) => candidate.id === edge.id);
      if (nodeTypeById.get(nodeId) === 'joinNode') return { offset: 0, index: Math.max(0, index) };
      const totalHeight = connectedEdges.length * 18 + 18 + connectedEdges.length * 24;
      return { offset: -totalHeight / 2 + 9 + Math.max(0, index) * 42, index: Math.max(0, index) };
    };
    const routingObstacles = nodes
      .filter((node) => node.type !== 'sectionNode')
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
    const reservedLineObstacles = [];
    return edges.map((edge) => {
      const sourceGeometry = geometryFor(edge.source);
      const targetGeometry = geometryFor(edge.target);
      let routedPoints = null;
      let sourceLead = 28;
      let targetLead = 28;
      if (sourceGeometry && targetGeometry) {
        const sourcePlacement = portPlacementFor(edge, 'source');
        const targetPlacement = portPlacementFor(edge, 'target');
        sourceLead = 28 + sourcePlacement.index * 24;
        targetLead = 28 + targetPlacement.index * 24;
        const sourcePoint = { x: sourceGeometry.x + sourceGeometry.width, y: sourceGeometry.y + sourceGeometry.height / 2 + sourcePlacement.offset };
        const targetPoint = { x: targetGeometry.x, y: targetGeometry.y + targetGeometry.height / 2 + targetPlacement.offset };
        routedPoints = makeOrthogonalRoute(sourcePoint, targetPoint, [...routingObstacles, ...reservedLineObstacles], sourceLead, targetLead)
          || makeOrthogonalRoute(sourcePoint, targetPoint, routingObstacles, sourceLead, targetLead);
        if (routedPoints) reservedLineObstacles.push(...routeSegmentsAsObstacles(routedPoints));
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
          relatedHighlighted: selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target),
          cutPoint: edgeCutPoints[edge.id],
          routingObstacles,
          routedPoints,
          sourceLead,
          targetLead,
        },
      };
    });
  }, [nodes, edges, edgeCutPoints, renderedNodeLayoutById]);
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

  const actions = useMemo(() => ({ updateNode, removeNode, copyResource, showToast, uploadImage, revealAsset, focusNode }), [updateNode, removeNode, copyResource, showToast, uploadImage, revealAsset, focusNode]);
  const edgeActions = useMemo(() => ({ removeEdge }), [removeEdge]);

  return (
    <LanguageContext.Provider value={{ language, t }}>
    <NodeActionsContext.Provider value={actions}>
      <EdgeActionsContext.Provider value={edgeActions}>
      <main className={`app-shell theme-${theme}`} style={connectorStyle}>
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} addNode={addNode} counts={{ nodes: nodes.length, edges: edges.length }} resetProject={resetProject} openSettings={openSettingsPanel} projects={projects} activeProjectId={activeProjectId} onSelectProject={selectProject} onCreateProject={createProject} onRenameProject={renameProject} onDeleteProject={deleteProject} />
        <section
          className="canvas-area"
          ref={canvasRef}
          onContextMenu={openCanvasMenu}
          onPointerDownCapture={rememberSelectionStart}
          onDragOver={onCanvasImageDragOver}
          onDrop={onCanvasImageDrop}
        >
          <div className="canvas-topbar">
            <div><span className="project-kicker">PROJECT</span><strong>{projects.find((project) => project.id === activeProjectId)?.name || t('Loading…', 'Đang tải...')}</strong></div>
            <span className={`autosave ${saveStatus}`}><span></span> {saveStatus === 'loading' ? t('Opening folder', 'Đang mở folder') : saveStatus === 'saving' ? t('Saving locally', 'Đang lưu local') : saveStatus === 'error' ? t('Local save error', 'Lỗi lưu local') : t('Saved to local folder', 'Đã lưu vào folder local')}</span>
            <button
              className="top-icon theme-toggle"
              title={theme === 'dark' ? t('Switch to Light mode', 'Chuyển sang Light mode') : t('Switch to Dark mode', 'Chuyển sang Dark mode')}
              aria-label={theme === 'dark' ? t('Switch to Light mode', 'Chuyển sang Light mode') : t('Switch to Dark mode', 'Chuyển sang Dark mode')}
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
          <div className="canvas-toolbox" aria-label={t('Canvas tools', 'Công cụ canvas')}>
            <button className={toolMode === 'select' ? 'active' : ''} onClick={() => { setToolMode('select'); setSectionDraft(null); }} title="Select" aria-label="Select"><MousePointer2 size={18} /><kbd>V</kbd></button>
            <button className={toolMode === 'section' ? 'active' : ''} onClick={() => { setToolMode('section'); setContextMenu(null); setEdgeMenu(null); }} title="Section Group" aria-label="Section Group"><Square size={18} /><kbd>Shift + S</kbd></button>
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
            onNodeDragStop={(_event, node) => { if (node.id === movableJoinId) setMovableJoinId(null); }}
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
            <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label={t('Add node', 'Thêm node')}>
              <div className="context-menu-title"><span>{t('ADD NODE', 'THÊM NODE')}</span><kbd>Right click</kbd></div>
              <button role="menuitem" onClick={() => addNode('textNode', contextMenu.flowPosition)}><span className="menu-icon blue"><Type size={15} /></span><span>Text</span><Plus size={13} /></button>
              <button role="menuitem" onClick={() => addNode('imageNode', contextMenu.flowPosition)}><span className="menu-icon orange"><ImageIcon size={15} /></span><span>Image</span><Plus size={13} /></button>
              <button role="menuitem" onClick={() => addNode('mixerNode', contextMenu.flowPosition)}><span className="menu-icon violet"><Merge size={15} /></span><span>Mixer</span><Plus size={13} /></button>
              <button role="menuitem" onClick={() => addNode('exampleNode', contextMenu.flowPosition)}><span className="menu-icon green"><BookOpenCheck size={15} /></span><span>Example</span><Plus size={13} /></button>
              <div className="context-menu-shortcut"><span>{t('Duplicate selected node', 'Nhân bản node đã chọn')}</span><kbd>Ctrl D</kbd></div>
            </div>
          )}
          {joinMenu && (
            <div className="canvas-context-menu join-context-menu" style={{ left: joinMenu.x, top: joinMenu.y }} role="menu" aria-label={t('Join Point options', 'Tùy chọn Join Point')}>
              <div className="context-menu-title"><span>JOIN POINT</span><kbd>Right click</kbd></div>
              <button role="menuitem" onClick={enableJoinMove}><span className="menu-icon violet"><MousePointer2 size={15} /></span><span>{t('Move Join Point', 'Di chuyển Join Point')}</span><ArrowRight size={13} /></button>
              <button role="menuitem" onClick={() => setJoinMenu((current) => current ? { ...current, paletteOpen: !current.paletteOpen } : null)}><span className="menu-icon violet"><Palette size={15} /></span><span>{t('Change color', 'Chỉnh màu')}</span><ChevronDown size={13} /></button>
              {joinMenu.paletteOpen && (
                <div className="join-color-grid">
                  {NODE_COLORS.map((color) => <button key={color} className={joinMenu.color === color ? 'active' : ''} style={{ '--join-swatch': color }} onClick={() => setJoinPointColor(color)} aria-label={t(`Join Point color ${color}`, `Màu Join Point ${color}`)} />)}
                </div>
              )}
            </div>
          )}
          {canvasImageMenu && (
            <div className="canvas-context-menu canvas-image-context-menu" style={{ left: canvasImageMenu.x, top: canvasImageMenu.y }} role="menu" aria-label={t('Canvas image options', 'Tùy chọn ảnh canvas')}>
              <div className="context-menu-title"><span>CANVAS IMAGE</span><kbd>Right click</kbd></div>
              <button role="menuitem" onClick={makeCanvasImageNode}><span className="menu-icon orange"><ImageIcon size={15} /></span><span>Make node</span><ArrowRight size={13} /></button>
            </div>
          )}
          {edgeMenu && (
            <div className="edge-color-menu" style={{ left: edgeMenu.x, top: edgeMenu.y }} role="menu" aria-label={t('Choose connector color', 'Chọn màu dây nối')}>
              <div className="edge-color-title"><Palette size={13} /> {t('CONNECTOR COLOR', 'MÀU DÂY NỐI')}</div>
              <button className={`edge-gradient-option ${edgeMenu.color === 'gradient' ? 'active' : ''}`} onClick={() => setEdgeColor(edgeMenu.edgeId, 'gradient')}><span></span><strong>{t('Gradient from node colors', 'Gradient theo màu node')}</strong></button>
              <div className="edge-color-grid">
                {EDGE_COLORS.map((color, index) => (
                  <button
                    key={color}
                    className={edgeMenu.color === color ? 'active' : ''}
                    style={{ '--edge-swatch': color }}
                    onClick={() => setEdgeColor(edgeMenu.edgeId, color)}
                    aria-label={t(`Connector color ${index + 1}`, `Màu dây ${index + 1}`)}
                  />
                ))}
              </div>
              <button className="create-join-button" onClick={createJoinPoint}><Waypoints size={15} /><span><strong>{t('Create Join Point', 'Tạo Join Point')}</strong><small>{t('Merge flows at this position', 'Gom luồng tại vị trí này')}</small></span></button>
            </div>
          )}
        </section>
        {storageGate !== 'ready' && (
          <div className="storage-setup-overlay">
            <section className="storage-setup-card" role="dialog" aria-modal="true" aria-label={t('Connect project folder', 'Kết nối folder project')}>
              <div className="storage-setup-icon"><FolderKanban size={28} /></div>
              <span className="storage-setup-kicker">MERGEBOARD LOCAL STORAGE</span>
              <h1>{storageGate === 'checking' ? t('Checking folder…', 'Đang kiểm tra folder…') : storageGate === 'unsupported' ? t('Browser not supported', 'Trình duyệt chưa được hỗ trợ') : storageGate === 'needs-permission' ? t('Restore folder access', 'Cho phép truy cập lại folder') : t('Choose project storage', 'Chọn nơi lưu project')}</h1>
              <p>{storageGate === 'unsupported' ? t('Open this page in Chrome or Microsoft Edge on a desktop computer.', 'Hãy mở trang này bằng Chrome hoặc Microsoft Edge trên máy tính.') : t('Projects, images, and content are read and written directly on your computer. No project data is uploaded to Vercel.', 'Project, ảnh và nội dung sẽ được đọc/ghi trực tiếp trên máy của bạn. Không có dữ liệu project nào được tải lên Vercel.')}</p>
              {storageGate !== 'checking' && storageGate !== 'unsupported' && (
                <div className="storage-setup-actions">
                  {storageGate === 'needs-permission' && <button onClick={connectRememberedFolder} disabled={choosingAssetFolder}><Check size={17} />{choosingAssetFolder ? t('Waiting for confirmation…', 'Đang chờ xác nhận…') : t('Allow access', 'Cho phép truy cập')}</button>}
                  <button className={storageGate === 'needs-permission' ? 'secondary' : ''} onClick={chooseProjectFolder} disabled={choosingAssetFolder}><FolderOpen size={17} />{choosingAssetFolder ? t('Waiting for folder selection…', 'Đang chờ chọn folder…') : storageGate === 'needs-permission' ? t('Choose another folder', 'Chọn folder khác') : t('Choose project folder', 'Chọn folder project')}</button>
                </div>
              )}
              <small>{t('Chrome/Edge will show a secure dialog for you to choose the folder.', 'Chrome/Edge sẽ hiện hộp thoại bảo mật để bạn tự chọn folder.')}</small>
            </section>
          </div>
        )}
        {settingsOpen && (
          <div className="settings-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !choosingAssetFolder) setSettingsOpen(false); }}>
            <section className="settings-panel" role="dialog" aria-modal="true" aria-label={t('MergeBoard Settings', 'Cài đặt MergeBoard')}>
              <header><div><Settings size={18} /><span><strong>{t('Settings', 'Cài đặt')}</strong><small>MergeBoard workspace</small></span></div><button onClick={() => setSettingsOpen(false)} disabled={choosingAssetFolder} aria-label={t('Close settings', 'Đóng cài đặt')}><X size={16} /></button></header>
              <div className="settings-content">
                <div className="settings-label"><Languages size={15} /><span><strong>{t('Language', 'Ngôn ngữ')}</strong><small>{t('Choose the interface language.', 'Chọn ngôn ngữ hiển thị của giao diện.')}</small></span></div>
                <div className="language-options" role="radiogroup" aria-label={t('Interface language', 'Ngôn ngữ giao diện')}>
                  <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} role="radio" aria-checked={language === 'en'}>English</button>
                  <button className={language === 'vi' ? 'active' : ''} onClick={() => setLanguage('vi')} role="radio" aria-checked={language === 'vi'}>Tiếng Việt</button>
                </div>
                <div className="settings-divider" />
                <div className="settings-label"><FolderOpen size={15} /><span><strong>{t('Project storage folder', 'Folder lưu Project')}</strong><small>{t('Each project is an independent folder containing nodes, text, and assets.', 'Mỗi project là một folder độc lập, gồm hệ thống node, text và toàn bộ asset.')}</small></span></div>
                <div className="settings-path" title={appSettings?.projectRoot || ''}>{appSettings?.projectRoot || t('No folder connected', 'Chưa kết nối folder')}</div>
                <button className="choose-folder-button" onClick={chooseProjectFolder} disabled={choosingAssetFolder}><FolderOpen size={16} /><span>{choosingAssetFolder ? t('Waiting for folder selection…', 'Đang chờ bạn chọn folder...') : t('Choose folder', 'Chọn folder')}</span></button>
                <p>{t('The browser displays only the folder name, not its full path. Choosing another folder switches workspaces; data in the old folder remains untouched.', 'Trình duyệt chỉ cho phép hiển thị tên folder, không hiển thị đường dẫn đầy đủ. Chọn folder khác sẽ chuyển workspace; dữ liệu trong folder cũ vẫn được giữ nguyên.')}</p>
              </div>
            </section>
          </div>
        )}
        {toast && <div className={`toast ${toast.type}`} key={toast.key}>{toast.type === 'success' ? <Check size={16} /> : <X size={16} />}{toast.message}</div>}
      </main>
      </EdgeActionsContext.Provider>
    </NodeActionsContext.Provider>
    </LanguageContext.Provider>
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
