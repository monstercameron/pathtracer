import { html } from 'htm/preact';

const readSignalValue = (fieldSignal, fallback) => (
  fieldSignal && typeof fieldSignal === 'object' && 'value' in fieldSignal
    ? fieldSignal.value
    : fallback
);

const formatSliderValue = (value, step, unit, formatter) => {
  if (formatter) {
    return formatter(value);
  }
  const numberValue = Number(value);
  const stepText = String(step ?? '');
  const fractionDigits = stepText.includes('.')
    ? Math.min(3, stepText.split('.')[1].length)
    : 0;
  const formattedValue = Number.isFinite(numberValue)
    ? numberValue.toFixed(fractionDigits)
    : String(value ?? '');
  return `${formattedValue}${unit ? ` ${unit}` : ''}`;
};

export function SliderField({
  id,
  label,
  min,
  max,
  step = 1,
  signal,
  unit = '',
  value,
  formatter,
  onInput
}) {
  const currentValue = readSignalValue(signal, value ?? min ?? 0);
  const displayValue = formatSliderValue(currentValue, step, unit, formatter);
  const handleInput = (event) => {
    const rawValue = event.currentTarget.value;
    const nextValue = String(step).includes('.') ? Number.parseFloat(rawValue) : Number.parseInt(rawValue, 10);
    if (signal && typeof signal === 'object' && 'value' in signal) {
      signal.value = Number.isNaN(nextValue) ? rawValue : nextValue;
    }
    if (onInput) {
      onInput(Number.isNaN(nextValue) ? rawValue : nextValue, event);
    }
  };

  return html`
    <div className="field slider-field">
      <label for=${id}>
        ${label}
        <span id=${`${id}-value`} className="slider-value">${displayValue}</span>
      </label>
      <input
        id=${id}
        type="range"
        min=${min}
        max=${max}
        step=${step}
        value=${currentValue}
        onInput=${handleInput}
      />
    </div>
  `;
}
