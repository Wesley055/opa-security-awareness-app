"use client";
import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "type">
>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false);
  const generated = useId();
  const id = props.id ?? generated;
  return (
    <span className="opa-password-field">
      <input
        {...props}
        ref={ref}
        id={id}
        type={visible ? "text" : "password"}
      />
      <button
        className="mt-1 rounded px-2 py-1 text-sm underline disabled:opacity-60"
        type="button"
        aria-controls={id}
        aria-pressed={visible}
        aria-label={visible ? "Hide password" : "Show password"}
        disabled={props.disabled}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? "Hide password" : "Show password"}
      </button>
    </span>
  );
});
