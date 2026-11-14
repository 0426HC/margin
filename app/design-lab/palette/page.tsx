import type { Metadata } from "next";
import { PaletteLab } from "./PaletteLab";
import "./palette-lab.css";

export const metadata: Metadata = { title: "Palette lab" };

export default function PaletteLabPage() {
  return <PaletteLab />;
}
