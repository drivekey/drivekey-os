"use client";
import { useEffect, useRef, useState } from 'react';
import { fieldGlyph, fieldShade, logoGlyph } from './character-field-model';

const PREFERENCE = 'drivekey.character-motion.v1';
const SHADES = ['#333333', '#3b3b3b', '#444444', '#4c4c4c'];

export function CharacterField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    try { setPaused(sessionStorage.getItem(PREFERENCE) === 'paused'); } catch { /* Storage is optional. */ }
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let frame = 0, last = 0, lastDraw = 0;
    let width = 1, height = 1, cellWidth = 10, cellHeight = 16;
    let columns = 1, rows = 1;
    let draws = 0;

    function paint() {
      if (!ctx || !canvas) return;
      ctx.fillStyle = '#222222';
      ctx.fillRect(0, 0, width, height);
      ctx.font = `${Math.round(cellWidth * 1.12)}px "Cascadia Mono", Consolas, monospace`;
      ctx.textBaseline = 'top';
      // Exactly one glyph is selected and drawn for each grid cell. The logo
      // replaces the noise in that cell; no second pass, translation or knockout.
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const logo = logoGlyph(x, y, columns, elapsed.current);
          ctx.fillStyle = logo ? (logo === '░' ? '#626262' : logo === '▒' ? '#858585' : '#b0b0b0') : SHADES[fieldShade(x, y)];
          ctx.fillText(logo ?? fieldGlyph(x, y, elapsed.current), x * cellWidth, y * cellHeight);
        }
      }
      canvas.dataset.frame = String(++draws);
      canvas.dataset.elapsed = elapsed.current.toFixed(3);
    }

    function resize() {
      if (!canvas || !ctx) return;
      width = window.innerWidth; height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      cellWidth = Math.max(10, Math.ceil(width / 180));
      cellHeight = Math.round(cellWidth * 1.6);
      columns = Math.ceil(width / cellWidth); rows = Math.ceil(height / cellHeight) + 1;
      paint();
    }
    function tick(now: number) {
      if (document.hidden || paused || reduced) return;
      if (last) elapsed.current += Math.min(now - last, 200) / 1000;
      last = now;
      if (now - lastDraw >= 1000 / 12) { paint(); lastDraw = now; }
      frame = requestAnimationFrame(tick);
    }
    function reconcile() {
      cancelAnimationFrame(frame); last = 0;
      if (!canvas) return;
      const running = !paused && !reduced && !document.hidden;
      canvas.dataset.motion = running ? 'running' : document.hidden ? 'hidden' : reduced ? 'reduced' : 'paused';
      if (running) frame = requestAnimationFrame(tick);
    }
    resize(); reconcile();
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [paused, reduced]);

  function toggle() {
    const next = !paused;
    setPaused(next);
    try { sessionStorage.setItem(PREFERENCE, next ? 'paused' : 'running'); } catch { /* Optional preference only. */ }
  }
  return <>
    <canvas ref={canvasRef} className="character-field" aria-hidden="true" data-testid="character-field" />
    <button type="button" className="character-motion-control" onClick={toggle} disabled={reduced}
      aria-label={reduced ? 'Background motion disabled by reduced-motion preference' : paused ? 'Resume background motion' : 'Pause background motion'}
      aria-pressed={paused || reduced}>
      <span aria-hidden="true">{paused || reduced ? '▹' : 'Ⅱ'}</span> {reduced ? 'Motion reduced' : paused ? 'Motion paused' : 'Pause motion'}
    </button>
  </>;
}
