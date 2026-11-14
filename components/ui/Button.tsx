import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "accent" | "quiet";

/**
 * Buttons say exactly what happens ("Quiz me", "Teach it back").
 * primary: a slip of paper on the desk. secondary: an outline. accent: the ink, for actions on paper. quiet: a text button.
 */
export function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "lg" }) {
  return <button type={type} data-variant={variant} data-size={size} className={`m-btn ${className}`} {...rest} />;
}
