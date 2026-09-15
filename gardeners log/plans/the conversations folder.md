# the conversations folder

A secret folder for the chats you have with Claude — the transcripts, and
the context files a coding session leaves behind. Planned, not built.

## read this part first

The garden is a public website. Everything in the folder that is not
ignored gets pushed to GitHub and served to anyone who asks for it, and
`.gardenignore` only stops the site *drawing* a file — it does not stop
the file being published. A secret folder is a locked door on a page, not
a locked file.

Chat transcripts are the worst case for that. They routinely contain file
paths off your laptop, fragments of anything you pasted in, names, and
sometimes keys. So the default has to be the other way round from every
other folder here:

- **`CONVERSATIONS/` goes in `.gitignore` from the day it is made.** It
  lives on your Mac and never reaches GitHub at all.
- The site renders it only when you are looking at the site *locally*.
  Published, the folder is simply not there.
- If you ever want a particular conversation public, you move that one
  file out into a normal folder deliberately. One at a time, on purpose.

That is the only version of this I am willing to build without asking you
again first.

## what it would be

- a folder `CONVERSATIONS/` with a `secret.txt` naming its key
- the key is a typed word, like `anmoli` opens FAMILY. Nothing clickable,
  so it cannot be stumbled into
- a `scene.txt` giving it its own look: a terminal room. Green or amber on
  black, a cursor blinking somewhere, the ticker running underneath
- each transcript rendered as a conversation rather than as a wall of
  text — your turns one way, the replies the other, timestamps small
- the context files (the CLAUDE.md, the settings, whatever a session
  leaves) shown as a sidebar of the room rather than as loose files

## what has to be worked out

- **where the files come from.** Claude Code keeps its transcripts as
  `.jsonl` under `~/.claude/projects/`. Either you copy the ones you want
  in by hand, or the generator learns to read that directory and write
  them out. The second is nicer and is also the one that could publish
  something you did not mean to publish, so it would be opt-in per file.
- **what a turn looks like on the page.** A raw transcript includes every
  tool call and every file read. Most of that is noise. It probably wants
  to show only what you said and what came back in prose, with the tool
  work folded behind a "what it did" toggle.
- **size.** These files get long. The read-more fold already exists and
  would do the job.

## the order to build it in

1. the folder, the key, and the terminal scene, with one transcript
   copied in by hand
2. the conversation renderer — turns, not text
3. the fold for tool work
4. only then, maybe, reading from `~/.claude/projects` directly
