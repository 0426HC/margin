import { EngineError } from "@/lib/ai/errors";
import { fail } from "@/lib/projects/api";
import { GateError, StructureError } from "./service";

/** What went wrong and how to fix it, with the HTTP status it maps to. */
export function failureBody(e: unknown): { error: string; code: string; status: number } {
  if (e instanceof GateError) return { error: e.message, code: "Gate", status: 409 };
  if (e instanceof StructureError) return { error: e.message, code: "Structure", status: 400 };
  if (e instanceof EngineError) return { error: e.message, code: e.code, status: e.code === "EngineAborted" ? 499 : 502 };
  console.error(e);
  return { error: "Something went wrong on Margin's side. Try again, and check the terminal if it keeps happening.", code: "Internal", status: 500 };
}

/** Turn a failure into a response that says what went wrong and how to fix it. */
export function failure(e: unknown): Response {
  const { error, status } = failureBody(e);
  return fail(error, status);
}
