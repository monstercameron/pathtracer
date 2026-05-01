import { html } from 'htm/preact';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'preact/hooks';

export const FLOATING_WINDOW_STORAGE_KEY = 'pathtracer.floatingWindows.v1';
const MIN_VISIBLE_SIZE = 80;
const VIEWPORT_PADDING = 8;

let nextZIndex = 200;

const toCssSize = (value) => (typeof value === 'number' ? `${value}px` : value);

const readStoredWindowStates = () => {
  if (!globalThis.localStorage) {
    return {};
  }
  try {
    return JSON.parse(globalThis.localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

const writeStoredWindowState = (storageKey, state) => {
  if (!globalThis.localStorage || !storageKey) {
    return;
  }
  try {
    const states = readStoredWindowStates();
    states[storageKey] = state;
    globalThis.localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, JSON.stringify(states));
  } catch {
    // Persistence is best-effort; unavailable storage should not block the UI.
  }
};

const readInitialWindowState = (id, windowKey, defaultPosition, defaultVisible) => {
  const states = readStoredWindowStates();
  const storedState = states[id] || states[windowKey] || {};
  const hasStoredLeft = Number.isFinite(storedState.left);
  const hasStoredTop = Number.isFinite(storedState.top);
  return {
    visible: storedState.hidden === undefined ? defaultVisible : !storedState.hidden,
    collapsed: Boolean(storedState.collapsed),
    position: {
      ...defaultPosition,
      left: hasStoredLeft ? storedState.left : defaultPosition.left,
      top: hasStoredTop ? storedState.top : defaultPosition.top,
      right: hasStoredLeft ? 'auto' : defaultPosition.right,
      bottom: hasStoredTop ? 'auto' : defaultPosition.bottom,
      width: Number.isFinite(storedState.width) ? Math.max(storedState.width, MIN_VISIBLE_SIZE) : defaultPosition.width,
      height: Number.isFinite(storedState.height) ? Math.max(storedState.height, 34) : defaultPosition.height
    }
  };
};

const clampToViewport = (value, maxValue) => Math.min(
  Math.max(value, VIEWPORT_PADDING),
  Math.max(VIEWPORT_PADDING, maxValue - MIN_VISIBLE_SIZE)
);

const readRectState = (element, visible, collapsed) => {
  const rectangle = element.getBoundingClientRect();
  return {
    left: Math.round(rectangle.left),
    top: Math.round(rectangle.top),
    width: Math.round(rectangle.width),
    height: Math.round(rectangle.height),
    hidden: !visible,
    collapsed
  };
};

export function FloatingWindow({
  ref: forwardedRef,
  id,
  windowKey,
  title,
  defaultPosition = {},
  defaultVisible = true,
  className = '',
  children
}) {
  const storageKey = id || windowKey;
  const initialState = useRef(null);
  if (!initialState.current) {
    initialState.current = readInitialWindowState(id, windowKey, defaultPosition, defaultVisible);
  }

  const elementRef = useRef(null);
  const dragStateRef = useRef(null);
  const [visible, setVisible] = useState(initialState.current.visible);
  const [collapsed, setCollapsed] = useState(initialState.current.collapsed);
  const [position, setPosition] = useState(initialState.current.position);

  const focusWindow = useCallback(() => {
    if (elementRef.current) {
      nextZIndex += 1;
      elementRef.current.style.zIndex = String(nextZIndex);
    }
  }, []);

  const persistCurrentState = useCallback(() => {
    if (!elementRef.current) {
      writeStoredWindowState(storageKey, {
        ...position,
        hidden: !visible,
        collapsed
      });
      return;
    }
    writeStoredWindowState(storageKey, readRectState(elementRef.current, visible, collapsed));
  }, [collapsed, position, storageKey, visible]);

  const show = useCallback(() => {
    setVisible(true);
    setCollapsed(false);
    focusWindow();
  }, [focusWindow]);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((currentValue) => !currentValue);
  }, []);

  useImperativeHandle(forwardedRef, () => ({
    element: elementRef.current,
    show,
    hide,
    focus: focusWindow
  }), [focusWindow, hide, show]);

  useEffect(() => {
    persistCurrentState();
  }, [persistCurrentState]);

  useEffect(() => {
    if (!elementRef.current || typeof ResizeObserver !== 'function') {
      return undefined;
    }
    const resizeObserver = new ResizeObserver(() => {
      persistCurrentState();
    });
    resizeObserver.observe(elementRef.current);
    return () => resizeObserver.disconnect();
  }, [persistCurrentState]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 || !(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest('button, input, select, textarea, a')) {
      return;
    }
    if (!elementRef.current) {
      return;
    }

    const rectangle = elementRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      pointerOffsetX: event.clientX - rectangle.left,
      pointerOffsetY: event.clientY - rectangle.top,
      width: rectangle.width,
      height: rectangle.height
    };
    elementRef.current.style.left = `${rectangle.left}px`;
    elementRef.current.style.top = `${rectangle.top}px`;
    elementRef.current.style.right = 'auto';
    elementRef.current.style.bottom = 'auto';
    elementRef.current.style.width = `${rectangle.width}px`;
    elementRef.current.style.height = `${rectangle.height}px`;
    focusWindow();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  }, [focusWindow]);

  const handlePointerMove = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !elementRef.current) {
      return;
    }

    const nextLeft = clampToViewport(event.clientX - dragState.pointerOffsetX, globalThis.innerWidth || 0);
    const nextTop = clampToViewport(event.clientY - dragState.pointerOffsetY, globalThis.innerHeight || 0);
    elementRef.current.style.left = `${nextLeft}px`;
    elementRef.current.style.top = `${nextTop}px`;
    event.preventDefault();
  }, []);

  const handlePointerUp = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !elementRef.current) {
      return;
    }

    const rectangle = elementRef.current.getBoundingClientRect();
    dragStateRef.current = null;
    setPosition({
      left: Math.round(rectangle.left),
      top: Math.round(rectangle.top),
      right: 'auto',
      bottom: 'auto',
      width: Math.round(rectangle.width),
      height: Math.round(rectangle.height)
    });
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const style = {
    left: toCssSize(position.left),
    top: toCssSize(position.top),
    right: toCssSize(position.right),
    bottom: toCssSize(position.bottom),
    width: toCssSize(position.width),
    height: collapsed ? undefined : toCssSize(position.height)
  };

  return html`
    <section
      id=${id}
      ref=${elementRef}
      className=${`floating-window ${className} ${collapsed ? 'is-collapsed' : ''}`.trim()}
      data-floating-window
      data-window-key=${windowKey}
      hidden=${!visible}
      style=${style}
      aria-label=${title}
      onPointerDown=${focusWindow}
    >
      <header
        className="floating-window-titlebar"
        data-window-drag-handle
        onPointerDown=${handlePointerDown}
        onPointerMove=${handlePointerMove}
        onPointerUp=${handlePointerUp}
        onPointerCancel=${handlePointerUp}
      >
        <strong>${title}</strong>
        <div className="floating-window-actions">
          <button type="button" data-window-command="collapse" aria-label=${`Collapse ${title}`} onClick=${toggleCollapse}>-</button>
          <button type="button" data-window-command="close" aria-label=${`Close ${title}`} onClick=${hide}>x</button>
        </div>
      </header>
      <div className="floating-window-body">
        ${children}
      </div>
    </section>
  `;
}
