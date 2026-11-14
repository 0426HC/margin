/** An error whose message is safe and useful to show on a file's row: what went wrong and what to do. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}
