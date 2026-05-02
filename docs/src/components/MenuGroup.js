import { html } from 'htm/preact';

const renderShortcut = (shortcut) => (
  shortcut ? html`<span className="menu-shortcut">${shortcut}</span>` : null
);

const readPressedValue = (item, pressedSignals = {}) => {
  const actionSignal = item.action ? pressedSignals[item.action] : null;
  const windowSignal = item.windowTarget ? pressedSignals[`window:${item.windowTarget}`] : null;
  const panelSignal = item.panelTarget ? pressedSignals[`panel:${item.panelTarget}`] : null;
  const targetSignal = actionSignal || windowSignal || panelSignal;
  if (targetSignal) {
    return Boolean(targetSignal.value);
  }
  return item.pressed === undefined ? undefined : Boolean(item.pressed);
};

const renderMenuItem = (item, onItemClick, pressedSignals) => {
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

  const pressedValue = readPressedValue(item, pressedSignals);
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
      aria-pressed=${pressedValue === undefined ? undefined : String(pressedValue)}
      disabled=${item.disabled ? true : undefined}
      onClick=${(event) => onItemClick(event, item)}
    >
      ${item.label}
      ${renderShortcut(item.shortcut)}
    </button>
  `;
};

export function MenuGroup({ group, isOpen = false, pressedSignals, onOpen, onClose, onItemClick }) {
  const handleTriggerClick = () => {
    if (onOpen) {
      onOpen(group.key);
    }
  };

  const handleItemClick = (event, item) => {
    if (onItemClick) {
      onItemClick(event, item);
    }
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
        ${group.items.map((item) => renderMenuItem(item, handleItemClick, pressedSignals))}
      </div>
    </div>
  `;
}
