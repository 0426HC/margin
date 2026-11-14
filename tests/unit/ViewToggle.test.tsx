import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ViewToggle, type ViewMode } from "@/components/workspace/ViewToggle";

function Harness() {
  const [mode, setMode] = useState<ViewMode>("original");
  return (
    <>
      <ViewToggle value={mode} onChange={setMode} panelId="p" />
      <output data-testid="mode">{mode}</output>
    </>
  );
}

describe("ViewToggle", () => {
  it("is a tablist with Original selected first", () => {
    render(<Harness />);
    expect(screen.getByRole("tablist", { name: "Show this section as" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Explained" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Original" })).toHaveAttribute("aria-controls", "p");
  });

  it("switches on click", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("tab", { name: "Explained" }));
    expect(screen.getByTestId("mode")).toHaveTextContent("explained");
    expect(screen.getByRole("tab", { name: "Explained" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves with the arrow keys and keeps focus on the selected tab", async () => {
    render(<Harness />);
    screen.getByRole("tab", { name: "Original" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByTestId("mode")).toHaveTextContent("explained");
    expect(screen.getByRole("tab", { name: "Explained" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByTestId("mode")).toHaveTextContent("original");
    await userEvent.keyboard("{End}");
    expect(screen.getByTestId("mode")).toHaveTextContent("explained");
  });

  it("only the selected tab is in the tab order", () => {
    render(<Harness />);
    expect(screen.getByRole("tab", { name: "Original" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Explained" })).toHaveAttribute("tabindex", "-1");
  });
});
