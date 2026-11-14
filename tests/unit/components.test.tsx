import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Message } from "@/components/chat/Message";
import { Button } from "@/components/ui/Button";
import { CitedText } from "@/components/ui/Citation";
import { Input } from "@/components/ui/Input";
import { MasteryMark } from "@/components/ui/MasteryMark";
import { MarginGutter } from "@/components/workspace/MarginGutter";
import { SectionList } from "@/components/workspace/SectionList";
import { sampleUnits } from "@/components/demo/sample";

describe("MasteryMark", () => {
  it("names its state without relying on colour", () => {
    render(
      <>
        <MasteryMark status="new" />
        <MasteryMark status="shaky" />
        <MasteryMark status="solid" withLabel />
      </>,
    );
    expect(screen.getByRole("img", { name: "New" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Shaky" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Solid" })).toHaveTextContent("Solid");
  });
});

describe("Button", () => {
  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Quiz me</Button>);
    expect(screen.getByRole("button", { name: "Quiz me" })).toHaveAttribute("type", "button");
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

describe("Message", () => {
  it("renders each kind with its data-kind", () => {
    render(
      <>
        <Message kind="tutor" label="Answer">Hello</Message>
        <Message kind="user">Hi</Message>
      </>,
    );
    expect(screen.getByText("Answer")).toBeInTheDocument();
    expect(screen.getByText("Hi").closest("[data-kind]")).toHaveAttribute("data-kind", "user");
  });
});

describe("SectionList", () => {
  it("groups by unit, collapses a unit, and marks the current section", async () => {
    const onSelect = vi.fn();
    render(<SectionList units={sampleUnits} activeId="no10-1" onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /Federalist No\. 10, part 1 of 3/ })).toHaveAttribute("aria-current", "true");
    await userEvent.click(screen.getByRole("button", { name: /Federalist No\. 2$/ }));
    expect(onSelect).toHaveBeenCalledWith("no2");
    const head = screen.getByRole("button", { name: /Week 1/ });
    expect(head).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(head);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Federalist No\. 2$/ })).not.toBeInTheDocument();
  });
});
