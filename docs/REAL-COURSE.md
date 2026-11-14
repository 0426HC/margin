# Running Margin on a real course

This uses the real Claude Code engine on your Claude plan. Nothing here needs an API key.

## Before you start
- `claude` is installed and logged in. Check with: `echo "say ready" | claude -p`
- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.23.4/bin:$PATH"`
- Do **not** set `MARGIN_ENGINE=fake` (that is the offline test engine).

## Run it
```bash
cd ~/Projects/margin
npm run dev            # then open http://localhost:3000
```
Your projects are stored in `./.data` (never committed).

## The flow, and what the AI does at each step
1. **New project.** Drop in the course folder. Files are read and cut into sections by code. No AI, takes seconds.
2. **Review units.** Rename, merge or move units if the folder names confused it, then **Plan the layers**.
3. **Suggest the layers.** One to three minutes. Sonnet proposes where Part A ends and the layers of each Part, and the code checks that every passage is in exactly one layer. If the AI's answer is invalid twice, Margin falls back to one layer per unit and the plan page still works.
4. **Look hard at the plan.** This is the step to judge. Rename layers, rewrite a big question, merge, split, or move a layer across the Part boundary ("Move to Part B"). Nothing is written until you approve each Part.
5. **Approve Part A and Part B**, then **Open the course**.
6. **Open any layer.** The first time takes about a minute: Opus 5.5 (medium effort) picks the Source passages, then writes the Explained tab from them. After that it opens at once. Open Source to check the explanation against the exact text.

## What to look at
- Are the layers topics, with a real "big question" each, building on each other?
- Does Explained explain every name and term the first time it appears, with bullets and tables, and no story?
- Does every claim have a page in the margin, and does that page in Source really say it?
- Does Source keep the original's paragraphs, headings and lists?

## If something goes wrong
- The page shows the message and a **Try again** button. The terminal running `npm run dev` has the details.
- "Usage limit reached": wait for your plan to reset. To spend less, run with `MARGIN_MODEL_EXPLAIN=sonnet npm run dev` (Explained and Source on Sonnet) or `MARGIN_MODEL_REVIEW=sonnet` for the reviews that arrive in Phase 5.
- To start the plan again before approving: **Suggest the layers again** on the plan page.
- To remove a test project: stop the app and delete `./.data` (this removes all your projects).
