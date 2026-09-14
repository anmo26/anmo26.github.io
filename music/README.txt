this folder is the music player.
================================

Every .txt (or .md) file in here becomes one album tile on the iPod in the
music window. The folder IS the playlist list — there is no config to edit,
no database, nothing to rebuild by hand. Add a file, regrow the site, done.


making a playlist
-----------------

1. In Spotify, right-click a playlist (or album, or single track)
     -> Share -> Copy link to playlist
2. Make a new text file in this folder. Name it whatever you want the tile
   to say, for example:   late night drives.txt
3. Paste the link into it. That is genuinely all you need:

     https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6

4. Re-run the generator (./serve.sh, or `node src/grow.js`).


the longer form
---------------

If you want a cover image or a little caption, use `key: value` lines:

     spotify: https://open.spotify.com/playlist/37i9dQZF1DX0hvSv6cNiG3
     cover: covers/dream-pop.jpg
     note: for the train ride home

  spotify   the link. A plain URL, a `spotify:playlist:ID` URI, or even just
            the bare ID all work. Albums and single tracks work too --
            paste an album or track link and it plays as an album or track.
  cover     a picture, relative to this folder. Drop the file in covers/.
            Square images look best; anything else gets cropped square.
  note      one line under the tile. Optional.

Any line you leave out is fine. No cover? The player invents one -- a
colour gradient with the playlist's initials on it, always the same colours
for the same name. No note? The tile just shows its name.


naming and ordering
-------------------

Tiles appear in filename order. To choose the order, put a number in front:

     01 late night drives.txt
     02 deep focus.txt
     03 peaceful piano.txt

The number and the .txt are stripped off for display, so those show up as
"late night drives", "deep focus", "peaceful piano".

This README is ignored -- it never becomes a tile.


cover images
------------

Put them in covers/. Two ways to attach one:

  - name it after the playlist and it gets picked up automatically:
        "01 late night drives.txt"  ->  covers/late-night-drives.jpg
  - or point at it explicitly with a `cover:` line.

.jpg, .png, .webp and .gif all work. Keep them small -- 300x300 is plenty,
and this whole site has to fit in a GitHub Pages repo.


why there are no music files here
---------------------------------

Playback runs through Spotify's own embedded player, so no audio is ever
copied into this repo. That keeps the site small and keeps it legal --
the music stays on Spotify, where the artists get paid for it.

What visitors hear depends on them: anyone signed in to Spotify in the same
browser gets the full tracks, and everyone else gets Spotify's 30-second
previews. Nothing loads until somebody actually presses play, so having a
hundred playlists in here costs the page nothing.
