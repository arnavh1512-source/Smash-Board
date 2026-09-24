"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
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
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = "primary", block, className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx("btn", BUTTON_CLASS[variant], block && "btn-block", className)}
    />
  );
}

interface ConfirmButtonProps extends Omit<ButtonProps, "onClick" | "ref"> {
  /** What is about to happen, shown in place of the button until answered. */
  question: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => unknown;
  /** Act straight away, for the cases where there is nothing to lose. */
  skip?: boolean;
}

/**
 * A destructive button that asks inline before it acts. A native confirm()
 * dialog is blocked inside some in-app browsers and reads as a system error
 * on a phone, so the question is drawn in the page, where it can be styled,
 * translated and answered with a thumb.
 */
export function ConfirmButton({
  question,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  skip,
  ...props
}: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const answered = useRef(false);

  useEffect(() => {
    // Hand focus back to the button that opened the question once it closes.
    if (asking || !answered.current) return;
    answered.current = false;
    trigger.current?.focus();
  }, [asking]);

  function close() {
    answered.current = true;
    setAsking(false);
  }

  if (asking) {
    return (
      <div
        className="flex w-full basis-full flex-col gap-2"
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      >
        <Alert kind="warning">{question}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="danger"
            className="min-h-12"
            autoFocus
            onClick={() => {
              close();
              void onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
          <Button type="button" variant="secondary" className="min-h-12" onClick={close}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      {...props}
      ref={trigger}
      onClick={() => (skip ? void onConfirm() : setAsking(true))}
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel: a bottom sheet on phones, a centred box from `sm` up.
 *
 * It owns what every modal owes a keyboard and screen-reader user: Escape
 * closes it, focus moves inside on open and cannot Tab out behind the
 * backdrop, the page underneath stops scrolling, and focus goes back to
 * whatever opened it on close.
 */
export function Sheet({
  label,
  onClose,
  closeOnBackdrop = false,
  children,
}: {
  label: string;
  onClose: () => void;
  /** Off where a stray tap on the backdrop would throw away typed work. */
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Callers pass inline arrows; a ref keeps the effect from re-running each render.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    if (node && !node.contains(document.activeElement)) node.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close.current();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[color-mix(in_srgb,#201e1d_55%,transparent)] sm:items-center sm:p-4"
      onClick={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) close.current();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto overscroll-contain border border-[var(--color-divider)] bg-[var(--color-bg)] pb-[max(1rem,env(safe-area-inset-bottom))] outline-none"
      >
        {children}
      </div>
    </div>
  );
}

const STALL_MS = 8000;

/** A load that is taking this long is usually a dropped connection, so say so. */
export function Spinner({ label = "Loading" }: { label?: string }) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div role="status" className="px-4 py-8 text-[13px] text-muted">
      <p className="m-0 flex items-center gap-2">
        <LiveDot />
        {label}…
      </p>
      {stalled ? (
        <p className="m-0 mt-2">
          This is taking longer than usual. Check your internet connection, then reload the page.
        </p>
      ) : null}
    </div>
  );
}
