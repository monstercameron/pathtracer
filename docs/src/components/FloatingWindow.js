import { html } from 'htm/preact';
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'preact/hooks';
import { uiLogger } from '../logger.js';

export const FLOATING_WINDOW_STORAGE_KEY = 'pathtracer.floatingWindows.v1';
const MIN_VISIBLE_SIZE = 80;
const VIEWPORT_PADDING = 8;

let nextZIndex = 200;

const toCssSize = (value) => (typeof value === 'number' ? `${value}px` : value);

const readTopViewportBoundary = () => {
  const documentObject = globalThis.document;
  const menuElement = documentObject && documentObject.getElementById('app-menu');
  if (!menuElement || typeof menuElement.getBoundingClientRect !== 'function') {
    return VIEWPORT_PADDING;
  }

  const menuRectangle = menuElement.getBoundingClientRect();
  return Math.max(VIEWPORT_PADDING, Math.ceil(menuRectangle.bottom + VIEWPORT_PADDING));
};

const clampToViewport = (value, maxValue, minValue = VIEWPORT_PADDING) => Math.min(
  Math.max(value, minValue),
  Math.max(minValue, maxValue - MIN_VISIBLE_SIZE)
);

const clampWindowPosition = (position) => {
  const viewportWidth = globalThis.innerWidth || 0;
  const viewportHeight = globalThis.innerHeight || 0;
  const nextPosition = { ...position };
  if (Number.isFinite(nextPosition.left)) {
    nextPosition.left = clampToViewport(nextPosition.left, viewportWidth);
  }
  if (Number.isFinite(nextPosition.top)) {
    nextPosition.top = clampToViewport(nextPosition.top, viewportHeight, readTopViewportBoundary());
  }
  return nextPosition;
};

const readStoredWindowStates = () => {
  try {
    if (!globalThis.localStorage) {
      return {};
    }
    return JSON.parse(globalThis.localStorage.getItem(FLOATING_WINDOW_STORAGE_KEY) || '{}') || {};
  } catch (error) {
    uiLogger.warn('ui:floating-window-storage-read-failed', { storageKey: FLOATING_WINDOW_STORAGE_KEY, error });
    return {};
  }
};

