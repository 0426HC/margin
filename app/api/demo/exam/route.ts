import { getDb } from "@/lib/db/client";
import { loadDemoExam } from "@/lib/demo/exam";
import { fail } from "@/lib/projects/api";

/** "Or try the demo exam": open the demo course with its fictional final-exam sheet, so the whole exam room can be tried without a real course. */
export async function POST() {
  try {
    return Response.json(await loadDemoExam(getDb()));
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Margin couldn't open the demo exam. Try again.", 500);
  }
}
