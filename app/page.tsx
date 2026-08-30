'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronUp, Circle, Copy, Crop, Download, Eye, EyeOff,
  FlipHorizontal2, FlipVertical2, ImagePlus, Images, Layers3, Minimize2, MousePointer2,
  FileDown, FileUp, FolderOpen, Link2, Plus, Redo2, RotateCcw, Save, SlidersHorizontal,
  Sparkles, Square, Trash2, Type, Undo2, Unlink2, Upload, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import Konva from 'konva';
import { Image as KonvaImage, Layer, Rect, Stage, Text, Transformer } from 'react-konva';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { MaskCleanup } from '@/components/mask-cleanup';
import { cropFractions, cropPatch, isProjectFile, moveLayerById, PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION } from '@/lib/editor-model.js';

type BaseLayer = {
  id: string; name: string; type: 'image' | 'text' | 'shape'; x: number; y: number;
  width: number; height: number; rotation: number; flipX: boolean; flipY: boolean; visible: boolean;
};
type ImageItem = BaseLayer & {
  type: 'image'; src: string; brightness: number; contrast: number; saturation: number;
  blur: number; cropX: number; cropY: number; cropLeft?: number; cropRight?: number; cropTop?: number;
  cropBottom?: number; role?: 'background'; originalBytes?: number; encodedBytes?: number; preRemovalSrc?: string;
};
type TextItem = BaseLayer & { type: 'text'; text: string; fontSize: number; fill: string };
type ShapeItem = BaseLayer & { type: 'shape'; shape: 'rectangle' | 'ellipse'; fill: string };
type EditorLayer = ImageItem | TextItem | ShapeItem;
type Project = { id: string; name: string; layers: EditorLayer[]; selectedId: string | null; updatedAt: number };
type ExportType = 'image/png' | 'image/jpeg' | 'image/webp';

const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 480;
const STORAGE_KEY = 'luma-image-studio-project-v1';
const PROJECTS_KEY = 'luma-image-studio-projects-v1';
const ACTIVE_PROJECT_KEY = 'luma-image-studio-active-project-v1';
const createProject = (name = 'Untitled project'): Project => ({ id: uid(), name, layers: [], selectedId: null, updatedAt: Date.now() });
const emptyProject: Project = { id: 'initial', name: 'Untitled project', layers: [], selectedId: null, updatedAt: Date.now() };
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const snapshot = (project: Project): Project => JSON.parse(JSON.stringify(project)) as Project;

function ImageNode({ item, selected, disabled, onSelect, onChange }: {
  item: ImageItem; selected: boolean; disabled?: boolean; onSelect: () => void; onChange: (patch: Partial<ImageItem>) => void;
}) {
  const nodeRef = useRef<Konva.Image>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const next = new window.Image();
    next.onload = () => setImage(next);
    next.src = item.src;
  }, [item.src]);
  useEffect(() => {
    const node = nodeRef.current;
    if (!node || !image) return;
    node.clearCache();
    node.cache();
    node.getLayer()?.batchDraw();
  }, [image, item.width, item.height, item.brightness, item.contrast, item.saturation, item.blur, item.cropX, item.cropY]);
  if (!image || !item.visible) return null;
  const crop = cropFractions(item);
  return (
    <KonvaImage
      id={item.id} ref={nodeRef} image={image} x={item.x} y={item.y} width={item.width} height={item.height}
      rotation={item.rotation} scaleX={item.flipX ? -1 : 1} scaleY={item.flipY ? -1 : 1} offsetX={item.flipX ? item.width : 0} offsetY={item.flipY ? item.height : 0}
      crop={{ x: image.width * crop.left, y: image.height * crop.top, width: image.width * Math.max(.01, 1 - crop.left - crop.right), height: image.height * Math.max(.01, 1 - crop.top - crop.bottom) }}
      draggable={!disabled} filters={[Konva.Filters.Brighten, Konva.Filters.Contrast, Konva.Filters.HSL, Konva.Filters.Blur]}
      brightness={item.brightness} contrast={item.contrast} saturation={item.saturation} blurRadius={item.blur}
      onClick={onSelect} onTap={onSelect}
      onDragEnd={(event) => onChange({ x: event.target.x(), y: event.target.y() })}
      onTransformEnd={() => {
        const node = nodeRef.current;
        if (!node) return;
        const scaleX = Math.abs(node.scaleX());
        const scaleY = Math.abs(node.scaleY());
        node.scaleX(item.flipX ? -1 : 1); node.scaleY(item.flipY ? -1 : 1);
        onChange({ x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(24, node.width() * scaleX), height: Math.max(24, node.height() * scaleY) });
      }}
      shadowColor="#332c24" shadowBlur={selected ? 8 : 0} shadowOpacity={selected ? 0.12 : 0}
    />
  );
}

