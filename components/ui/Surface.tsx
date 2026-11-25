import type { HTMLAttributes } from "react";

/** desk: the app background. panel: a side pane. paper: the reading sheet. slip: a small piece of paper. */
export function Surface({
  kind,
  raised,
  as: Tag = "div",
  className = "",
  ...rest
}: HTMLAttributes<HTMLElement> & { kind: "desk" | "panel" | "paper" | "slip"; raised?: boolean; as?: "div" | "section" | "aside" | "article" }) {
  return <Tag className={`m-${kind} ${className}`} data-raised={raised ? "" : undefined} {...rest} />;
}
