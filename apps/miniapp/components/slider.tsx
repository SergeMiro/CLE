'use client';

/**
 * A range input with a filled track. Browsers cannot paint the filled part on
 * their own in WebKit, so the share is handed to CSS as `--fill`.
 */
export function Slider({
  label,
  hint,
  value,
  min = 0,
  max,
  step,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min?: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="slider">
      <div className="slider-head">
        <span>{label}</span>
        <b>{hint}</b>
      </div>
      <input
        className="range"
        type="range"
        aria-label={label}
        style={{ ['--fill' as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}
