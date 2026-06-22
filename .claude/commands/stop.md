---
allowed-tools: Bash(git add:*), Bash(git status:*), Bash(git commit:*), Bash(git push:*)
description: End-of-session handoff, commit, and push
---
Add a new dated session entry at the top of the area below the first `---`, summarising what was done this session. Never delete or overwrite any section marked URGENT or IN PROGRESS, or any other unfinished work; carry it forward unchanged. Then update the "Next step to resume from" to reflect the true current priority. Then stage all changes, commit as "Session <today's date>: <short summary you write>", and push to origin main. Finally run git status and confirm the working tree is clean and main is level with origin, not ahead, and report the result.
