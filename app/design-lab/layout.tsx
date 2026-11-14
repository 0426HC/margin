import "./workspace.css";

// Fonts and tokens now come from the root layout. The lab stays as the frozen reference for the real components.
export default function DesignLabLayout({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}
