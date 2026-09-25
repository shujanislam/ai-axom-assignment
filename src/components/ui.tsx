import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-[28px] font-bold italic leading-tight tracking-[-0.03em]">{title}</h1>
        <p className="mt-1 text-[13.5px] text-muted">{subtitle}</p>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return <section className={`rounded-[20px] bg-white ${className}`} {...props} />;
}

type ButtonVariant = "primary" | "secondary" | "outline";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-[#34302a] h-[46px] px-6",
  secondary: "bg-white text-ink hover:bg-white/70 h-[46px] px-5",
  outline: "bg-white text-ink border border-line hover:bg-well h-9 px-4 text-[13.5px]",
};

type ButtonProps = { variant?: ButtonVariant; icon?: ReactNode; children: ReactNode };

function buttonClass(variant: ButtonVariant, extra = "") {
  return `inline-flex items-center justify-center gap-2.5 rounded-full text-[14px] font-medium transition-colors disabled:opacity-50 ${buttonStyles[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  icon,
  children,
  className,
  ...props
}: ButtonProps & Omit<ComponentProps<"button">, "children">) {
  return (
    <button type="button" className={buttonClass(variant, className)} {...props}>
      {children}
      {icon}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  icon,
  children,
  className,
  ...props
}: ButtonProps & Omit<ComponentProps<typeof Link>, "children">) {
  return (
    <Link className={buttonClass(variant, className)} {...props}>
      {children}
      {icon}
    </Link>
  );
}

export type Tone = "amber" | "leaf" | "idle";

const dotTone: Record<Tone, string> = {
  amber: "bg-amber",
  leaf: "bg-leaf",
  idle: "bg-idle",
};

export function Dot({ tone, className = "" }: { tone: Tone; className?: string }) {
  return <span className={`inline-block size-[6px] rounded-full ${dotTone[tone]} ${className}`} />;
}

export function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-md bg-well px-2 py-0.5 text-[12px] text-muted ${className}`}>
      {children}
    </span>
  );
}

export function SectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-[14px] text-muted">
      {children}
      {count !== undefined && (
        <span className="rounded-md bg-[#e9e7e2] px-1.5 py-0.5 text-[11.5px] leading-none">{count}</span>
      )}
    </h2>
  );
}

/** A label/value row used in the detail lists. */
export function Row({ label, value, dense }: { label: ReactNode; value: ReactNode; dense?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-6 text-[13.5px] ${dense ? "py-1" : "py-1.5"}`}>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium tabular">{value}</dd>
    </div>
  );
}

export function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={note} />
      <Card className="mt-6 grid min-h-[320px] place-items-center p-10 text-center text-[14px] text-muted">
        Nothing to show here yet.
      </Card>
    </>
  );
}
