import { useId } from "react";

/** Nhóm lựa chọn loại trừ nhau, hiện thành một dải nút (về mặt DOM là các ô radio). */
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: [T, string][];
  onChange(value: T): void;
}) {
  const name = useId();
  return (
    <fieldset className="choice">
      <legend>{legend}</legend>
      <div className="choice__options">
        {options.map(([option, label]) => (
          <label key={option}>
            <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
