import Link from "next/link";

/**
 * The course's other rooms, under the layer list: Note to Self, Let's talk!, Lecture notes, the Exam room. Always usable, also while a
 * layer is being written or still opening. Let's talk! opens beside the layer when the workspace can (`onTalk`), else its own page.
 */
export function LayerLinks({ projectId, onTalk }: { projectId: string; onTalk?: () => void }) {
  return (
    <>
      <Link href={`/p/${projectId}/notes`} className="m-left-link">
        <span>Note to Self</span>
      </Link>
      {onTalk ? (
        <button type="button" className="m-left-link" onClick={onTalk}>
          <span>Let&rsquo;s talk!</span>
        </button>
      ) : (
        <Link href={`/p/${projectId}/talk`} className="m-left-link">
          <span>Let&rsquo;s talk!</span>
        </Link>
      )}
      <Link href={`/p/${projectId}/lecture-notes`} className="m-left-link">
        <span>Lecture notes</span>
      </Link>
      <Link href={`/p/${projectId}/exam`} className="m-left-link">
        <span>Exam room</span>
      </Link>
    </>
  );
}
