import { html } from 'htm/preact';

const readOptionKey = (option) => option.key ?? option.value ?? option.label;

export function SelectField({
  id,
  label,
  options = [],
  value,
  disabled = false,
  ariaLabel,
  onChange,
  hidden = false,
  children
}) {
  return html`
    <div className="field" hidden=${hidden}>
      <label for=${id}>${label}</label>
      <select
        id=${id}
        value=${value}
        disabled=${disabled}
        aria-label=${ariaLabel}
        onChange=${onChange}
      >
        ${options.map((option) => html`
          <option
            key=${readOptionKey(option)}
            value=${option.value}
            disabled=${Boolean(option.disabled)}
            selected=${Boolean(option.selected)}
          >
            ${option.label}
          </option>
        `)}
      </select>
      ${children}
    </div>
  `;
}

export function ColorField({
  id,
  label,
  value,
  disabled = false,
  ariaLabel = label,
  onInput,
  hidden = false
}) {
  return html`
    <div className="field" hidden=${hidden}>
      <label for=${id}>${label}</label>
      <div className="color-control">
        <input
          id=${id}
          type="color"
          value=${value}
          disabled=${disabled}
          aria-label=${ariaLabel}
          onInput=${onInput}
        />
        <span className="color-control-swatch" aria-hidden="true"></span>
      </div>
    </div>
  `;
}

export function CheckboxField({
  id,
  label,
  checked = false,
  disabled = false,
  hidden = false,
  onChange
}) {
  return html`
    <div className="field" hidden=${hidden}>
      <label className="checkbox-field">
        <input
          id=${id}
          type="checkbox"
          checked=${checked}
          disabled=${disabled}
          onChange=${onChange}
        />
        ${label}
      </label>
    </div>
  `;
}

export function NumberInputGroup({
  labelFor,
  label,
  inputs,
  className = 'button-row',
  hidden = false,
  children
}) {
  return html`
    <div className="field" hidden=${hidden}>
      <label for=${labelFor}>${label}</label>
      <div className=${className}>
        ${inputs.map((input) => html`
          <input
            key=${input.id}
            id=${input.id}
            type="number"
            min=${input.min}
            max=${input.max}
            step=${input.step}
            placeholder=${input.placeholder}
            value=${input.value}
            disabled=${input.disabled}
            aria-label=${input.ariaLabel}
            onInput=${input.onInput}
          />
        `)}
      </div>
      ${children}
    </div>
  `;
}
