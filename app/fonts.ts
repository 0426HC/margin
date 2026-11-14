import { Bricolage_Grotesque, Courier_Prime, Literata } from "next/font/google";

// Display, long reading, and labels. The families are named in tokens.css (--font-display, --font-text, --font-label).
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });
const text = Literata({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-literata" });
const label = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-courier" });

export const fontVariables = `${display.variable} ${text.variable} ${label.variable}`;
