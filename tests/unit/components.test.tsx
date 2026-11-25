import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { CitedText } from "@/components/ui/Citation";
import { Input } from "@/components/ui/Input";
import { MarginGutter } from "@/components/workspace/MarginGutter";

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("type", "button");
  });
});

describe("Input", () => {
  it("always has a label, and wires its error to the field", () => {
    render(<Input label="Course code" error="Course codes look like POL 210." hideLabel />);
    const field = screen.getByLabelText("Course code");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Course codes look like POL 210.");
  });
});

describe("CitedText", () => {
  it("turns [file, p. N] into a button that reports the page", async () => {
    const onCite = vi.fn();
    render(<CitedText text="It splits in two. [federalist-papers.pdf, p. 39]" onCite={onCite} />);
    await userEvent.click(screen.getByRole("button", { name: /page 39/ }));
    expect(onCite).toHaveBeenCalledWith(39, "federalist-papers.pdf", "It splits in two. "); // the sentence that carried it, to pick the passage to mark
  });
});

describe("MarginGutter", () => {
  it("shows page markers, and citations that jump", async () => {
    const onJump = vi.fn();
    render(<MarginGutter marks={[{ kind: "page", page: 38 }, { kind: "cite", page: 39, file: "f.pdf", onJump }]} />);
    expect(screen.getByText("p. 38")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /p\. 39/ }));
    expect(onJump).toHaveBeenCalledWith(39, "f.pdf", undefined);
  });
});
