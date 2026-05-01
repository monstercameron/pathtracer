import { html } from 'htm/preact';

const renderShortcut = (shortcut) => (
  shortcut ? html`<span className="menu-shortcut">${shortcut}</span>` : null
);

const renderMenuItem = (item, onItemClick) => {
  if (item.type === 'separator') {
    return html`<div key=${item.key} className="menu-separator"></div>`;
  }
  if (item.type === 'label') {
    return html`<div key=${item.key} className="menu-label">${item.label}</div>`;
  }
  if (item.href) {
    return html`
      <a key=${item.key} href=${item.href} target=${item.target || '_self'} rel=${item.rel || undefined}>
        ${item.label}
        ${renderShortcut(item.shortcut)}
      </a>
    `;
  }

  return html`
    <button
      id=${item.id}
      key=${item.key}
      type="button"
      data-action=${item.action}
      data-preset=${item.preset}
      data-panel-target=${item.panelTarget}
      data-window-target=${item.windowTarget}
      data-quality-preset=${item.qualityPreset}
      data-benchmark-scene=${item.benchmarkScene}
      data-debug-view=${item.debugView}
      aria-pressed=${item.pressed === undefined ? undefined : String(Boolean(item.pressed))}
      disabled=${item.disabled ? true : undefined}
      onClick=${onItemClick}
    >
      ${item.label}
      ${renderShortcut(item.shortcut)}
    </button>
  `;
};

export function MenuGroup({ group, isOpen = false, onOpen, onClose }) {
  const handleTriggerClick = () => {
    if (onOpen) {
      onOpen(group.key);
    }
  };

  const handleItemClick = () => {
    if (onClose) {
      onClose();
    }
  };

  return html`
    <div className=${`menu-group ${isOpen ? 'is-open' : ''}`.trim()}>
      <button className="menu-trigger" type="button" aria-haspopup="true" aria-expanded=${String(isOpen)} onClick=${handleTriggerClick}>
        ${group.label}
      </button>
      <div className="menu-popover" role="menu">
        ${group.items.map((item) => renderMenuItem(item, handleItemClick))}
      </div>
    </div>
  `;
}
