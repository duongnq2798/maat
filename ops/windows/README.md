# Start Maat on Windows

`start-maat.ps1` opens the two terminals that run Maat on the owner's Windows PC, each with the command its runbook
gives:

| Title | Folder | Command | Runbook |
| --- | --- | --- | --- |
| `MAAT AGENT` | `<ROOT>\agent` | `npm run agent:loop` | [Start the restart loop](../../web/content/docs/guides/run-the-agent-on-windows.mdx), live mode |
| `MAAT JOURNAL` | `<ROOT>` | `node ops\journal\publish.mjs` | [Start it (Windows)](../journal/README.md#start-it-windows) |

`<ROOT>` is the checkout the agent runs from, the folder that holds `agent\` and `ops\`. The agent starts in the mode
that `agent\.env` sets, and both programs read `agent\.env` themselves: the script reads no `.env` file and passes no
setting or secret.

With Windows Terminal (`wt.exe`) it opens one new window with two tabs, titled `MAAT AGENT` and `MAAT JOURNAL`.
Without it, or with `-NoWindowsTerminal`, it opens two Windows PowerShell windows with those titles. Each shell stays
open after its command ends, so you can read its last lines, and Ctrl+C in a tab stops that tab's command as it does
when you type the command yourself. The script exits as soon as it has opened them; the tabs and windows do not
depend on it, so closing the window it ran in stops nothing.

## Run it

From any PowerShell window:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\start-maat.ps1 -WhatIf
powershell -NoProfile -ExecutionPolicy Bypass -File ops\windows\start-maat.ps1
```

The first line prints what it would open and opens nothing. The second opens the terminals. `-ExecutionPolicy Bypass`
applies to that one `powershell` process, so the script runs even where the PC's policy blocks scripts; it changes no
setting.

| Option | Default | Meaning |
| --- | --- | --- |
| `-Root <dir>` | the checkout that holds the script | The checkout to run from. Give it when the agent runs from another checkout than the one the script is in, such as a checkout of a release tag that predates the script |
| `-NoWindowsTerminal` | off | Open two Windows PowerShell windows even when `wt.exe` is installed |
| `-WhatIf` | off | Print what it would open, and open nothing |

It opens nothing, prints a `start-maat:` line and exits with code 1 when:

- `<ROOT>` has no `agent\package.json` or no `ops\journal\publish.mjs`;
- `<ROOT>\agent\data\agent.lock` names the pid of a running `node` process: an agent already runs on the default data
  folder, and a second one would stop at its start with `another agent (pid <PID>) is running`. A lock whose pid has
  gone, or now belongs to another program, does not stop it: the agent clears such a lock at its start. The check
  looks at `agent\data` only, because the script reads no `MAAT_DATA_DIR`.

## Start it at logon

A scheduled task can run the script each time you sign in to Windows, so the agent and the publisher come back after
a restart of the PC without you opening them. It starts the agent in the mode `agent\.env` sets, in live mode on
Maat's PC, so register it only on the PC that should run the live agent.

Run this in PowerShell, with your own paths in place of the two below: the script's checkout first, then the
checkout the agent runs from. As written, the paths may not contain spaces:

```powershell
schtasks /Create /TN "Maat start" /SC ONLOGON /RU "$env:USERDOMAIN\$env:USERNAME" /IT /RL LIMITED /DELAY 0001:00 /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File E:\maat\ops\windows\start-maat.ps1 -Root E:\maat-run"
```

- `/SC ONLOGON` runs it at sign-in; `/DELAY 0001:00` waits one minute first, so the network and Git Credential
  Manager are up before the first round and the first push.
- `/RU` with `/IT` runs it as you, on your desktop, and only while you are signed in, so the terminals open where you
  can see them and Ctrl+C them. Nothing runs after a restart until you sign in.
- `/RL LIMITED`, the default, runs it without administrator rights. If `schtasks` answers `ERROR: Access is denied.`,
  run the same line in a PowerShell window opened as administrator: `/RU` and `/RL LIMITED` still make the task run as
  you, without administrator rights.

These commands manage the task:

| Command | What it does |
| --- | --- |
| `schtasks /Query /TN "Maat start" /V /FO LIST` | Shows the task, its command and when it last ran |
| `schtasks /Run /TN "Maat start"` | Runs it now, as a sign-in would: it opens the terminals and starts the agent |
| `schtasks /Change /TN "Maat start" /DISABLE` | Keeps it from running at the next sign-in, for example while you move the agent's checkout to a new release; `/ENABLE` turns it back on |
| `schtasks /Delete /TN "Maat start" /F` | Removes it |

The task does not keep the PC awake or on time: the power, update and clock steps of
[the Windows runbook](../../web/content/docs/guides/run-the-agent-on-windows.mdx) still apply.

## What was run

On Windows 10 with Windows PowerShell 5.1: `-WhatIf` with and without `-NoWindowsTerminal`, and with a stand-in
`wt.exe` on the path, which shows the Windows Terminal command line it would run; a `-Root` that is not a checkout and
one that does not exist, which exit with code 1; and the lock check, with a lock that names a running `node`, one that
names another program and an empty one. Without `-WhatIf`, it opened its two PowerShell windows, titled `MAAT AGENT`
and `MAAT JOURNAL`, for a stand-in checkout whose path holds a space and an apostrophe and whose two commands only
wrote a file, each in its folder. It has not opened the real agent or publisher, and the Windows Terminal path has not
run, because the PC it was written on has no `wt.exe`. The `schtasks` lines were not run; they follow
`schtasks /Create /?`.
