import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { uiLogger } from '../logger.js';

const readStoredOpenState = (storageKey, fallback) => {
  if (!storageKey || typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return storedValue === 'true' ? true : (storedValue === 'false' ? false : fallback);
  } catch (error) {
    uiLogger.warn('ui:accordion-storage-read-failed', { storageKey, error });
    return fallback;
  }
};

const writeStoredOpenState = (storageKey, isOpen) => {
  if (!storageKey || typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, isOpen ? 'true' : 'false');
  } catch (error) {
    uiLogger.warn('ui:accordion-storage-write-failed', { storageKey, isOpen, error });
  }
};

export function AccordionSection({
  sectionKey,
  title,
  accentColor,
  defaultOpen = false,
  storageKey,
  controlledOpen,
  openSignal,
  children
}) {
  const [isOpen, setIsOpen] = useState(() => readStoredOpenState(storageKey, defaultOpen));
  const signalOpen = openSignal ? Boolean(openSignal.value) : undefined;
  const open = typeof controlledOpen === 'boolean'
    ? controlledOpen
    : (openSignal ? signalOpen : isOpen);

  useEffect(() => {
    uiLogger.info('ui:accordion-init', {
      sectionKey,
      storageKey,
      defaultOpen,
      controlled: typeof controlledOpen === 'boolean',
      hasOpenSignal: Boolean(openSignal)
    });
  }, [controlledOpen, defaultOpen, openSignal, sectionKey, storageKey]);

  useEffect(() => {
    if (typeof controlledOpen === 'boolean') {
      return;
    }
    const storedOpen = readStoredOpenState(storageKey, defaultOpen);
    if (openSignal) {
      openSignal.value = storedOpen;
    } else {
      setIsOpen(storedOpen);
    }
  }, [controlledOpen, defaultOpen, openSignal, storageKey]);

  const handleToggle = (event) => {
    const nextOpen = event.currentTarget.open;
    if (typeof controlledOpen !== 'boolean') {
      if (open !== nextOpen) {
        uiLogger.info('ui:accordion-toggle', {
          sectionKey,
          storageKey,
          previousValue: open,
          nextValue: nextOpen
        });
      }
      if (openSignal) {
        openSignal.value = nextOpen;
      } else {
        setIsOpen(nextOpen);
      }
      writeStoredOpenState(storageKey, nextOpen);
    }
  };

  return html`
    <details
      className="inspector-section"
      data-inspector-section=${sectionKey}
      style=${`--section-accent: ${accentColor}`}
      open=${open}
      onToggle=${handleToggle}
    >
      <summary><span data-inspector-section-label>${title}</span></summary>
      ${children}
    </details>
  `;
}
