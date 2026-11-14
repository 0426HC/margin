import { z } from "zod";

// Shared by the lab page and its routes. No Node imports here: the page runs in the browser.

/** The three versions to choose between. Higher expressiveness pairs a higher `exaggeration` with a lower `cfgWeight`, as Chatterbox suggests. */
export const VERSIONS = {
  1: { label: "Default voice", exaggeration: 0.5, cfgWeight: 0.5, custom: false },
  2: { label: "Default voice, more expressive", exaggeration: 0.8, cfgWeight: 0.3, custom: false },
  3: { label: "Your own voice file", exaggeration: 0.5, cfgWeight: 0.5, custom: true },
} as const;
export type VersionId = keyof typeof VERSIONS;

export const configSchema = z.object({
  engine: z.literal("chatterbox"),
  /** "default" or the file name of a voice file in .data/voice/refs. */
  voice: z.string().regex(/^(default|[\w .-]+)$/),
  exaggeration: z.number().min(0.25).max(2),
  cfgWeight: z.number().min(0).max(1),
});
export type VoiceConfig = z.infer<typeof configSchema>;

export const REF_NAME = "voice.wav";
