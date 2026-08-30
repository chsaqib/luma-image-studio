'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, Paintbrush, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  currentSrc: string;
  originalSrc: string;
  onApply: (src: string) => void;
  onClose: () => void;
};

export function MaskCleanup({ currentSrc, originalSrc, onApply, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase');
  const [brushSize, setBrushSize] = useState(32);

  const drawInitial = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
    };
    image.src = currentSrc;
  }, [currentSrc]);

  useEffect(() => {
    drawInitial();
    const original = new Image();
    original.onload = () => { originalRef.current = original; };
    original.src = originalSrc;
  }, [drawInitial, originalSrc]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  };

  const paint = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(2, brushSize / 5)));
    for (let step = 0; step <= steps; step += 1) {
      const x = from.x + (to.x - from.x) * step / steps;
      const y = from.y + (to.y - from.y) * step / steps;
      context.save();
      context.beginPath();
      context.arc(x, y, brushSize / 2, 0, Math.PI * 2);
      context.clip();
      if (mode === 'erase') {
        context.globalCompositeOperation = 'destination-out';
        context.fillRect(x - brushSize, y - brushSize, brushSize * 2, brushSize * 2);
      } else if (originalRef.current) {
        context.globalCompositeOperation = 'source-over';
        context.drawImage(originalRef.current, 0, 0, canvas.width, canvas.height);
      }
      context.restore();
    }
  };

  return <dialog open className="modal-backdrop" aria-label="Refine background removal">
    <section className="mask-dialog">
      <header><div><strong>Refine subject edges</strong><span>Erase unwanted pixels or restore parts of the original photo.</span></div><Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X /></Button></header>
      <div className="mask-toolbar">
        <button className={mode === 'erase' ? 'active' : ''} onClick={() => setMode('erase')}><Eraser /> Erase</button>
        <button className={mode === 'restore' ? 'active' : ''} onClick={() => setMode('restore')}><Paintbrush /> Restore</button>
        <label>Brush <input type="range" min="8" max="160" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} /><output>{brushSize}px</output></label>
        <button onClick={drawInitial}><RotateCcw /> Reset</button>
      </div>
      <div className="mask-canvas-wrap"><canvas ref={canvasRef} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drawingRef.current = true; const next = point(event); lastRef.current = next; paint(next, next); }} onPointerMove={(event) => { if (!drawingRef.current || !lastRef.current) return; const next = point(event); paint(lastRef.current, next); lastRef.current = next; }} onPointerUp={() => { drawingRef.current = false; lastRef.current = null; }} onPointerCancel={() => { drawingRef.current = false; lastRef.current = null; }} /></div>
      <footer><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { const canvas = canvasRef.current; if (canvas) onApply(canvas.toDataURL('image/png')); }}>Apply cleanup</Button></footer>
    </section>
  </dialog>;
}
