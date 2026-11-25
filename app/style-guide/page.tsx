import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AGENTS, AgentCharacter } from "@/components/agents/Agent";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { contrast } from "@/lib/ui/contrast";
import { MarginDemo, ThemeScope } from "./demos";
import { desk, mastery, paper, pairs, unitHues, type Swatch } from "./palette";

export const metadata: Metadata = { title: "Style guide" };

const sections = [
  ["colour", "Colour"],
  ["type", "Type"],
  ["surfaces", "Surfaces"],
  ["buttons", "Buttons"],
  ["inputs", "Inputs"],
  ["margin", "The margin"],
  ["agents", "Agents"],
  ["motion", "Motion"],
] as const;

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-8 border-t py-14" style={{ borderColor: "var(--panel-edge-strong)" }}>
      <h2 id={`${id}-h`} className="t-h2">{title}</h2>
      <p className="t-body mt-2 max-w-[60ch]" style={{ color: "var(--panel-muted)" }}>{lead}</p>
      <div className="mt-8">{children}</div>
    </section>
  );
}

function Chip({ s }: { s: Swatch }) {
  return (
    <li className="flex items-center gap-3">
      <span className="block h-11 w-11 shrink-0 rounded-[var(--radius-sm)]" style={{ background: s.hex, boxShadow: "0 0 0 1px rgb(255 255 255 / 0.18), inset 0 1px 0 rgb(255 255 255 / 0.2)" }} />
      <span>
        <span className="t-ui block font-semibold">{s.name}</span>
        <span className="t-label block" style={{ color: "var(--panel-muted)" }}>{s.hex}, {s.token}</span>
        <span className="t-small block text-[13.5px]" style={{ color: "var(--panel-muted)" }}>{s.role}</span>
      </span>
    </li>
  );
}

function Group({ title, items }: { title: string; items: Swatch[] }) {
  return (
    <div>
      <h3 className="t-heading-s mb-4">{title}</h3>
      <ul className="grid gap-4">{items.map((s) => <Chip key={s.token} s={s} />)}</ul>
    </div>
  );
}

const hsl = (h: number) => `hsl(${h} 60% ${h > 200 ? 62 : 56}%)`;

