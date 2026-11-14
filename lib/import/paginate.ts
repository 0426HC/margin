import { wordCount, type Block } from "./types";

/** DOCX, TXT and MD have no pages. Number virtual pages of about 400 words, cut at block boundaries. */
export function paginate(blocks: Omit<Block, "page">[], perPage = 400): { blocks: Block[]; pageCount: number } {
  let page = 1;
  let acc = 0;
  const out = blocks.map((b) => {
    if (acc >= perPage) {
      page++;
      acc = 0;
    }
    acc += wordCount(b.text);
    return { ...b, page } as Block;
  });
  return { blocks: out, pageCount: out.length ? page : 0 };
}
