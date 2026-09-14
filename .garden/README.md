# garden

A file gallery, in the spirit of [kevin.garden](https://kevin.garden) /
[file.gallery](https://file.gallery). Point it at a folder and it writes an
`index.html` into that folder and every folder beneath it. The site *is* the
folder — same names, same nesting, and, where you've arranged the icons in
Finder, the same arrangement.

No dependencies. No build step. Just Node.

## Run it

```bash
node src/grow.js                 # grow this folder
node src/grow.js ~/Pictures/trip # grow some other folder
./serve.sh                       # http://localhost:8000
```

Flags:

| flag | meaning |
|---|---|
| `--depth N` | how many levels to descend (default `3`) |
| `--dry-run` | list what would be written, write nothing |
| `--title NAME` | the name in the `<title>` (default: folder name) |

**Be careful what directory you point it at** — it writes an `index.html` into
every folder it visits. Use `--dry-run` first when in doubt.

## The scattered layout

This is the whole trick, so it's worth explaining.

macOS keeps a hidden `.DS_Store` file in every folder you've opened in Finder.
Among other things it records the **x/y position of each icon** in the icon
view. `src/dsstore.js` reads that file and `grow.js` turns those coordinates
into `top:`/`left:` on the page.

So you don't lay the page out in CSS. You lay it out by dragging icons around
a Finder window.

To make a folder freeform:

1. Open it in Finder.
2. **View → as Icons** (`⌘1`).
3. **View → Sort By → None**, and make sure *Keep Arranged By* is off.
   If icons snap back into a grid, the positions won't be yours.
4. Drag things where you want them.
5. Close the window (Finder flushes `.DS_Store` on close), then re-run `grow.js`.

A folder with no saved positions falls back to a plain left-to-right flow,
which is also what you get on a non-Mac or a fresh clone.

Note that `.DS_Store` coordinates are icon *centres* in Finder's coordinate
space, used here as the top-left of a box that can be much wider than an icon.
Spread things out more than looks necessary in Finder.

## What gets rendered

| kind | shown as |
|---|---|
| folder | link + item count |
| image (jpg, png, gif, webp, avif, svg, bmp) | inline, capped at 24em |
| video (mp4, mov, webm, m4v) | `<video controls>` |
| audio (mp3, wav, m4a, flac, …) | `<audio controls>` |
| markdown | rendered inline |
| text and source files | inline `<pre>` |
| no extension (`LICENSE`, `CNAME`) | inline `<pre>` |
| anything else | link + file size |

Text files over 2 kB become a plain link instead of being inlined; change
`INLINE_TEXT_LIMIT` in `src/grow.js` if you want more.

HEIC and TIFF are deliberately *not* inlined — browsers won't reliably display
them. Convert first:

```bash
sips -s format jpeg photo.heic --out photo.jpg
```

## Hiding things

`.gardenignore` is a list of globs, one per line; a trailing `/` means
directories only. `.git`, `node_modules`, `.DS_Store` and the generated
`index.html` files are always ignored.

## Files

```
src/grow.js       the generator — walk, classify, lay out, write
src/dsstore.js    minimal .DS_Store (Bud1 B-tree) reader, for Iloc records
src/imagesize.js  pixel dimensions from file headers, sips as fallback
src/markdown.js   small markdown renderer
serve.sh          python3 -m http.server on :8000
live.sh          watch the folder, rebuild + publish on every change
.gardenignore     what not to publish
```

## Putting it online

Everything is static, so any host works. The folder is the site:

```bash
# GitHub Pages
git init && git add -A && git commit -m "grow"
# then push and turn on Pages for the root of the default branch

# or rsync to any web server
rsync -av --delete ./ user@host:/var/www/garden/
```

One caution before you do: this publishes *every* file it walks. Read through
what `node src/grow.js --dry-run` lists, and put anything private in
`.gardenignore` first.

---

Layout and templates follow kevin.garden by Kevin N. Chen, CC BY-NC 4.0.
The generator here is a separate implementation.
