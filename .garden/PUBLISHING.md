# Publishing this garden

How to put this folder on the internet at a real address you can paste into an
Instagram bio. Written for someone who has never used GitHub or git.

Total time: about 20 minutes, most of it waiting.

Read the whole thing once before you start. Nothing here is irreversible except
the moment you push, and that step is clearly marked.

---

## 0. Before you start: check what would go public

Open Terminal. Run these two lines:

```
cd ~/Desktop/garden
./preflight.sh --list
```

That prints every file that would become public, their total size, and any
problems. It changes nothing. Read the list. If there is anything in it you do
not want strangers to read, deal with it now — see "Privacy" at the bottom.

**Important, and easy to miss: there is already a remote configured on this
repo**, pointing at `https://github.com/anmo26/anmo26.github.io.git`. Nothing
has ever been pushed to it, so nothing is public yet. If `anmo26` is the GitHub
username you intend to use, good. If not, see "The remote is already set to
something" under "When it goes wrong".

---

## 1. Make a GitHub account

1. Go to <https://github.com/signup>.
2. Enter your email (`lianmo326@gmail.com`), pick a password, pick a username.
3. Verify the email GitHub sends you.
4. Choose the free plan. You do not need anything paid.

**Your username matters a lot.** It becomes part of your website address, so it
is worth thirty seconds of thought. Short, lowercase, no underscores. Whatever
you pick, your site will be at `https://USERNAME.github.io`.

Write your username down. Every step below uses it.

---

## 2. Make the repository

A "repository" (repo) is just a folder that GitHub stores for you.

Go to <https://github.com/new> and fill it in like this:

**Repository name: `USERNAME.github.io`** — exactly that, with your own
username, all lowercase.

This exact name is a special case in GitHub's rules. A repo named
`USERNAME.github.io` is served at the clean root address:

```
https://username.github.io
```

Any other name gets served from a subfolder:

```
repo named "garden"  ->  https://username.github.io/garden/
```

Both work. The first one is the one you want in a bio.

**Owner:** your own account.

**Public** — tick it. Not private. GitHub Pages on a private repo requires a
paid plan, and you do not need to pay for this. Public means the files are
readable by anyone, which is the point of a website, but read the Privacy
section before you push.

**Leave every initialization box UNTICKED:**

- do NOT tick "Add a README file"
- do NOT add a .gitignore
- do NOT choose a license

This folder already has its own history and its own README. If GitHub puts a
starter file in the repo first, the two histories collide and your push gets
rejected. This is the single most common way this goes wrong. The new repo must
be completely empty.

Click **Create repository**. You will land on a page of setup instructions.
Ignore all of them. The script handles that part.

---

## 3. Authentication: the password that is not a password

When you push, git asks for a username and a password. Your GitHub password
will not work. GitHub stopped accepting it for git in 2021. What it actually
wants is a **Personal Access Token** — a long generated string you paste in
where the password goes.

Make one:

1. Go to <https://github.com/settings/tokens>
   (or: click your avatar, top right → **Settings** → scroll to the very bottom
   of the left sidebar → **Developer settings** → **Personal access tokens** →
   **Tokens (classic)**).
2. Click **Generate new token** → **Generate new token (classic)**.
3. **Note:** type something you will recognize, like `garden site`.
4. **Expiration:** 90 days is fine. Choose "No expiration" only if you accept
   that a leaked token stays valid forever.
5. **Scopes:** tick exactly one box — **`repo`** (the top-level one, which
   selects its children automatically). Nothing else. Do not tick `delete_repo`
   or `admin:*`.
6. Click **Generate token** at the bottom.
7. The token appears once, starting with `ghp_`. Copy it now. When you leave
   the page it is gone forever and you have to make a new one.

Paste it somewhere safe for the next few minutes — your Mac's Notes app, or
your password manager.

### The token is yours alone

Treat it exactly like a password, because that is what it is. Anyone who has it
can read and rewrite your repositories.

- Paste it into **one** place: the git prompt in your own Terminal window.
- Never put it in a file in this folder. This folder becomes a public website.
- Never paste it into a chat, an email, a form, or a web page.
- **Never give it to an AI assistant, including this one.** No legitimate tool
  or helper will ever need you to hand over the token itself. If anything asks
  you for it — a person, a website, a chatbot, a script — the answer is no.
- If you think it leaked: go to <https://github.com/settings/tokens>, click
  **Delete** next to it, and make a new one. That is the whole remedy.

The first time you use it, macOS saves it in your Keychain, so you only type it
once.

---

## 4. Push

Now the actual publish. Run a dry run first — it prints what would happen and
touches nothing:

```
cd ~/Desktop/garden
./publish-setup.sh USERNAME --dry-run
```

Read the output. Check the remote URL and the site address are what you expect.
Then do it for real:

```
./publish-setup.sh USERNAME
```

Git will ask for:

- **Username:** your GitHub username.
- **Password:** paste the `ghp_...` token. Nothing appears on screen as you
  paste — no dots, no stars. That is normal. Press Return.

If it fails, jump to "When it goes wrong". The script does not turn publishing
on unless the push actually succeeded, so a failure leaves everything exactly
as it was.

**This is the irreversible step.** Once pushed, assume the files are public
permanently — search engines, scrapers, and archives copy things quickly, and
deleting them later does not unring the bell.

---

## 5. Turn on Pages

The code is on GitHub now, but the website is not switched on yet. That is a
separate setting.