export default function Home() {
  const fileRef = useRef<HTMLInputElement>(null);
  const backgroundFileRef = useRef<HTMLInputElement>(null);
  const projectImportRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const cropTransformerRef = useRef<Konva.Transformer>(null);
  const cropRectRef = useRef<Konva.Rect>(null);
  const removalRunRef = useRef(0);
  const projectsRef = useRef<Project[]>([emptyProject]);
  const historyRef = useRef<Project[]>([emptyProject]);
  const historyIndexRef = useRef(0);
  const [project, setProject] = useState<Project>(emptyProject);
  const [zoom, setZoom] = useState(0.9);
  const [draggingOver, setDraggingOver] = useState(false);
  const [panelTab, setPanelTab] = useState<'layers' | 'adjust'>('layers');
  const [exportType, setExportType] = useState<ExportType>('image/png');
  const [saveStatus, setSaveStatus] = useState('Ready');
  const [lockRatio, setLockRatio] = useState(true);
  const [compressionQuality, setCompressionQuality] = useState(.72);
  const [compressionMax, setCompressionMax] = useState(1200);
  const [removalStatus, setRemovalStatus] = useState<'idle' | 'loading' | 'processing' | 'done' | 'error'>('idle');
  const [removalProgress, setRemovalProgress] = useState(0);
  const [removalMessage, setRemovalMessage] = useState('Ready to isolate the subject');
  const [historyVersion, setHistoryVersion] = useState(0);
  const [projectList, setProjectList] = useState<Project[]>([emptyProject]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [cleanupId, setCleanupId] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, width: 100, height: 100 });
  const hydratedRef = useRef(false);

  const selected = project.layers.find((item) => item.id === project.selectedId) ?? null;
  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  const commit = useCallback((nextProject: Project) => {
    const next = snapshot({ ...nextProject, updatedAt: Date.now() });
    const before = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current = [...before, next].slice(-40);
    historyIndexRef.current = historyRef.current.length - 1;
    setProject(next);
    setHistoryVersion((value) => value + 1);
  }, []);

  const replaceLayer = useCallback((id: string, patch: Partial<EditorLayer>, save = true) => {
    const next = { ...project, layers: project.layers.map((item) => item.id === id ? { ...item, ...patch } as EditorLayer : item) };
    if (save) commit(next); else setProject(next);
  }, [commit, project]);

  useEffect(() => {
    try {
      const savedProjects = window.localStorage.getItem(PROJECTS_KEY);
      const legacy = window.localStorage.getItem(STORAGE_KEY);
      let restoredProjects = savedProjects ? JSON.parse(savedProjects) as Project[] : [];
      if (!restoredProjects.length && legacy) restoredProjects = [{ ...JSON.parse(legacy) as Project, id: uid() }];
      if (!restoredProjects.length) restoredProjects = [createProject()];
      restoredProjects = restoredProjects.map((item) => ({ ...item, id: item.id || uid() }));
      const activeId = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
      const restored = restoredProjects.find((item) => item.id === activeId) ?? restoredProjects[0];
      if (restored) {
        projectsRef.current = restoredProjects;
        setProjectList(restoredProjects);
        setProject(restored);
        historyRef.current = [snapshot(restored)];
        historyIndexRef.current = 0;
        setSaveStatus('Restored locally');
      }
    } catch { setSaveStatus('Local save unavailable'); }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    setSaveStatus('Saving…');
    const timer = window.setTimeout(() => {
      try {
        const nextProjects = projectsRef.current.some((item) => item.id === project.id)
          ? projectsRef.current.map((item) => item.id === project.id ? project : item)
          : [...projectsRef.current, project];
        projectsRef.current = nextProjects;
        setProjectList(nextProjects);
        window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(nextProjects));
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
        setSaveStatus('Saved locally');
      }
      catch { setSaveStatus('Storage full — export your work'); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage) return;
    const node = project.selectedId ? stage.findOne(`#${project.selectedId}`) : null;
    transformer.nodes(!cropMode && node && node.isVisible() ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [project.selectedId, project.layers, cropMode]);

  useEffect(() => {
    const transformer = cropTransformerRef.current;
    const rectangle = cropRectRef.current;
    transformer?.nodes(cropMode && rectangle ? [rectangle] : []);
    transformer?.getLayer()?.batchDraw();
  }, [cropMode, cropBox]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); stepHistory(event.shiftKey ? 1 : -1); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); stepHistory(1); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && project.selectedId) { event.preventDefault(); deleteLayer(project.selectedId); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const stepHistory = (direction: -1 | 1) => {
    const target = historyIndexRef.current + direction;
    if (target < 0 || target >= historyRef.current.length) return;
    historyIndexRef.current = target;
    setProject(snapshot(historyRef.current[target]));
    setHistoryVersion((value) => value + 1);
  };

  const fileToLayer = (file: File) => new Promise<ImageItem | null>((resolve) => {
    if (!file.type.startsWith('image/')) { resolve(null); return; }
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      const maxSource = 1600;
      const sourceScale = Math.min(maxSource / image.width, maxSource / image.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * sourceScale)); canvas.height = Math.max(1, Math.round(image.height * sourceScale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL('image/webp', 0.9);
      const encodedBytes = Math.round((src.length - src.indexOf(',') - 1) * .75);
      const fit = Math.min(460 / canvas.width, 320 / canvas.height, 1);
      const width = Math.round(canvas.width * fit); const height = Math.round(canvas.height * fit);
      URL.revokeObjectURL(url);
      resolve({ id: uid(), name: file.name, type: 'image', src, x: (CANVAS_WIDTH - width) / 2, y: (CANVAS_HEIGHT - height) / 2, width, height, rotation: 0, flipX: false, flipY: false, visible: true, brightness: 0, contrast: 0, saturation: 0, blur: 0, cropX: 0, cropY: 0, originalBytes: file.size, encodedBytes });
    };
    image.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    image.src = url;
  });

  const loadFiles = async (files: FileList | File[]) => {
    const incoming = (await Promise.all(Array.from(files).map(fileToLayer))).filter(Boolean) as ImageItem[];
    if (!incoming.length) return;
    const next = { ...project, name: project.layers.length ? project.name : incoming[0].name.replace(/\.[^.]+$/, ''), layers: [...project.layers, ...incoming], selectedId: incoming[incoming.length - 1].id, updatedAt: Date.now() };
    if (!project.layers.length && historyRef.current.length === 1 && !historyRef.current[0].layers.length) {
      const baseline = snapshot(next); historyRef.current = [baseline]; historyIndexRef.current = 0; setProject(baseline); setHistoryVersion((value) => value + 1);
    } else commit(next);
    setPanelTab('layers');
  };
  const loadBackground = async (file?: File) => {
    if (!file) return;
    const image = await fileToLayer(file);
    if (!image) return;
    const source = new window.Image();
    source.onload = () => {
      const cover = Math.max(CANVAS_WIDTH / source.width, CANVAS_HEIGHT / source.height);
      const width = Math.round(source.width * cover); const height = Math.round(source.height * cover);
      const background: ImageItem = { ...image, id: uid(), name: `Background · ${file.name}`, role: 'background', x: Math.round((CANVAS_WIDTH - width) / 2), y: Math.round((CANVAS_HEIGHT - height) / 2), width, height };
      const layers = [background, ...project.layers.filter((item) => !(item.type === 'image' && item.role === 'background'))];
      commit({ ...project, layers, selectedId: background.id }); setPanelTab('layers');
    };
    source.src = image.src;
  };

  const addText = () => {
    const item: TextItem = { id: uid(), name: 'Text', type: 'text', text: 'Edit me', x: 230, y: 210, width: 260, height: 56, rotation: 0, flipX: false, flipY: false, visible: true, fontSize: 38, fill: '#292722' };
    commit({ ...project, layers: [...project.layers, item], selectedId: item.id }); setPanelTab('adjust');
  };
  const addShape = (shape: ShapeItem['shape']) => {
    const item: ShapeItem = { id: uid(), name: shape === 'ellipse' ? 'Ellipse' : 'Rectangle', type: 'shape', shape, x: 270, y: 165, width: 180, height: 150, rotation: 0, flipX: false, flipY: false, visible: true, fill: shape === 'ellipse' ? '#ffb39f' : '#ff5a3c' };
    commit({ ...project, layers: [...project.layers, item], selectedId: item.id }); setPanelTab('adjust');
  };
  const deleteLayer = (id: string) => commit({ ...project, layers: project.layers.filter((item) => item.id !== id), selectedId: project.selectedId === id ? null : project.selectedId });
  const duplicateLayer = (item: EditorLayer) => {
    const copy = { ...snapshot({ id: 'copy', name: '', layers: [item], selectedId: null, updatedAt: 0 }).layers[0], id: uid(), name: `${item.name} copy`, x: item.x + 18, y: item.y + 18 } as EditorLayer;
    commit({ ...project, layers: [...project.layers, copy], selectedId: copy.id });
  };
  const moveLayer = (id: string, direction: -1 | 1) => {
    const layers = moveLayerById(project.layers, id, direction) as EditorLayer[];
    if (layers === project.layers) return;
    commit({ ...project, layers });
  };
  const persistProjects = (items: Project[], activeId = project.id) => {
    projectsRef.current = items; setProjectList(items);
    try { window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(items)); window.localStorage.setItem(ACTIVE_PROJECT_KEY, activeId); }
    catch { setSaveStatus('Storage full — export your work'); }
  };
  const switchProject = (next: Project) => {
    setProject(snapshot(next));
    historyRef.current = [snapshot(next)]; historyIndexRef.current = 0;
    setHistoryVersion((value) => value + 1); setProjectsOpen(false); setCropMode(false);
  };
  const addProject = () => {
    const next = createProject(`Project ${projectsRef.current.length + 1}`);
    persistProjects([...projectsRef.current, next], next.id); switchProject(next);
  };
  const renameProject = (item: Project) => {
    const name = window.prompt('Project name', item.name)?.trim();
    if (!name) return;
    const next = { ...item, name, updatedAt: Date.now() };
    persistProjects(projectsRef.current.map((entry) => entry.id === item.id ? next : entry)); if (project.id === item.id) setProject(next);
  };
  const duplicateProject = (item: Project) => {
    const next = { ...snapshot(item), id: uid(), name: `${item.name} copy`, selectedId: null, updatedAt: Date.now() };
    persistProjects([...projectsRef.current, next], next.id); switchProject(next);
  };
  const deleteProject = (item: Project) => {
    if (!window.confirm(`Delete “${item.name}” from this browser? Export it first if you need a backup.`)) return;
    const remaining = projectsRef.current.filter((entry) => entry.id !== item.id);
    const nextProjects = remaining.length ? remaining : [createProject()];
    persistProjects(nextProjects, project.id === item.id ? nextProjects[0].id : project.id);
    if (project.id === item.id) switchProject(nextProjects[0]);
  };
  const exportProjectFile = (item = project) => {
    const blob = new Blob([JSON.stringify({ format: PROJECT_FILE_FORMAT, version: PROJECT_FILE_VERSION, project: item }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${item.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'project'}.luma`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const importProjectFile = async (file?: File) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isProjectFile(parsed)) throw new Error('This is not a valid Luma project file.');
      const imported = { ...(parsed as { project: Project }).project, id: uid(), name: `${(parsed as { project: Project }).project.name} imported`, updatedAt: Date.now() };
      persistProjects([...projectsRef.current, imported], imported.id); switchProject(imported); setSaveStatus('Project imported');
    } catch (error) { window.alert(error instanceof Error ? error.message : 'Could not import this project.'); }
  };
  const startCrop = (item: ImageItem) => {
    if (item.rotation % 360 !== 0) { window.alert('Set rotation to 0° before freeform cropping.'); return; }
    setCropBox({ x: item.x, y: item.y, width: item.width, height: item.height }); setCropMode(true);
  };
  const applyCrop = (item: ImageItem) => {
    replaceLayer(item.id, cropPatch(item, cropBox)); setCropMode(false);
  };
  const undoAll = () => {
    if (!historyRef.current.length) return;
    historyIndexRef.current = 0; setProject(snapshot(historyRef.current[0])); setHistoryVersion((value) => value + 1);
  };
  const resetImage = (item: ImageItem) => {
    const source = new window.Image();
    source.onload = () => {
      const fit = Math.min(460 / source.width, 320 / source.height, 1);
      const width = Math.round(source.width * fit); const height = Math.round(source.height * fit);
      replaceLayer(item.id, { src: item.preRemovalSrc ?? item.src, preRemovalSrc: undefined, x: (CANVAS_WIDTH - width) / 2, y: (CANVAS_HEIGHT - height) / 2, width, height, rotation: 0, flipX: false, flipY: false, brightness: 0, contrast: 0, saturation: 0, blur: 0, cropX: 0, cropY: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 });
    };
    source.src = item.preRemovalSrc ?? item.src;
  };
  const resizeSelected = (dimension: 'width' | 'height', rawValue: number, save: boolean) => {
    if (!selected || !Number.isFinite(rawValue)) return;
    const value = Math.max(1, Math.min(5000, Math.round(rawValue)));
    const ratio = selected.width / Math.max(selected.height, 1);
    const patch = dimension === 'width'
      ? { width: value, ...(lockRatio ? { height: Math.max(1, Math.round(value / ratio)) } : {}) }
      : { height: value, ...(lockRatio ? { width: Math.max(1, Math.round(value * ratio)) } : {}) };
    replaceLayer(selected.id, patch, save);
  };
  const formatBytes = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };
  const compressImage = (item: ImageItem) => {
    const source = new window.Image();
    source.onload = () => {
      const scale = Math.min(compressionMax / source.width, compressionMax / source.height, 1);
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
      canvas.getContext('2d')?.drawImage(source, 0, 0, canvas.width, canvas.height);
      const src = canvas.toDataURL('image/webp', compressionQuality);
      const encodedBytes = Math.round((src.length - src.indexOf(',') - 1) * .75);
      replaceLayer(item.id, { src, encodedBytes, cropX: 0, cropY: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 });
    };
    source.src = item.src;
  };
  const downloadCompressed = (item: ImageItem) => {
    const link = document.createElement('a'); link.href = item.src; link.download = `${item.name.replace(/\.[^.]+$/, '')}-compressed.webp`; link.click();
  };
  const removeImageBackground = async (item: ImageItem) => {
    if (item.role === 'background' || removalStatus === 'loading' || removalStatus === 'processing') return;
    const runId = ++removalRunRef.current;
    setRemovalStatus('loading'); setRemovalProgress(2); setRemovalMessage('Loading local AI model…');
    try {
      const { removeBackground } = await import('@imgly/background-removal');
      if (runId !== removalRunRef.current) return;
      setRemovalStatus('processing'); setRemovalMessage('Separating subject from background…');
      const result = await removeBackground(item.preRemovalSrc ?? item.src, {
        model: 'isnet_quint8', device: 'cpu', output: { format: 'image/png', quality: 1 },
        progress: (key: string, current: number, total: number) => {
          if (runId !== removalRunRef.current) return;
          if (total > 0) setRemovalProgress(Math.max(3, Math.min(96, Math.round((current / total) * 100))));
          if (key.toLowerCase().includes('fetch')) setRemovalMessage('Downloading model for first use…');
        },
      });
      if (runId !== removalRunRef.current) return;
      const transparentSrc = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(result);
      });
      if (runId !== removalRunRef.current) return;
      replaceLayer(item.id, { src: transparentSrc, preRemovalSrc: item.preRemovalSrc ?? item.src, encodedBytes: result.size, cropX: 0, cropY: 0, cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 });
      setRemovalProgress(100); setRemovalStatus('done'); setRemovalMessage('Background removed — choose a replacement');
    } catch (error) {
      if (runId === removalRunRef.current) { setRemovalStatus('error'); setRemovalProgress(0); setRemovalMessage(error instanceof Error ? error.message : 'Background removal failed'); }
    }
  };
  const cancelBackgroundRemoval = () => {
    removalRunRef.current += 1; setRemovalStatus('idle'); setRemovalProgress(0); setRemovalMessage('Canceled — the current result will be ignored');
  };

  const exportImage = () => {
    const stage = stageRef.current; const transformer = transformerRef.current;
    if (!stage) return;
    transformer?.hide(); stage.batchDraw();
    const extension = exportType === 'image/jpeg' ? 'jpg' : exportType.split('/')[1];
    const uri = stage.toDataURL({ mimeType: exportType, quality: 0.92, pixelRatio: 2 });
    transformer?.show(); stage.batchDraw();
    const link = document.createElement('a'); link.download = `${project.name || 'luma-project'}.${extension}`; link.href = uri; link.click();
  };

  const imageSettings = useMemo(() => selected?.type === 'image' ? [
    { key: 'brightness' as const, label: 'Brightness', min: -1, max: 1, step: .05, display: Math.round(selected.brightness * 100) },
    { key: 'contrast' as const, label: 'Contrast', min: -100, max: 100, step: 1, display: Math.round(selected.contrast) },
    { key: 'saturation' as const, label: 'Saturation', min: -2, max: 2, step: .05, display: Math.round(selected.saturation * 50) },
    { key: 'blur' as const, label: 'Blur', min: 0, max: 30, step: 1, display: Math.round(selected.blur) },
  ] : [], [selected]);

  const selectCanvasLayer = (id: string) => {
    setProject({ ...project, selectedId: id });
    if (window.matchMedia('(max-width: 900px)').matches) {
      setPanelTab('adjust');
      setMobilePanelOpen(true);
    }
  };

  const renderLayer = (item: EditorLayer) => {
    if (item.type === 'image') return <ImageNode key={item.id} item={item} selected={project.selectedId === item.id} disabled={cropMode} onSelect={() => selectCanvasLayer(item.id)} onChange={(patch) => replaceLayer(item.id, patch)} />;
    if (!item.visible) return null;
    const shared = { id: item.id, x: item.x, y: item.y, width: item.width, height: item.height, rotation: item.rotation, scaleX: item.flipX ? -1 : 1, scaleY: item.flipY ? -1 : 1, offsetX: item.flipX ? item.width : 0, offsetY: item.flipY ? item.height : 0, draggable: true, onClick: () => selectCanvasLayer(item.id), onTap: () => selectCanvasLayer(item.id), onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => replaceLayer(item.id, { x: event.target.x(), y: event.target.y() }), onTransformEnd: (event: Konva.KonvaEventObject<Event>) => { const node = event.target; const scaleX = Math.abs(node.scaleX()); const scaleY = Math.abs(node.scaleY()); node.scaleX(item.flipX ? -1 : 1); node.scaleY(item.flipY ? -1 : 1); replaceLayer(item.id, { x: node.x(), y: node.y(), rotation: node.rotation(), width: Math.max(24, node.width() * scaleX), height: Math.max(24, node.height() * scaleY) }); } };
    if (item.type === 'text') return <Text key={item.id} {...shared} text={item.text} fill={item.fill} fontSize={item.fontSize} fontStyle="bold" verticalAlign="middle" align="center" onDblClick={() => { const value = window.prompt('Edit text', item.text); if (value !== null) replaceLayer(item.id, { text: value }); }} />;
    return <Rect key={item.id} {...shared} fill={item.fill} cornerRadius={item.shape === 'ellipse' ? Math.min(item.width, item.height) / 2 : 16} />;
  };

  return (
    <main className="editor-shell" data-history-version={historyVersion}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><div><strong>Luma</strong><span>Image Studio</span></div></div>
        <div className="document-title"><Save size={13} /><span>{project.name}</span><small>{saveStatus}</small></div>
        <div className="top-actions">
          <Button variant="ghost" className="projects-button" onClick={() => setProjectsOpen(true)}><FolderOpen /> Projects</Button>
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={() => stepHistory(-1)}><Undo2 /></Button>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={() => stepHistory(1)}><Redo2 /></Button>
          <Button variant="ghost" className="undo-all" disabled={!canUndo} onClick={undoAll}><RotateCcw /> Undo all</Button>
          <select className="export-select" aria-label="Export format" value={exportType} onChange={(event) => setExportType(event.target.value as ExportType)}><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select>
          <Button className="export-button" onClick={exportImage}><Download /> Export</Button>
        </div>
      </header>
      <section className="workspace">
        <aside className="toolrail" aria-label="Editor tools">
          <button className="tool active" aria-label="Select tool"><MousePointer2 /><span>Select</span></button>
          <button className="tool mobile-primary-tool" onClick={() => { setPanelTab('adjust'); setMobilePanelOpen(true); }} aria-label="Adjust selected layer"><SlidersHorizontal /><span>Adjust</span></button>
          <button className="tool mobile-primary-tool" onClick={() => { setPanelTab('layers'); setMobilePanelOpen(true); }} aria-label="Show layers"><Layers3 /><span>Layers</span></button>
          <button className="tool" onClick={() => fileRef.current?.click()} aria-label="Add image"><ImagePlus /><span>Image</span></button>
          <button className="tool background-tool" onClick={() => backgroundFileRef.current?.click()} aria-label="Change background"><Images /><span>Background</span></button>
          <button className="tool" onClick={addText} aria-label="Add text"><Type /><span>Text</span></button>
          <button className="tool" onClick={() => addShape('rectangle')} aria-label="Add rectangle"><Square /><span>Shape</span></button>
          <button className="tool" onClick={() => addShape('ellipse')} aria-label="Add ellipse"><Circle /><span>Ellipse</span></button>
          <div className="rail-spacer" /><div className="ai-pill"><Sparkles size={15} /><span>AI later</span></div>
        </aside>
        <section className={`canvas-area ${draggingOver ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDraggingOver(true); }} onDragLeave={() => setDraggingOver(false)} onDrop={(event) => { event.preventDefault(); setDraggingOver(false); void loadFiles(event.dataTransfer.files); }}>
          <div className="canvas-toolbar"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.5, value - .1))}><ZoomOut /></Button><span>{Math.round(zoom * 100)}%</span><Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.2, value + .1))}><ZoomIn /></Button></div>
          <div className="stage-wrap" style={{ width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}><div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
            <Stage ref={stageRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} onMouseDown={(event) => { if (event.target === event.target.getStage() || event.target.name() === 'background') setProject({ ...project, selectedId: null }); }}>
              <Layer><Rect name="background" width={CANVAS_WIDTH} height={CANVAS_HEIGHT} fill="#fffdf8" />
                {!project.layers.length && <><Rect x={140} y={104} width={440} height={240} cornerRadius={28} fill="#f1eee7" stroke="#d8d1c5" dash={[7, 7]} /><Text x={200} y={184} width={320} text="Drop images here" align="center" fontSize={28} fontStyle="bold" fill="#292722" /><Text x={200} y={230} width={320} text="Add images, text and shapes in layers" align="center" fontSize={15} fill="#777168" /></>}
                {project.layers.map(renderLayer)}
                <Transformer ref={transformerRef} rotateEnabled borderStroke="#ff5a3c" anchorStroke="#ff5a3c" anchorFill="#fffdf8" anchorSize={9} boundBoxFunc={(oldBox, newBox) => newBox.width < 24 || newBox.height < 24 ? oldBox : newBox} />
                {cropMode && selected?.type === 'image' && <>
                  <Rect ref={cropRectRef} x={cropBox.x} y={cropBox.y} width={cropBox.width} height={cropBox.height} draggable fill="rgba(255,90,60,.08)" stroke="#ff5a3c" strokeWidth={2} dash={[8, 5]}
                    dragBoundFunc={(position) => ({ x: Math.max(selected.x, Math.min(selected.x + selected.width - cropBox.width, position.x)), y: Math.max(selected.y, Math.min(selected.y + selected.height - cropBox.height, position.y)) })}
                    onDragEnd={(event) => setCropBox({ ...cropBox, x: event.target.x(), y: event.target.y() })}
                    onTransformEnd={() => { const node = cropRectRef.current; if (!node) return; const width = Math.max(24, node.width() * Math.abs(node.scaleX())); const height = Math.max(24, node.height() * Math.abs(node.scaleY())); node.scale({ x: 1, y: 1 }); setCropBox({ x: node.x(), y: node.y(), width, height }); }} />
                  <Transformer ref={cropTransformerRef} rotateEnabled={false} borderStroke="#ff5a3c" anchorStroke="#ff5a3c" anchorFill="#fffdf8" anchorSize={10}
                    boundBoxFunc={(oldBox, next) => next.width < 24 || next.height < 24 || next.x < selected.x || next.y < selected.y || next.x + next.width > selected.x + selected.width || next.y + next.height > selected.y + selected.height ? oldBox : next} />
                </>}
              </Layer>
            </Stage>
          </div></div>
          {!project.layers.length && <button className="upload-cta" onClick={() => fileRef.current?.click()}><Upload size={17} /> Upload images</button>}
          <input ref={fileRef} className="sr-only" type="file" multiple accept="image/*" onChange={(event) => { if (event.target.files) void loadFiles(event.target.files); event.target.value = ''; }} />
          <input ref={backgroundFileRef} className="sr-only" type="file" accept="image/*" onChange={(event) => { void loadBackground(event.target.files?.[0]); event.target.value = ''; }} />
          {cropMode && selected?.type === 'image' && <div className="crop-actions"><span>Drag the crop edges</span><button onClick={() => setCropMode(false)}>Cancel</button><button className="primary" onClick={() => applyCrop(selected)}>Apply crop</button></div>}
          {selected && !cropMode && <button className="mobile-edit-fab" onClick={() => { setPanelTab('adjust'); setMobilePanelOpen(true); }}><SlidersHorizontal /> Edit selected layer</button>}
        </section>
        {mobilePanelOpen && <button className="mobile-backdrop" aria-label="Close properties" onClick={() => setMobilePanelOpen(false)} />}
        <aside className={`properties ${mobilePanelOpen ? 'mobile-open' : ''}`}>
          <div className="panel-tabs"><button className={panelTab === 'layers' ? 'active' : ''} onClick={() => setPanelTab('layers')}>Layers <span>{project.layers.length}</span></button><button className={panelTab === 'adjust' ? 'active' : ''} onClick={() => setPanelTab('adjust')}>Adjust</button><button className="panel-close" aria-label="Close panel" onClick={() => setMobilePanelOpen(false)}><X /></button></div>
          {panelTab === 'layers' ? <div className="layers-panel">
            {!project.layers.length && <div className="empty-layers"><Layers3 /><strong>No layers yet</strong><span>Add an image, text or shape.</span></div>}
            {[...project.layers].reverse().map((item) => {
              const index = project.layers.findIndex((layer) => layer.id === item.id);
              return <div key={item.id} className={`layer-row ${project.selectedId === item.id ? 'selected' : ''}`} onClick={() => setProject({ ...project, selectedId: item.id })}>
                <button className="visibility" aria-label={item.visible ? 'Hide layer' : 'Show layer'} onClick={(event) => { event.stopPropagation(); replaceLayer(item.id, { visible: !item.visible }); }}>{item.visible ? <Eye /> : <EyeOff />}</button>
                <div className={`layer-thumb ${item.type}`}>{item.type === 'image' ? <ImagePlus /> : item.type === 'text' ? <Type /> : item.shape === 'ellipse' ? <Circle /> : <Square />}</div>
                <div className="layer-name"><strong>{item.name}</strong><span>{item.type}</span></div>
                <div className="layer-actions"><button aria-label="Move layer up" disabled={index === project.layers.length - 1} onClick={(event) => { event.stopPropagation(); moveLayer(item.id, 1); }}><ChevronUp /></button><button aria-label="Move layer down" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveLayer(item.id, -1); }}><ChevronDown /></button><button className="delete-inline" aria-label="Delete layer" onClick={(event) => { event.stopPropagation(); deleteLayer(item.id); }}><Trash2 /></button></div>
              </div>;
            })}
          </div> : <div className="adjust-panel">
            {!selected && <div className="empty-layers"><MousePointer2 /><strong>Select a layer</strong><span>Choose an item on the canvas or in Layers.</span></div>}
            {selected && <>
              <div className="panel-heading"><div><span>{selected.type}</span><h2>{selected.name}</h2></div><Button variant="ghost" size="icon" aria-label="Reset rotation" onClick={() => replaceLayer(selected.id, { rotation: 0 })}><RotateCcw /></Button></div>
              <div className="quick-actions"><button onClick={() => replaceLayer(selected.id, { flipX: !selected.flipX })}><FlipHorizontal2 /> Flip H</button><button onClick={() => replaceLayer(selected.id, { flipY: !selected.flipY })}><FlipVertical2 /> Flip V</button><button onClick={() => replaceLayer(selected.id, { rotation: (selected.rotation + 90) % 360 })}><RotateCcw /> Rotate</button></div>
              {selected.type === 'image' && <>
                {selected.role !== 'background' && <div className="panel-section ai-removal-section"><p className="section-label"><Sparkles size={12} /> AI background removal</p><p className="ai-removal-copy">Turn this photo into a transparent subject, refine the edges, then place any background behind it.</p><div className="workflow-steps"><span className={removalStatus === 'done' || selected.preRemovalSrc ? 'done' : 'active'}>1</span><b>Remove original</b><i /><span className={project.layers.some((item) => item.type === 'image' && item.role === 'background') ? 'done' : ''}>2</span><b>Choose replacement</b></div>{removalStatus !== 'idle' && <div className={`removal-progress ${removalStatus}`}><div><span style={{ width: `${removalProgress}%` }} /></div><p>{removalMessage}</p></div>}<div className="removal-actions"><button disabled={removalStatus === 'loading' || removalStatus === 'processing'} onClick={() => void removeImageBackground(selected)}><Sparkles />{removalStatus === 'loading' || removalStatus === 'processing' ? 'Working…' : selected.preRemovalSrc ? 'Remove again' : 'Remove background'}</button>{removalStatus === 'loading' || removalStatus === 'processing' ? <button onClick={cancelBackgroundRemoval}><X /> Cancel job</button> : <button onClick={() => backgroundFileRef.current?.click()}><Images /> Choose background</button>}{selected.preRemovalSrc && <button className="refine-button" onClick={() => setCleanupId(selected.id)}><Crop /> Refine edges</button>}</div><p className="privacy-note">Runs on this device. First use needs internet to download the model. Cancel safely ignores unfinished results.</p></div>}
                <div className="panel-section"><p className="section-label">Light & effects</p>{imageSettings.map((setting) => <div className="control" key={setting.key}><div><label>{setting.label}</label><output>{setting.display}</output></div><Slider min={setting.min} max={setting.max} step={setting.step} value={selected[setting.key]} onValueChange={(value) => replaceLayer(selected.id, { [setting.key]: value as number }, false)} onValueCommitted={(value) => replaceLayer(selected.id, { [setting.key]: value as number })} /></div>)}</div>
                <div className="panel-section crop-section"><p className="section-label"><Crop size={12} /> Freeform crop</p><p className="ai-removal-copy">Drag each edge or corner directly on the canvas.</p><button onClick={() => startCrop(selected)}><Crop /> Start freeform crop</button></div>
                <div className="panel-section compression-section"><p className="section-label"><Minimize2 size={12} /> Compress image</p><div className="compression-stats"><div><span>Imported</span><strong>{formatBytes(selected.originalBytes)}</strong></div><div><span>Current</span><strong>{formatBytes(selected.encodedBytes ?? Math.round((selected.src.length - selected.src.indexOf(',') - 1) * .75))}</strong></div></div><div className="control"><div><label>WebP quality</label><output>{Math.round(compressionQuality * 100)}%</output></div><Slider min={.25} max={.95} step={.05} value={compressionQuality} onValueChange={(value) => setCompressionQuality(value as number)} /></div><label className="compression-max">Maximum dimension<div><input type="number" min="320" max="4000" step="80" value={compressionMax} onChange={(event) => setCompressionMax(Math.max(320, Math.min(4000, Number(event.target.value) || 320)))} /><small>px</small></div></label><div className="compression-actions"><button onClick={() => compressImage(selected)}><Minimize2 /> Compress layer</button><button onClick={() => downloadCompressed(selected)}><Download /> Download WebP</button></div><p className="resize-hint">Compression happens only on your laptop. Lower quality and dimensions create a smaller file.</p></div>
              </>}
              {selected.type === 'text' && <div className="panel-section"><p className="section-label">Text</p><label className="field-label">Content<textarea value={selected.text} onChange={(event) => replaceLayer(selected.id, { text: event.target.value }, false)} onBlur={(event) => replaceLayer(selected.id, { text: event.target.value })} /></label><label className="field-label">Color<input type="color" value={selected.fill} onChange={(event) => replaceLayer(selected.id, { fill: event.target.value })} /></label><div className="control"><div><label>Font size</label><output>{selected.fontSize}</output></div><Slider min={10} max={120} step={1} value={selected.fontSize} onValueChange={(value) => replaceLayer(selected.id, { fontSize: value as number }, false)} onValueCommitted={(value) => replaceLayer(selected.id, { fontSize: value as number })} /></div></div>}
              {selected.type === 'shape' && <div className="panel-section"><p className="section-label">Shape</p><label className="field-label">Fill color<input type="color" value={selected.fill} onChange={(event) => replaceLayer(selected.id, { fill: event.target.value })} /></label></div>}
              <div className="panel-section dimensions"><div className="dimension-heading"><p className="section-label">Image size</p><button className="ratio-lock" aria-label={lockRatio ? 'Unlock aspect ratio' : 'Lock aspect ratio'} onClick={() => setLockRatio((value) => !value)}>{lockRatio ? <Link2 /> : <Unlink2 />}{lockRatio ? 'Ratio locked' : 'Free resize'}</button></div><div className="dimension-inputs"><label><span>Width</span><div><input type="number" min="1" max="5000" value={Math.round(selected.width)} onChange={(event) => resizeSelected('width', Number(event.target.value), false)} onBlur={(event) => resizeSelected('width', Number(event.target.value), true)} /><small>px</small></div></label><label><span>Height</span><div><input type="number" min="1" max="5000" value={Math.round(selected.height)} onChange={(event) => resizeSelected('height', Number(event.target.value), false)} onBlur={(event) => resizeSelected('height', Number(event.target.value), true)} /><small>px</small></div></label></div><p className="resize-hint">Enter an exact size or drag a corner handle on the canvas.</p></div>
              <div className="object-actions three">{selected.type === 'image' && <button className="original-action" onClick={() => resetImage(selected)}><RotateCcw /> Original image</button>}<button onClick={() => duplicateLayer(selected)}><Copy /> Duplicate</button><button className="danger" onClick={() => deleteLayer(selected.id)}><Trash2 /> Delete layer</button></div>
            </>}
          </div>}
        </aside>
      </section>
      <input ref={projectImportRef} className="sr-only" type="file" accept=".luma,application/json" onChange={(event) => { void importProjectFile(event.target.files?.[0]); event.target.value = ''; }} />
      {projectsOpen && <dialog open className="modal-backdrop" aria-label="Projects">
        <section className="projects-dialog"><header><div><strong>Your projects</strong><span>Saved only in this browser. Export a .luma backup before clearing browser data.</span></div><Button variant="ghost" size="icon" aria-label="Close" onClick={() => setProjectsOpen(false)}><X /></Button></header>
          <div className="project-toolbar"><button onClick={addProject}><Plus /> New project</button><button onClick={() => projectImportRef.current?.click()}><FileUp /> Import .luma</button><button onClick={() => exportProjectFile()}><FileDown /> Export current</button></div>
          <div className="project-list">{projectList.slice().sort((a, b) => b.updatedAt - a.updatedAt).map((item) => <article key={item.id} className={item.id === project.id ? 'active' : ''}><button className="project-summary" onClick={() => switchProject(item)}><strong>{item.name}</strong><span>{item.layers.length} layers · {new Date(item.updatedAt).toLocaleString()}</span></button><div><button onClick={() => renameProject(item)}>Rename</button><button onClick={() => duplicateProject(item)}><Copy /> Copy</button><button onClick={() => exportProjectFile(item)}><FileDown /> Backup</button><button className="danger" onClick={() => deleteProject(item)}><Trash2 /></button></div></article>)}</div>
        </section>
      </dialog>}
      {cleanupId && (() => { const item = project.layers.find((layer): layer is ImageItem => layer.id === cleanupId && layer.type === 'image'); return item?.preRemovalSrc ? <MaskCleanup currentSrc={item.src} originalSrc={item.preRemovalSrc} onClose={() => setCleanupId(null)} onApply={(src) => { replaceLayer(item.id, { src }); setCleanupId(null); }} /> : null; })()}
    </main>
  );
}