const writeStoredWindowState = (storageKey, state) => {
  if (!storageKey) {
    return;
  }
  try {
    if (!globalThis.localStorage) {
      return;
    }
    const states = readStoredWindowStates();
    states[storageKey] = state;
    globalThis.localStorage.setItem(FLOATING_WINDOW_STORAGE_KEY, JSON.stringify(states));
  } catch (error) {
    uiLogger.warn('ui:floating-window-storage-write-failed', { storageKey, error });
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
    position: clampWindowPosition({
      ...defaultPosition,
      left: hasStoredLeft ? storedState.left : defaultPosition.left,
      top: hasStoredTop ? storedState.top : defaultPosition.top,
      right: hasStoredLeft ? 'auto' : defaultPosition.right,
      bottom: hasStoredTop ? 'auto' : defaultPosition.bottom,
      width: Number.isFinite(storedState.width) ? Math.max(storedState.width, MIN_VISIBLE_SIZE) : defaultPosition.width,
      height: Number.isFinite(storedState.height) ? Math.max(storedState.height, 34) : defaultPosition.height
    })
  };
};

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
  visibleSignal,
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
  const previousVisibleRef = useRef(initialState.current.visible);
  const [localVisible, setLocalVisible] = useState(initialState.current.visible);
  const [collapsed, setCollapsed] = useState(initialState.current.collapsed);
  const [position, setPosition] = useState(initialState.current.position);
  const visible = visibleSignal ? Boolean(visibleSignal.value) : localVisible;

  const setWindowVisible = useCallback((nextVisible) => {
    const normalizedVisible = Boolean(nextVisible);
    if (visible !== normalizedVisible) {
      uiLogger.info('ui:floating-window-visibility', {
        windowId: storageKey,
        previousValue: visible,
        nextValue: normalizedVisible
      });
    }
    setLocalVisible(normalizedVisible);
    if (visibleSignal) {
      visibleSignal.value = normalizedVisible;
    }
  }, [storageKey, visible, visibleSignal]);

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
    uiLogger.info('ui:floating-window-command', { windowId: storageKey, command: 'show' });
    setWindowVisible(true);
    setCollapsed(false);
    focusWindow();
  }, [focusWindow, setWindowVisible, storageKey]);

  const hide = useCallback(() => {
    uiLogger.info('ui:floating-window-command', { windowId: storageKey, command: 'hide' });
    setWindowVisible(false);
  }, [setWindowVisible, storageKey]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((currentValue) => {
      const nextValue = !currentValue;
      uiLogger.info('ui:floating-window-collapse', {
        windowId: storageKey,
        previousValue: currentValue,
        nextValue
      });
      return nextValue;
    });
  }, [storageKey]);

  useImperativeHandle(forwardedRef, () => ({
    element: elementRef.current,
    show,
    hide,
    focus: focusWindow
  }), [focusWindow, hide, show]);

  useEffect(() => {
    uiLogger.info('ui:floating-window-init', {
      windowId: storageKey,
      defaultVisible,
      initialVisible: initialState.current.visible,
      initialCollapsed: initialState.current.collapsed
    });
  }, [defaultVisible, storageKey]);

  useEffect(() => {
    if (visibleSignal) {
      visibleSignal.value = initialState.current.visible;
    }
  }, [visibleSignal]);

  useEffect(() => {
    if (visible && !previousVisibleRef.current) {
      setCollapsed(false);
      setPosition((currentPosition) => clampWindowPosition(currentPosition));
      focusWindow();
    }
    previousVisibleRef.current = visible;
  }, [focusWindow, visible]);

  useEffect(() => {
    const handleResize = () => {
      setPosition((currentPosition) => clampWindowPosition(currentPosition));
    };
    globalThis.addEventListener?.('resize', handleResize);
    return () => globalThis.removeEventListener?.('resize', handleResize);
  }, []);

  useEffect(() => {
    persistCurrentState();
  }, [persistCurrentState]);

  useEffect(() => {
    if (!elementRef.current) {
      uiLogger.warn('ui:floating-window-element-unavailable', { windowId: storageKey });
      return undefined;
    }
    if (typeof ResizeObserver !== 'function') {
      uiLogger.warn('ui:floating-window-resize-observer-unavailable', { windowId: storageKey });
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
    uiLogger.debug('ui:floating-window-drag-start', {
      windowId: storageKey,
      left: Math.round(rectangle.left),
      top: Math.round(rectangle.top)
    });
    elementRef.current.style.left = `${rectangle.left}px`;
    elementRef.current.style.top = `${rectangle.top}px`;
    elementRef.current.style.right = 'auto';
    elementRef.current.style.bottom = 'auto';
    elementRef.current.style.width = `${rectangle.width}px`;
    elementRef.current.style.height = `${rectangle.height}px`;
    focusWindow();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        uiLogger.warn('ui:floating-window-pointer-capture-failed', { windowId: storageKey, error });
      }
    }
    event.preventDefault();
  }, [focusWindow, storageKey]);

  const handlePointerMove = useCallback((event) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || !elementRef.current) {
      return;
    }

    const nextLeft = clampToViewport(event.clientX - dragState.pointerOffsetX, globalThis.innerWidth || 0);
    const nextTop = clampToViewport(
      event.clientY - dragState.pointerOffsetY,
      globalThis.innerHeight || 0,
      readTopViewportBoundary()
    );
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
    uiLogger.debug('ui:floating-window-drag-end', {
      windowId: storageKey,
      left: Math.round(rectangle.left),
      top: Math.round(rectangle.top),
      width: Math.round(rectangle.width),
      height: Math.round(rectangle.height)
    });
    if (typeof event.currentTarget.releasePointerCapture === 'function') {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch (error) {
        uiLogger.warn('ui:floating-window-pointer-release-failed', { windowId: storageKey, error });
      }
    }
  }, [storageKey]);

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
          <button type="button" data-window-command="collapse" aria-label=${`Collapse ${title}`} onClick=${toggleCollapse}>
            <span className="window-command-icon window-command-collapse" aria-hidden="true"></span>
          </button>
          <button type="button" data-window-command="close" aria-label=${`Close ${title}`} onClick=${hide}>
            <span className="window-command-icon window-command-close" aria-hidden="true"></span>
          </button>
        </div>
      </header>
      <div className="floating-window-body">
        ${children}
      </div>
    </section>
  `;
}
