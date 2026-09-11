"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

/**
 * The design system has three button roles. Destructive actions reuse the
 * primary treatment — the red is already the alarm colour, so a second one
 * would only dilute it.
 */
const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-primary",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Full width, text aligned left — the design's dominant call-to-action shape. */
  block?: boolean;
}

export function Button({ variant = "primary", block, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx("btn", BUTTON_CLASS[variant], block && "btn-block", className)}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("card", className)}>{children}</section>;
}

/**
 * A block of the page set on the surface colour and separated by a 2px rule,
 * which is how the design divides a screen into sections.
 */
export function Section({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("flex flex-col gap-3 rule-b2 px-4 py-4", className)}>{children}</section>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("field block", className)}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("input", className)} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx("input", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("input", className)} />;
}

/**
 * A checkbox drawn as the design's dot control. The native input stays in the
 * tree, hidden, so keyboard and assistive technology behaviour is unchanged.
 */
export function Checkbox({
  label,
  ...props
}: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="radio min-h-11 gap-2.5">
      <input type="checkbox" {...props} />
      <span className="dot" />
      <span className="text-[13px]">{label}</span>
    </label>
  );
}

export function Alert({
  kind,
  children,
}: {
  kind: "error" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      // A warning carries the same accent as an error — it is the thing on the
      // screen that most wants reading — but it is not announced as an alert,
      // because nothing the reader just did has failed.
      className={cx("note m-0", (kind === "error" || kind === "warning") && "note-accent")}
    >
      {children}
    </p>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "outline";
}) {
  return <span className={cx("tag", `tag-${tone}`)}>{children}</span>;
}

/** The pulsing square the design uses wherever something is happening now. */
export function LiveDot({ size = 8 }: { size?: number }) {
  return <span className="live-dot" style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 px-4 py-8 text-[13px] text-muted">
      <LiveDot />
      {label}…
    </p>
  );
}