export default function StyleGuide() {
  return (
    <ThemeScope>
      <div className="mx-auto grid max-w-[1500px] gap-x-16 px-6 pb-32 pt-16 lg:grid-cols-[170px_minmax(0,1fr)] lg:px-10">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-16 grid gap-1">
            {sections.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="t-ui block rounded-[var(--radius-sm)] px-2 py-1" style={{ color: "var(--panel-muted)" }}>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main>
          <header className="pb-14">
            <h1 className="t-display">Margin, in parts.</h1>
            <p className="t-read mt-6" style={{ fontSize: "20px" }}>
              The Reading Room: a midnight desk under an overhead lamp, porcelain paper to read on, blue-black ink. Cinematic outside, calm inside. Every part below is a real component, built on the tokens in <code className="t-label">app/styles/tokens.css</code>, and every control is live.
            </p>
          </header>

          <Section id="colour" title="Colour" lead="One palette across the whole product. The ink blue is the only accent; plum marks Approved and Good enough, and coral or brick means an error. There is no green anywhere.">
            <div className="grid gap-10 md:grid-cols-3">
              <Group title="The desk" items={desk} />
              <Group title="Paper and ink" items={paper} />
              <Group title="Mastery" items={mastery} />
            </div>
            <h3 className="t-heading-s mb-4 mt-12">Unit and project accents</h3>
            <p className="t-body mb-4 max-w-[60ch]" style={{ color: "var(--panel-muted)" }}>
              Used on the landing page and the overview only. Each project picks its units from this set, seeded from its title, so a course always looks the same. Greens and reds are left out: red already means shaky.
            </p>
            <ul className="flex flex-wrap gap-3">
              {unitHues.map((u) => (
                <li key={u.name} className="flex items-center gap-2">
                  <span className="block h-7 w-7 rounded-full" style={{ background: hsl(u.hue) }} />
                  <span className="t-ui">{u.name}</span>
                </li>
              ))}
            </ul>
            <h3 className="t-heading-s mb-4 mt-12">Contrast</h3>
            <table className="w-full max-w-[720px] border-collapse text-left">
              <caption className="sr-only">Contrast ratios for the pairs that carry text and marks</caption>
              <thead>
                <tr className="t-label" style={{ color: "var(--panel-muted)" }}>
                  <th scope="col" className="py-2 pr-4 font-normal">Pair</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Ratio</th>
                  <th scope="col" className="py-2 font-normal">Needs</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => {
                  const r = contrast(p.fg, p.bg);
                  return (
                    <tr key={p.label} className="border-t" style={{ borderColor: "var(--panel-edge)" }}>
                      <td className="t-ui py-2 pr-4">
                        <span aria-hidden="true" className="mr-3 inline-grid h-5 w-8 place-items-center rounded-[3px]" style={{ background: p.bg }}><i className="block h-2.5 w-4 rounded-[2px]" style={{ background: p.fg }} /></span>
                        {p.label}
                      </td>
                      <td className="t-label py-2 pr-4">{r.toFixed(1)}:1</td>
                      <td className="t-label py-2">{p.min}:1 {r >= p.min ? "met" : "not met"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>

          <Section id="type" title="Type" lead="Three families, each with one job. Bricolage Grotesque for display, Literata for long reading with generous leading and a 62-character measure, Courier Prime for labels, page markers and citations.">
            <dl className="grid gap-8">
              {[
                ["Display", "Bricolage Grotesque 650, clamp(56px, 8vw, 128px)", <p key="d" className="t-display">Margin.</p>],
                ["Heading 1", "Bricolage Grotesque 650, 28 to 36px", <p key="h1" className="t-h1">Federalist No. 10, part 1 of 3</p>],
                ["Heading 2", "Bricolage Grotesque 650, 28px", <p key="h2" className="t-h2">The Union and faction</p>],
                ["Heading 3", "Bricolage Grotesque 650, 22px", <p key="h3" className="t-h3">Why this section matters</p>],
                ["Label", "Courier Prime 12px, for page markers, sources and citations", <p key="l" className="t-label">federalist-papers.pdf, pp. 38&ndash;40 &nbsp; [federalist-papers.pdf, p. 39]</p>],
              ].map(([name, spec, node]) => (
                <div key={name as string} className="grid gap-2 md:grid-cols-[170px_minmax(0,1fr)]">
                  <dt>
                    <span className="t-ui block font-semibold">{name as string}</span>
                    <span className="t-label block" style={{ color: "var(--panel-muted)" }}>{spec as string}</span>
                  </dt>
                  <dd className="m-0">{node as ReactNode}</dd>
                </div>
              ))}
            </dl>
            <Surface kind="paper" className="mt-10 px-8 py-8">
              <p className="t-label mb-3" style={{ color: "var(--ink-muted)" }}>Reading, Literata 17.5px on 1.72, 62ch</p>
              <p className="t-read" style={{ margin: 0 }}>
                By a faction, I understand a number of citizens, whether amounting to a majority or a minority of the whole, who are united and actuated by some common impulse of passion, or of interest, adversed to the rights of other citizens, or to the permanent and aggregate interests of the community.
              </p>
              <p className="t-body mt-6" style={{ margin: "24px 0 0" }}>Interface text, Literata 15.5px. Buttons say exactly what happens, in sentence case.</p>
            </Surface>
          </Section>

          <Section id="surfaces" title="Surfaces" lead="Depth shows what is paper and what is desk. The reading pane is the brightest, largest thing on screen; the side panes recede into the desk. Grain appears on paper only.">
            <div className="grid gap-6 md:grid-cols-2">
              <Surface kind="desk" className="rounded-[var(--radius)] p-6" style={{ boxShadow: "0 0 0 1px var(--panel-edge-strong)" }}>
                <h3 className="t-heading-s">Desk</h3>
                <p className="t-ui mt-1" style={{ color: "var(--panel-muted)" }}>The app sits on it. Midnight navy under an overhead lamp by default; a light mist desk is the alternative.</p>
              </Surface>
              <Surface kind="panel" className="p-6">
                <h3 className="t-heading-s">Panel</h3>
                <p className="t-ui mt-1" style={{ color: "var(--panel-muted)" }}>The section list and the chat. One inset highlight, one soft shadow.</p>
              </Surface>
              <Surface kind="paper" className="p-6">
                <h3 className="t-heading-s">Paper, resting</h3>
                <p className="t-ui mt-1" style={{ color: "var(--ink-muted)" }}>Top-edge highlight, layered shadows, 8px corners.</p>
              </Surface>
              <Surface kind="paper" raised className="p-6">
                <h3 className="t-heading-s">Paper, raised</h3>
                <p className="t-ui mt-1" style={{ color: "var(--ink-muted)" }}>A deeper shadow, for a sheet that is being held.</p>
              </Surface>
              <Surface kind="slip" className="p-5 md:col-span-2">
                <h3 className="t-heading-s">Slip</h3>
                <p className="t-ui mt-1" style={{ color: "var(--ink-muted)" }}>A small piece of paper: a tutor&rsquo;s answer, a primary button.</p>
              </Surface>
            </div>
          </Section>


          <Section id="buttons" title="Buttons" lead="They say exactly what happens. Primary is a slip of paper on the desk; secondary is an outline; accent is the ink, for actions on paper; quiet is a text button.">
            <div className="grid gap-6 md:grid-cols-2">
              <Surface kind="panel" className="surface-desk grid gap-5 p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Button>Quiz me</Button>
                  <Button variant="primary">Teach it back</Button>
                  <Button variant="accent">Send</Button>
                  <Button variant="quiet">Review today</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button disabled>Quiz me</Button>
                  <Button variant="primary" disabled>Teach it back</Button>
                  <Button variant="accent" disabled>Send</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="lg" variant="primary">Continue reading</Button>
                  <Button size="lg">New project</Button>
                </div>
              </Surface>
              <Surface kind="paper" className="grid content-start gap-5 p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="accent">Save note</Button>
                  <Button variant="accent" disabled>Save note</Button>
                </div>
                <p className="t-ui" style={{ color: "var(--ink-muted)", margin: 0 }}>On paper, the accent button takes the ink blue. Press states scale to 0.97; hover applies only to a real pointer.</p>
              </Surface>
            </div>
          </Section>

          <Section id="inputs" title="Inputs" lead="Every field has a label, even when it is visually hidden. Errors say what went wrong and how to fix it.">
            <div className="grid gap-6 md:grid-cols-2">
              <Surface kind="panel" className="surface-desk grid gap-5 p-6">
                <Input label="Project name" placeholder="POL 210, The Federalist Papers" hint="Shown on the landing page." />
                <Input label="Course code" defaultValue="POL 2" error="Course codes look like POL 210. Add the number." />
                <Textarea label="Ask anything about this section" placeholder="Ask anything about this section" />
              </Surface>
              <Surface kind="paper" className="grid content-start gap-5 p-6">
                <Input label="Note title" placeholder="Compare No. 10 with No. 51" />
                <Textarea label="Note" rows={3} placeholder="note to self: …" hint="Put a question in (parentheses) and it is answered for you." />
              </Surface>
            </div>
          </Section>


          <Section id="margin" title="The margin" lead="The signature detail, and the reason for the name. Page markers (Source) and citations (Explained) live in a left gutter beside the text. A citation opens the original page.">
            <MarginDemo />
          </Section>


          <Section id="agents" title="Agents" lead="Five original characters, one shape and one colour each, for the work that runs in the background. They sit round one table when nothing is happening, and run between their own tables when you have asked for something big.">
            <ul className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-5">
              {AGENTS.map((a, i) => (
                <li key={a.id} className="flex flex-col items-start gap-3">
                  <AgentCharacter id={a.id} size={84} blinkDelay={-i * 1.3} />
                  <span>
                    <span className="t-ui block font-semibold">{a.name}</span>
                    <span className="t-label block" style={{ color: "var(--panel-muted)" }}>{a.shape}</span>
                    <span className="t-ui mt-1 block" style={{ color: "var(--panel-muted)" }}>{a.job}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>


          <Section id="motion" title="Motion" lead="Cinematic outside, calm inside. The home, the overview and the zoom carry the personality. Inside the workspace, motion only helps reading.">
            <dl className="grid max-w-[720px] gap-4">
              {[
                ["--ease-out", "cubic-bezier(0.23, 1, 0.32, 1). A strong ease-out for everything that responds to you."],
                ["--dur-fast, --dur, --dur-slow", "140ms, 220ms, 300ms. Workspace motion stays inside this range."],
                ["Transform and opacity only", "The one exception is pane width while collapsing, because animating transform would distort the text."],
                ["Nothing animates on keyboard actions", "Moving between sections and Cmd+K are instant."],
                ["Reduced motion", "Durations collapse to near zero, scenes become plain fades, and the zoom becomes a direct navigation."],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 md:grid-cols-[250px_minmax(0,1fr)]">
                  <dt className="t-label">{k}</dt>
                  <dd className="t-ui m-0" style={{ color: "var(--panel-muted)" }}>{v}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </main>
      </div>
    </ThemeScope>
  );
}
