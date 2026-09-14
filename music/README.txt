this folder is the music player.
================================

Every .txt file in here becomes one tile on the iPod. The folder IS the
playlist list — there is no config to edit, no database, nothing to rebuild
by hand. Add a file, regrow the site, done.


adding a playlist
-----------------

1. On YouTube, open your playlist and copy the address from the address bar.
   It looks like this:

     https://www.youtube.com/playlist?list=PLXWFWrURanY0

2. Make a new text file in this folder. Name it whatever you want the tile
   to say, for example:   late night.txt
3. Paste the link into it. That is genuinely all you need.
4. Re-run the generator (./serve.sh, or `node src/grow.js`).

A link to a single video works too — paste a normal youtube.com/watch link
or a youtu.be link and that one video plays.

The playlist has to be Public or Unlisted. A Private playlist will not play
for anyone but you, and usually not even then.


the longer form
---------------

If you want a cover image or a little caption, use `key: value` lines:

     url: https://www.youtube.com/playlist?list=PLXWFWrURanY0
     cover: covers/late-night.jpg
     note: for the drive home

  url     the link. `youtube:`, `spotify:`, `link:` and `playlist:` all
          work as the key name too — whichever reads better to you.
  cover   a picture, relative to this folder. Make a covers/ folder and
          drop it in. Square images look best; anything else is cropped
          square.
  note    one line under the tile. Optional.

Any line you leave out is fine. No cover? The player invents one — a colour
gradient with the playlist's initials on it, always the same colours for
the same name. That is on purpose: pulling YouTube's own thumbnail would
mean this site quietly phoning YouTube the moment anyone opened it, and the
whole player is built so that nothing leaves this site until you press play.


naming and ordering
-------------------

Tiles appear in filename order. To choose the order, put a number in front:

     01 music.txt
     02 late night.txt
     03 for working.txt

The number and the .txt are stripped off for display, so those show up as
"music", "late night", "for working".

This README is ignored — it never becomes a tile.


spotify still works
-------------------

A file with a Spotify link in it plays in Spotify's embed exactly as before:

     https://open.spotify.com/playlist/37i9dQZF1DX4WYpdgoIcn6

The difference is what the click wheel can do. On YouTube the wheel is a
real wheel: play, pause, next track, previous track, all of it driving
YouTube's own player. Spotify gives embedded players no controls at all, so
there the wheel can only start the playlist and stop it, and `>>` steps to
your next playlist instead of your next song. YouTube is the better ride.


how it behaves
--------------

  - Nothing loads until you press play. A hundred playlists in here cost
    the page nothing.
  - The music does not stop when you walk into a folder. The player sits
    outside the page and the pages change underneath it.
  - MENU goes back to the tile list without stopping anything.
  - `‹‹` in the player's top bar pushes it to the edge of the screen, still
    playing. Click the tab at the edge to bring it back.
  - `music` in the taskbar at the bottom parks it completely. Also still
    playing — it is out of sight, not off.
  - Where you put it is remembered the next time you visit.


why there are no music files here
---------------------------------

Playback runs inside YouTube's own player, so no audio is ever copied into
this repo. That keeps the site small and keeps it honest — the music stays
on YouTube, where it is meant to be, and the plays count for the people who
made it.
