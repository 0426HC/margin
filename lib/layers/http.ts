import { EngineError } from "@/lib/ai/errors";
import { fail } from "@/lib/projects/api";
import { GateError, StructureError } from "./service";

/** Turn a failure into a response that says what went wrong and how to fix it. */
export function failure(e: unknown): Response {
  if (e instanceof GateError) return fail(e.message, 409);
  if (e instanceof StructureError) return fail(e.message, 400);
  if (e instanceof EngineError) return fail(e.message, e.code === "EngineAborted" ? 499 : 502);
  console.error(e);
  return fail("Something went wrong on Margin's side. Try again, and check the terminal if it keeps happening.", 500);
}
