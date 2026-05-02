import { html } from 'htm/preact';
import { useEffect } from 'preact/hooks';
import {
  LOGGER_CHANNELS,
  clearLoggerEntries,
  uiLogger,
  loggerIssueEntries
} from '../logger.js';
import { uiWindowVisibilitySignals } from '../store.js';
import { FloatingWindow } from './FloatingWindow.js';

const formatLogTimestamp = (timestamp) => {
  if (typeof timestamp !== 'string') {
    return '';
  }
  return timestamp.includes('T') ? timestamp.slice(11, 23) : timestamp;
};

const createDetailsReplacer = () => {
  const seenValues = new WeakSet();
  return (key, value) => {
    if (typeof value === 'bigint') {
      return `${value.toString()}n`;
    }
    if (typeof value === 'function') {
      return `[Function ${value.name || 'anonymous'}]`;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack
      };
    }
    if (value && typeof value === 'object') {
      if (seenValues.has(value)) {
        return '[Circular]';
      }
      seenValues.add(value);
    }
    return value;
  };
};

const formatLogDetails = (details) => {
  if (details === undefined || details === null || details === '') {
    return '';
  }
  if (typeof details === 'string') {
    return details;
  }
  if (details instanceof Error) {
    return [details.name, details.message, details.stack].filter(Boolean).join('\n');
  }

  try {
    return JSON.stringify(details, createDetailsReplacer(), 2);
  } catch {
    return String(details);
  }
};

const indentLogDetails = (detailsText) => (
  detailsText.split('\n').map((line) => `  ${line}`).join('\n')
);

const formatLogLine = (entry) => {
  const detailsText = formatLogDetails(entry.details);
  const timestamp = formatLogTimestamp(entry.timestamp);
  const timestampPrefix = timestamp ? `[${timestamp}] ` : '';
  const baseLine = `${timestampPrefix}${String(entry.level).toUpperCase()} ${entry.channel}: ${entry.message}`;
  return detailsText ? `${baseLine}\n${indentLogDetails(detailsText)}` : baseLine;
};

export function LogPanel({
  id = 'log-panel',
  defaultPosition = { left: 18, bottom: 18, width: 560, height: 'min(40vh, 360px)' }
}) {
  useEffect(() => {
    uiLogger.info('ui:panel-init', { panelId: id, panelName: 'LogPanel' });
  }, [id]);

  const entries = loggerIssueEntries.value;
  const displayedEntries = entries.slice().reverse();
  const logText = displayedEntries.length > 0
    ? displayedEntries.map(formatLogLine).join('\n\n')
    : 'No warnings or errors captured.';
  const handleClearClick = () => {
    uiLogger.info('ui:log-panel-clear', { entryCount: entries.length });
    clearLoggerEntries();
  };

  return html`
    <${FloatingWindow}
      id=${id}
      windowKey="log-panel"
      title="Log"
      className="log-panel"
      defaultPosition=${defaultPosition}
      defaultVisible=${false}
      visibleSignal=${uiWindowVisibilitySignals['log-panel']}
    >
      <div className="log-panel-toolbar">
        <div className="section-title">Entries</div>
        <button type="button" onClick=${handleClearClick} disabled=${entries.length === 0}>Clear</button>
      </div>
      <div className="log-panel-summary">
        <span>${entries.length} warnings/errors</span>
        <span>${LOGGER_CHANNELS.length} channels</span>
      </div>
      <pre className="log-entry-list" aria-live="polite">${logText}</pre>
    <//>
  `;
}