1. Go to `https://github.com/USERNAME/USERNAME.github.io/settings/pages`
   (or: your repo → **Settings** tab → **Pages** in the left sidebar).
2. Under **Source**, choose **Deploy from a branch**.
3. Two dropdowns appear. Set the first to **`main`** and the second to
   **`/ (root)`**.
4. Click **Save**.

Now wait. The first build takes about a minute, sometimes two or three. Reload
the Pages settings page until a green banner appears with your live address.

Open `https://username.github.io`. That is your site. That is the link for your
bio.

---

## 6. When it goes wrong

### "Updates were rejected because the remote contains work that you do not have"

The repo on GitHub is not empty. You ticked "Add a README file", or the repo
already had something in it.

Simplest fix: delete the repo and make it again, empty.

1. `https://github.com/USERNAME/USERNAME.github.io/settings`
2. Scroll to the bottom, red "Danger Zone" box → **Delete this repository**.
3. Type the repo name to confirm.
4. Make it again per step 2, with every init box unticked.
5. Run `./publish-setup.sh USERNAME` again.

Deleting an empty repo you just made costs you nothing.

### "Repository not found" / 404 when pushing

GitHub cannot find `USERNAME/USERNAME.github.io`. Usually one of:

- The username is misspelled. Check the URL of your own profile page.
- You never actually clicked "Create repository".
- The repo name has a typo — it must be `USERNAME.github.io`, not
  `username.github.com` and not `USERNAME.github.io.git`.

Open `https://github.com/USERNAME/USERNAME.github.io` in a browser. If that page
404s for you while logged in, the repo does not exist.

### "Authentication failed" / it keeps asking for a password

You gave it your account password instead of a token, or the token is expired
or lacks the `repo` scope. Make a new token per step 3.

If macOS saved a bad one, clear it first:

```
printf 'protocol=https\nhost=github.com\n\n' | git credential-osxkeychain erase
```

Then push again and paste the good token.

### The remote is already set to something

This repo already has a remote pointing at `anmo26/anmo26.github.io`. If that is
your username, just run `./publish-setup.sh anmo26` and it proceeds normally.

If it is not — if that was set by mistake or belongs to an account you are not
going to use — the script will stop and refuse rather than quietly retarget it.
To change it on purpose:

```
./publish-setup.sh YOUR-REAL-USERNAME --replace-remote
```

To just look at what is set:

```
git remote -v
```

### 404 at `https://username.github.io`

Almost always: Pages was never enabled. Redo step 5. The push putting files on
GitHub and Pages serving them are two different switches, and the second one is
easy to forget.

Other causes:

- Less than a minute has passed. Wait, reload.
- There is no `index.html` at the top level. Run `node src/grow.js`, commit,
  push.
- The repo is private. Pages needs a paid plan for private repos. Settings →
  scroll down → Change visibility → public.

### The site is old / my change is not showing

Your browser cached the page. Hard reload: **Cmd + Shift + R**. Or open the
address in a private window, which never uses the cache.

If a private window also shows the old version, the change genuinely has not
deployed. Check the **Actions** tab of your repo for a failed build, and check
that the change was actually committed (`./preflight.sh`).

Allow a minute or two after every push. Pages is not instant.

---

## 7. What `"publish": true` means from now on

A successful `publish-setup.sh` flips `"publish"` to `true` in
`garden.config.json`. That changes how the watcher behaves.

When you run `./live.sh`, the watcher sits in the background and monitors this
folder. With publishing on, every time you add, edit, rename, or delete a file
here it will:

1. regenerate the site pages,
2. run `git add -A` — staging **everything**, including files you did not think
   about,
3. commit,
4. push to GitHub.

Your site updates about a minute later. That is the convenience. It is also the
risk:

> **Anything you drop into this folder becomes a public web page within about a
> minute, with no confirmation step.**

Drag a screenshot into `~/Desktop/garden` and it is on the internet before you
have finished deciding whether you meant to.

### The `.gardenignore` trap

`.gardenignore` controls what gets **rendered** on the site. It does not control
what gets **committed**.

A file listed in `.gardenignore` will not appear on your gallery page — and will
still be sitting in the public repo at
`https://github.com/USERNAME/USERNAME.github.io`, readable by anyone who clicks
through the file list. Not shown is not the same as not there.

To actually keep a file off GitHub there is one mechanism: **`.gitignore`**.
Add the filename or pattern there, and git will never commit it.

```
# .gitignore
notes/private-*.md
*.psd
receipts/
```

Better still, keep genuinely private things outside this folder entirely. A
folder that auto-publishes is a bad place to store anything you would mind a
stranger reading.

Note that adding something to `.gitignore` *after* it has been pushed does not
remove it — it is in the repo history and stays visible. The only fix at that
point is rewriting history, which is fiddly. Check before, not after.

### Turning it off

To stop auto-publishing, either quit the watcher, or run it with
`node src/watch.js --no-publish`, or open `garden.config.json` and set
`"publish": false`. Any of those stops pushes; the site stays up as it is.

---

## Quick reference

```
./preflight.sh                 # what would go public. read-only.
./preflight.sh --list          # ...with every filename listed
./publish-setup.sh NAME --dry-run   # rehearse. changes nothing.
./publish-setup.sh NAME        # connect + push (asks for your token)
./live.sh                      # watch the folder and keep the site in sync
git remote -v                  # what GitHub repo is this pointing at
git status                     # what is not committed yet
```
