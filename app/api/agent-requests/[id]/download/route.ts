import { getDocument } from "@/lib/agents/requests";
import { safeFileName, toDocx, toPdf } from "@/lib/agents/export";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/projects/api";

/** Download a finished document as a PDF or a Word file. Built on this computer. */
export async function GET(req: Request, ctx: RouteContext<"/api/agent-requests/[id]/download">) {
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format");
  const doc = getDocument(getDb(), id);
  if (!doc || doc.status !== "done") return fail("That document is not ready.", 404);
  if (format !== "pdf" && format !== "docx") return fail("Choose pdf or docx.");
  const bytes = format === "pdf" ? toPdf(doc) : await toDocx(doc);
  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safeFileName(doc.title)}.${format}"`,
    },
  });
}
