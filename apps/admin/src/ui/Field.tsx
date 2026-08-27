import "./Field.css";

export function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="field">
      {/* 힌트를 label 안에 두면 접근 가능한 이름에 힌트 문구가 붙어
          getByLabelText 로 조회되지 않는다. 반드시 밖에 둔다. */}
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? (
        <span className="field-hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
