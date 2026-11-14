import Link from "next/link";

/** The desk and a quiet top bar, for the screens that come before studying. */
export function PageFrame({ children, crumb }: { children: React.ReactNode; crumb?: string }) {
  return (
    <div className="m-desk min-h-dvh">
      <header className="mx-auto flex max-w-[1120px] items-baseline gap-4 px-10 pb-2 pt-7">
        <Link href="/" className="t-h3" style={{ letterSpacing: "-0.02em" }}>
          Margin
        </Link>
        {crumb && <span className="t-label text-panel-muted">{crumb}</span>}
      </header>
      <main className="mx-auto max-w-[1120px] px-10 pb-24 pt-8">{children}</main>
    </div>
  );
}
