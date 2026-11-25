import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MoreMenu } from "@/components/ui/MoreMenu";

// jsdom has <dialog> but not its modal methods; this stands in for them (the browser itself is covered by the Playwright tests).
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
afterEach(() => vi.unstubAllGlobals());

describe("the '...' menu", () => {
  const setup = () => {
    const onSelect = vi.fn();
    render(<MoreMenu label="More actions for Course" items={[{ label: "Delete project", onSelect }]} />);
    return { onSelect, button: screen.getByRole("button", { name: "More actions for Course" }) };
  };

  it("opens a menu with the action, moves focus into it, and runs the action on Enter", async () => {
    const user = userEvent.setup();
    const { onSelect, button } = setup();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const item = screen.getByRole("menuitem", { name: "Delete project" });
    expect(item).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is fully usable by keyboard: ArrowDown opens it, Escape closes it and returns focus to the button", async () => {
    const user = userEvent.setup();
    const { onSelect, button } = setup();
    button.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete project" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes on a click elsewhere without running anything", async () => {
    const user = userEvent.setup();
    const { onSelect, button } = setup();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("the confirm dialog", () => {
  it("is a labelled dialog that starts on Cancel, so a stray Enter cannot delete", () => {
    render(
      <ConfirmDialog open title="Delete it?" confirmLabel="Delete it" onConfirm={() => {}} onCancel={() => {}}>
        <p>It cannot be undone.</p>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete it?" });
    expect(dialog).toHaveAccessibleDescription("It cannot be undone.");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms and cancels through its two buttons, and Escape cancels", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Delete it?" confirmLabel="Delete it" onConfirm={onConfirm} onCancel={onCancel}>
        <p>Sure?</p>
      </ConfirmDialog>,
    );
    await user.click(screen.getByRole("button", { name: "Delete it" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab and Shift+Tab inside the dialog", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmDialog open title="Delete it?" confirmLabel="Delete it" onConfirm={() => {}} onCancel={() => {}}>
        <p>Sure?</p>
      </ConfirmDialog>,
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const ok = screen.getByRole("button", { name: "Delete it" });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(ok).toHaveFocus();
    await user.tab(); // from the last button, round to the first
    expect(cancel).toHaveFocus();
    await user.tab({ shift: true }); // and backwards from the first, round to the last
    expect(ok).toHaveFocus();
  });

  it("while it is working, nothing can be pressed or cancelled, and an error says what went wrong", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open busy title="Delete it?" confirmLabel="Delete it" error="Margin couldn't delete it. Try again." onConfirm={() => {}} onCancel={onCancel}>
        <p>Sure?</p>
      </ConfirmDialog>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Margin couldn't delete it. Try again.");
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("draws nothing inside while closed", () => {
    render(
      <ConfirmDialog open={false} title="Delete it?" confirmLabel="Delete it" onConfirm={() => {}} onCancel={() => {}}>
        <p>Sure?</p>
      </ConfirmDialog>,
    );
    expect(screen.queryByText("Sure?")).toBeNull();
  });
});

describe("the delete-project dialog", () => {
  const project = { id: "abc123", name: "POL101 Politics", isDemo: false };
  const fetchWith = (status: number, body: unknown = {}) => {
    const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", f);
    return f;
  };

  it("names the project and says exactly what is removed, and that it cannot be undone", () => {
    render(<DeleteProjectDialog project={project} onClose={() => {}} onDeleted={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Delete “POL101 Politics”?" })).toBeInTheDocument();
    const text = screen.getByRole("dialog").textContent ?? "";
    for (const part of ["permanently removes", "files", "layers", "write-ups", "Note to Self", "chats", "notepad", "sources", "cannot be undone"]) expect(text).toContain(part);
    expect(text).not.toContain("demo course");
  });

  it("tells the student the demo can be opened again, as a fresh copy", () => {
    render(<DeleteProjectDialog project={{ ...project, isDemo: true }} onClose={() => {}} onDeleted={() => {}} />);
    expect(screen.getByRole("dialog").textContent).toContain("The demo course can be opened again from Your projects, as a fresh copy without your work.");
  });

  it("sends DELETE for that project only when confirmed, then reports it deleted", async () => {
    const f = fetchWith(200, { deleted: true });
    const onDeleted = vi.fn();
    render(<DeleteProjectDialog project={project} onClose={() => {}} onDeleted={onDeleted} />);
    expect(f).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(f).toHaveBeenCalledWith("/api/projects/abc123", { method: "DELETE" });
  });

  it("cancel deletes nothing", async () => {
    const f = fetchWith(200);
    const onClose = vi.fn();
    render(<DeleteProjectDialog project={project} onClose={onClose} onDeleted={() => {}} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });

  it("a failure is explained and the project is not reported deleted; a project that is already gone counts as deleted", async () => {
    fetchWith(500, { error: "Something went wrong on Margin's side." });
    const onDeleted = vi.fn();
    const { unmount } = render(<DeleteProjectDialog project={project} onClose={() => {}} onDeleted={onDeleted} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong on Margin's side.");
    expect(onDeleted).not.toHaveBeenCalled();
    unmount();

    fetchWith(404, { error: "That project is already gone." });
    render(<DeleteProjectDialog project={project} onClose={() => {}} onDeleted={onDeleted} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
  });
});

describe("no browser pop-ups", () => {
  it("never uses alert, confirm or prompt anywhere in the app's code", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /\b(window\.)?(alert|confirm|prompt)\(/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
      }
    };
    for (const d of ["app", "components", "lib"]) walk(path.join(process.cwd(), d));
    expect(hits).toEqual([]);
  });
});
