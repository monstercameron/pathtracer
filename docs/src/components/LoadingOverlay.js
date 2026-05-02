import { html } from 'htm/preact';

export function LoadingOverlay() {
  return html`
    <div
      id="loading-overlay"
      className="loading-overlay"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      aria-labelledby="loading-title"
      aria-describedby="loading-status loading-detail loading-steps"
    >
      <div className="loading-card">
        <div className="loading-spinner" aria-hidden="true"></div>
        <div id="loading-title" className="loading-title">Loading renderer</div>
        <div id="loading-status" className="loading-status">Initialising renderer...</div>
        <div id="loading-detail" className="loading-detail">Blank frames during setup are expected while the renderer builds the scene.</div>
        <ol id="loading-steps" className="loading-steps" hidden></ol>
        <div id="loading-error" className="loading-error" role="alert" hidden>
          <div className="loading-error-header">
            <strong>Startup error</strong>
            <button id="copy-loading-error" className="loading-error-copy" type="button" title="Copy error details" aria-label="Copy error details">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 7h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"></path>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <pre id="loading-error-stack"></pre>
        </div>
      </div>
    </div>
  `;
}
