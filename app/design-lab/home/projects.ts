import { units } from "../data";

export type Project = {
  id: string;
  code: string;
  title: string;
  /** Examples are placeholders that show how other courses would look. Only the demo is real content. */
  example: boolean;
  counts: { solid: number; shaky: number; new: number };
  resume: { label: string; sectionId?: string };
};

const all = units.flatMap((u) => u.sections);
const count = (s: string) => all.filter((x) => x.status === s).length;

export const projects: Project[] = [
  {
    id: "federalist",
    code: "POL 210",
    title: "The Federalist Papers",
    example: false,
    counts: { solid: count("solid"), shaky: count("shaky"), new: count("new") },
    resume: { label: "Federalist No. 10, part 1 of 3", sectionId: "no10-1" },
  },
  {
    id: "micro",
    code: "ECON 101",
    title: "Introduction to Microeconomics",
    example: true,
    counts: { solid: 11, shaky: 4, new: 14 },
    resume: { label: "Elasticity, part 2 of 3" },
  },
  {
    id: "cells",
    code: "BIO 140",
    title: "Cell Biology",
    example: true,
    counts: { solid: 3, shaky: 2, new: 22 },
    resume: { label: "The cell cycle, part 1 of 2" },
  },
];

export const byId = (id: string | undefined) => projects.find((p) => p.id === id) ?? projects[0];
