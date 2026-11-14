import { useId } from 'react';

interface Props<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** Переключатель из нативных радиокнопок: стрелки и фокус работают без своего кода. */
export function Segmented<T extends string>({ label, value, options, onChange }: Props<T>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend>{label}</legend>
      <div className="segmented-track">
        {options.map((o) => (
          <label key={o.value} className={o.value === value ? 'is-active' : ''}>
            <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
