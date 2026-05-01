import { html } from 'htm/preact';
import { useEffect, useImperativeHandle, useRef } from 'preact/hooks';

export const CANVAS_EVENT_NAMES = Object.freeze([
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'wheel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel'
]);

const attachCanvasEventHandlers = (canvas, eventHandlers) => {
  const cleanupCallbacks = [];
  for (const eventName of CANVAS_EVENT_NAMES) {
    const handler = eventHandlers[eventName];
    if (typeof handler !== 'function') {
      continue;
    }
    canvas.addEventListener(eventName, handler, { passive: false });
    cleanupCallbacks.push(() => canvas.removeEventListener(eventName, handler));
  }
  return () => cleanupCallbacks.forEach((cleanup) => cleanup());
};

export function RenderCanvas({
  ref: forwardedRef,
  canvasId = 'canvas',
  errorId = 'error',
  width = 512,
  height = 512,
  eventHandlers = {},
  onCanvasReady
}) {
  const canvasRef = useRef(null);

  useImperativeHandle(forwardedRef, () => canvasRef.current, []);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    const cleanup = attachCanvasEventHandlers(canvasRef.current, eventHandlers);
    if (onCanvasReady) {
      onCanvasReady(canvasRef.current);
    }
    return cleanup;
  }, [eventHandlers, onCanvasReady]);

  return html`
    <>
      <canvas id=${canvasId} ref=${canvasRef} width=${width} height=${height}></canvas>
      <div id=${errorId}><noscript>Please enable JavaScript.</noscript></div>
    </>
  `;
}
