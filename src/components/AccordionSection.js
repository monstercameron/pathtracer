import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';

const readStoredOpenState = (storageKey, fallback) => {
  if (!storageKey || typeof window === 'undefined' || !window.localStorage) {
    return fallback;
  }
  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return storedValue === 'true' ? true : (storedValue === 'false' ? false : fallback);
  } catch {
    return fallback;
  }
};

const writeStoredOpenState = (storageKey, isOpen) => {
  if (!storageKey || typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, isOpen ? 'true' : 'false');
  } catch {
    // Local storage can fail in private contexts; the details element still works.
  }
};

export function AccordionSection({
  sectionKey,
  title,
  accentColor,
  defaultOpen = false,
  storageKey,
  controlledOpen,
  children
}) {
  const [isOpen, setIsOpen] = useState(() => readStoredOpenState(storageKey, defaultOpen));
  const open = typeof controlledOpen === 'boolean' ? controlledOpen : isOpen;

  useEffect(() => {
    if (typeof controlledOpen !== 'boolean') {
      setIsOpen(readStoredOpenState(storageKey, defaultOpen));
    }
  }, [controlledOpen, defaultOpen, storageKey]);

  const handleToggle = (event) => {
    const nextOpen = event.currentTarget.open;
    if (typeof controlledOpen !== 'boolean') {
      setIsOpen(nextOpen);
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
