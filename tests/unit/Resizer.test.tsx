import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Resizer } from "@/components/workspace/Resizer";

function Harness({ invert = false, start = 300 }: { invert?: boolean; start?: number }) {
  const [w, setW] = useState(start);
  return <Resizer label="Resize" value={w} min={220} max={400} onChange={setW} invert={invert} />;
}

describe("Resizer", () => {
  it("is a focusable separator that reports its value and limits", () => {
    render(<Harness />);
    const el = screen.getByRole("separator", { name: "Resize" });
    expect(el).toHaveAttribute("aria-valuenow", "300");
    expect(el).toHaveAttribute("aria-valuemin", "220");
    expect(el).toHaveAttribute("aria-valuemax", "400");
    expect(el).toHaveAttribute("tabindex", "0");
  });

  it("changes width with the arrow keys, within its limits", async () => {
    render(<Harness />);
    const el = screen.getByRole("separator");
    el.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(el).toHaveAttribute("aria-valuenow", "316");
    await userEvent.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}");
    expect(el).toHaveAttribute("aria-valuenow", "400");
    await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}");
    expect(el).toHaveAttribute("aria-valuenow", "220");
  });

  it("an inverted handle grows its pane when moved left", async () => {
    render(<Harness invert />);
    const el = screen.getByRole("separator");
    el.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(el).toHaveAttribute("aria-valuenow", "316");
  });
});
