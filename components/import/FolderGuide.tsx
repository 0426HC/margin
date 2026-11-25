/**
 * "How to set up your folder", shown on the New project screen, folded until opened. Claude reads any folder the way a person would, so
 * this is advice, not a rule: a clear folder just means fewer files marked "check this".
 */
export function FolderGuide() {
  return (
    <details className="st-guide">
      <summary>How to set up your folder</summary>
      <p>Make one folder for the course and put everything in it, organised however you like. One example:</p>
      <pre className="st-guide-tree" aria-label="An example course folder">{`COURSE/
  Syllabus.pdf
  Week 01/            (or Readings/ and Lectures/, or no folders)
    readings and slides
  Midterm/            (exam instructions, review guides)
  My notes/           (your own notes, if you have any)`}</pre>
      <p>Claude reads it the way you would:</p>
      <ul>
        <li>
          <b>The syllabus first.</b> Its schedule says what happens each week, however it&rsquo;s written: Week 3, Class Four, Lecture 7, a date or a table. Its reading list is matched to your files by author, title and pages.
        </li>
        <li>
          <b>Then the folder and file names.</b> Week folders, Readings and Lectures folders, or one flat folder all work.
        </li>
        <li>
          <b>Then each file.</b> Its length, headings and opening words tell a long reading from slides or the professor&rsquo;s lecture notes.
        </li>
      </ul>
      <p>Every file gets a week, a type and one line saying why. Anything Claude isn&rsquo;t sure of is marked &ldquo;check this&rdquo; for you to change. Readings the syllabus lists but the folder doesn&rsquo;t have are listed too.</p>
    </details>
  );
}
