import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevToggle } from "@/components/cinematic/Agents";

afterEach(() => vi.unstubAllEnvs());

const render = () => renderToStaticMarkup(<DevToggle />);

describe("the dev agents toggle", () => {
  it("renders in development, where flipping between idle, busy and done is useful", () => {
    vi.stubEnv("NODE_ENV", "development");
    const out = render();
    expect(out).toContain("Dev, agents");
    for (const m of ["idle", "busy", "done"]) expect(out).toContain(`>${m}</button>`);
  });

  it("renders nothing in a production build, so nobody using Margin ever sees it", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(render()).toBe("");
  });

  it("renders nothing in tests or any other mode", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(render()).toBe("");
  });
});
