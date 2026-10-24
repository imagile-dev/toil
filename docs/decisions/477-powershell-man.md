# Powershell Man: hidden arcade in Toil UI and on the site

Requested directly by the maintainer, without opening a GitHub issue.
These design notes use pull request #477 as their numeric reference; no separate issue was created.

## Browser proof

Verified with headless Chrome on Windows, Node 24.14: the three story panels, next/back/skip/start, two hits and enemy death, charged aura, pause/resume, and site dialog close/reopen. Desktop 1440×900 and mobile 375×812 captures are retained below. The final boss victory and physical gamepad hardware were not verified.

![Comic opening at 1440px](https://raw.githubusercontent.com/imagile-dev/toil/screenshots/pr-477/story-desktop.png)
![Comic opening at 375px](https://raw.githubusercontent.com/imagile-dev/toil/screenshots/pr-477/story-mobile.png)

The hidden game uses Canvas 2D and a fixed physics timestep. A 2D platformer needs no Three.js dependency, scene graph, or WebGL initialization. React owns the menus; the game loop owns movement and collisions. The game is loaded on demand, so regular UI visits do not download its title art or run its animation loop.

Type `powershell` outside a text field to discover it in Toil UI or the public site. `#/powershell-man` opens the UI game directly for playtests. The site embeds the same static preview build, with no tracker access or server dependency. Closing the public-site dialog unloads the frame. The normal Pages deployment publishes the site entry after this change merges; the game never compiles or distributes software.

The first playable level is a compact keyboard prototype, not a promised five-minute campaign. Controls and checkpoints are explained in the game. Pause freezes gameplay; returning to work restores the previous UI route.

## Art

`ui/src/game/title.webp` was generated with the built-in imagegen tool. Runtime sprites and collisions are drawn deterministically in Canvas. The generated image establishes the white terminal helmet, cyan visor, pink cable spool, amber trim, and industrial server-room palette.

Final generation prompt:

> Use case: stylized-concept. Create one polished wide landscape pixel-art title illustration for an original 16-bit side-scrolling game named Powershell Man. No text or letters. Industrial server-factory terminal world navy blue, teal cyan, amber warning lights, hot pink tangled noodle projectiles. Left foreground original small heroic robot with terminal visor, cable-spool backpack and script cannon shooting spaghetti cables; right background a calm human DevSecOps architect with rolled sleeves and clipboard protected by orderly translucent geometric security shields. Side-on game scenery, chunky crisp pixel clusters, restrained outlines, readable silhouettes, playful satirical mood, dramatic composition. Original character designs, no existing franchise characters. This will be a title-screen background with UI text overlaid, leave center upper area dark and uncluttered.

The user's game palette applies within the hidden game; normal site branding remains in its existing palette.

## Comic opening and combat feedback

The opening is a manually advanced, skippable three-panel comic. The maintainer's revised premise is that Powershell Man wants to compile PowerShell and other Microsoft software internally, then have Packaging distribute those binaries in place of Microsoft's releases. The architect asks who owns signing, security updates, provenance, and support. No real build or distribution operation is performed by this game.

Enemy damage records simulation time and direction, driving a short flash, recoil and impact sprite; defeated foes fade upward into debris. Charging layers a radial glow, two translucent blurred atlas sprites, and orbiting motes. All effects freeze with the simulation clock.

`ui/src/game/story.webp` was generated through built-in imagegen using the sprite atlas as a character-design reference. Its prompt was:

> Use case: illustration-story. Reference image is CHARACTER DESIGN reference only, not edit target. Create an ORIGINAL SNES 16-bit arcade comic opening panorama: exactly THREE equally wide vertical panels side by side across one very wide landscape illustration, each panel self-contained, no gutters, no text, no speech bubbles, no lettering. These three panels will be cropped and shown one at a time in a game intro. Preserve reference hero white terminal helmet cyan >_ face, cobalt armor, amber trims, pink cable-spool backpack and cannon; preserve architect human brownhair glasses rolled lightshirt navytrousers clipboard. Detailed crisp 16-bit pixel-art shading, rich industrial navy cyan pink amber palette. Panel LEFT: Friday evening industrial server-city, calm architect at workstation studying neat sensible security diagrams on luminous screens, city looming, dramatic arcade intro establishing shot. Panel CENTER: overconfident hero bursts through a server corridor firing enormous tangled hot-pink spaghetti cables, broken pipelines and flying paper, cocky triumphant pose, comically chaotic mess, no gore. Panel RIGHT: architect in composed defensive stance raising clipboard projecting beautiful cyan geometric protective shield against tangled pink scripts, concerned rather than evil, hero seen small at edge. Cinematic dynamic compositions, expressive characters at middle/upper portions; leave lower quarter each panel dark for external narrative captions. Distinct readable three-scene triptych, consistent original designs, no existing game franchise characters.

## Sprite atlas details

`ui/src/game/sprites.webp` is a transparent atlas generated with built-in imagegen. Eight run frames play at 75 ms per frame; idle, jump, recoil, enemy movement and architect shield poses share the same atlas. Alpha bounds are measured once on load, with a shared hero scale so differing pose heights do not resize the character. Loading gates the start button. Animation uses simulation time, including firing, so pausing freezes the sprites too. No rendering dependency was added.

Generation prompt:

> Use case: stylized-concept. Production sprite sheet for original SNES 16-bit side-scroller Powershell Man. TRANSPARENT BACKGROUND. Strict uniform grid EXACTLY 8 columns and 4 rows, 32 equal cells, no gutters, no text, no labels, no borders. Every sprite centered horizontally in its cell, feet on consistent baseline near cell bottom, substantial transparent padding, no part crosses cell boundaries. Crisp detailed 16-bit pixel art, 4 shade ramps, clean dark pixel outline, expressive original silhouettes, NO giant square primitive bodies, NO blurry painterly look. All characters side-on facing RIGHT. ROW1 eight consecutive smooth RUN CYCLE frames of SAME original hero: compact agile robot, white rounded terminal helmet, dark face screen cyan >_ visor, cobalt segmented armor boots, amber trim, pink cable-spool backpack, right arm script cannon pointing forward; legs distinct contact/recoil/passing/high-point poses, torso stable, backpack cables follow-through. ROW2 SAME hero 8 frames: columns1-2 idle breathing, columns3-5 jump takeoff/apex/fall, columns6-8 firing anticipation/recoil/recovery. ROW3 enemies: columns1-2 squat charcoal crawler robot with orange optics walking; columns3-4 wiry hopping charcoal robot with pink optics; columns5-6 floating purple ghost-terminal robot with cable tendrils; columns7-8 bright pink spaghetti muzzle blast effects. ROW4 eight frames SAME human DevSecOps architect facing LEFT toward hero: brown hair, glasses, light shirt sleeves rolled up, navy trousers, clipboard in hand. Frames1-2 calm idle,3-4 step forward,5-6 raise clipboard and project cyan validation shield,7-8 recoil/hit. Human face readable, NOT robot. Maintain exact per-character proportions and palette across frames. All 32 frames complete, separated, aligned in identical cell size. Uniform flat sprite sheet orthographic view, absolutely no scenery or ground shadows.

## Art format

The generated art ships as WebP, not the PNG masters (review on #477): about 1.4 MB in place of 7.2 MB in the toil-ui tarball. Title and comic are lossy at quality 82; the sprite atlas is lossy at quality 90 with `alphaQuality: 100`, so its alpha channel, which the frame bounds are measured from, stays exact. PR screenshots live on the `screenshots` branch under `pr-477/`.
