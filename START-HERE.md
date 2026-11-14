# Margin: start here

Margin is built in 8 phases with Claude Code. It takes a few sessions, not one sitting.

## 1. Make the project folder (Terminal, once)

```bash
mkdir -p ~/Projects/margin && cd ~/Projects/margin
git init
```

Put **CLAUDE.md** and **PROMPTS.md** (from this kit) inside `~/Projects/margin`.

## 2. Start Claude Code in that folder

```bash
cd ~/Projects/margin
claude
```

Claude Code reads `CLAUDE.md` automatically. That file is the spec, the design rules and the coding rules.

## 3. Paste the phases from PROMPTS.md, one at a time

Phase 0 → check → Phase 1 → pick a design → Phase 2 … → Phase 8.

After each phase:
- open the app it tells you to (usually http://localhost:3000)
- say plainly what feels off ("the cards look flat", "the flip is too slow")
- only move on when you like it

## Good to know

- **It's free to run.** The AI inside Margin uses your own Claude plan through the official Claude Code command line on your laptop. That's why Margin only runs on your Mac. Long study sessions count toward your plan's usage limits like normal Claude use.
- **Don't** paste API keys or login tokens anywhere. Margin never needs them.
- **Your course files stay on your laptop** and never go into GitHub. The repo only has the code and a public-domain demo course.
- If Claude Code proposes something that conflicts with CLAUDE.md, ask it to re-read CLAUDE.md.
