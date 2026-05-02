import { html } from 'htm/preact';
import { useEffect, useImperativeHandle, useRef } from 'preact/hooks';
import { uiLogger } from '../logger.js';
import { registerRenderCanvas } from '../renderBridge.js';

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
    try {
      canvas.addEventListener(eventName, handler, { passive: false });
      cleanupCallbacks.push(() => {
        try {
          canvas.removeEventListener(eventName, handler);
        } catch (error) {
          uiLogger.warn('ui:canvas-event-listener-remove-failed', { eventName, error });
        }
      });
    } catch (error) {
      uiLogger.warn('ui:canvas-event-listener-add-failed', { eventName, error });
    }
  }
  return () => cleanupCallbacks.forEach((cleanup) => cleanup());
};

const DEFAULT_CANVAS_DIMENSION = 512;
const CANVAS_CSS_PROPERTY_NAMES = Object.freeze([
  '--canvas-render-size',
  '--canvas-render-width',
  '--canvas-render-height',
  '--canvas-aspect-ratio'
]);

const normalizeCanvasDimension = (value, fallbackValue) => {
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    uiLogger.warn('ui:canvas-invalid-dimension', { value, fallbackValue });
    return fallbackValue;
  }
  return Math.max(1, Math.round(parsedValue));
};

export const createRenderCanvasCssProperties = (width, height) => {
  const renderWidth = normalizeCanvasDimension(width, DEFAULT_CANVAS_DIMENSION);
  const renderHeight = normalizeCanvasDimension(height, DEFAULT_CANVAS_DIMENSION);
  const renderSize = Math.max(renderWidth, renderHeight);

  return {
    '--canvas-render-size': `${renderSize}px`,
    '--canvas-render-width': `${renderWidth}px`,
    '--canvas-render-height': `${renderHeight}px`,
    '--canvas-aspect-ratio': String(renderWidth / renderHeight)
  };
};

export const applyRenderCanvasCssProperties = (documentElement, width, height) => {
  const style = documentElement.style;
  const properties = createRenderCanvasCssProperties(width, height);
  const previousProperties = Object.fromEntries(
    CANVAS_CSS_PROPERTY_NAMES.map((propertyName) => [
      propertyName,
      {
        value: style.getPropertyValue(propertyName),
        priority: style.getPropertyPriority(propertyName)
      }
    ])
  );

  for (const [propertyName, propertyValue] of Object.entries(properties)) {
    style.setProperty(propertyName, propertyValue);
  }

  return () => {
    for (const [propertyName, propertyValue] of Object.entries(properties)) {
      if (style.getPropertyValue(propertyName) !== propertyValue) {
        continue;
      }

      const previousProperty = previousProperties[propertyName];
      if (previousProperty.value) {
        style.setProperty(propertyName, previousProperty.value, previousProperty.priority);
      } else {
        style.removeProperty(propertyName);
      }
    }
  };
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
    const documentElement = canvasRef.current && canvasRef.current.ownerDocument
      ? canvasRef.current.ownerDocument.documentElement
      : null;
    if (!documentElement) {
      return undefined;
    }

    return applyRenderCanvasCssProperties(documentElement, width, height);
  }, [width, height]);

  useEffect(() => {
    if (!canvasRef.current) {
      uiLogger.warn('ui:canvas-ref-unavailable', { canvasId });
      return undefined;
    }

    const cleanupCanvasRegistration = registerRenderCanvas(canvasRef.current);
    const cleanupEventHandlers = attachCanvasEventHandlers(canvasRef.current, eventHandlers);
    uiLogger.info('ui:canvas-ready', {
      canvasId,
      width,
      height,
      eventHandlerCount: Object.values(eventHandlers).filter((handler) => typeof handler === 'function').length
    });
    const cleanupCanvasReady = onCanvasReady ? onCanvasReady(canvasRef.current) : undefined;
    return () => {
      if (typeof cleanupCanvasReady === 'function') {
        cleanupCanvasReady();
      }
      cleanupEventHandlers();
      cleanupCanvasRegistration();
    };
  }, [eventHandlers, onCanvasReady]);

  return html`
    <div data-render-canvas-shell="mounted">
      <canvas id=${canvasId} ref=${canvasRef} width=${width} height=${height}></canvas>
      <div id=${errorId}><noscript>Please enable JavaScript.</noscript></div>
    </div>
  `;
}
