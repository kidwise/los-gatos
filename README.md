# Los Gatos: A Wandering

A relaxing exploration game set on the real map of Los Gatos, California. You are a cat, out for a day's wander from the downtown plaza to Vasona Lake.

**Play it:** https://kidwise.github.io/los-gatos

It runs in a browser on a phone or a computer, with nothing to install.

## Vision

Los Gatos is a polished small town tucked beneath the Santa Cruz Mountains, and the name means "the cats". This game is a love letter to walking it: the shops and cafés downtown, Main Street and its bridge, the Creek Trail, Oak Meadow and Vasona Lake.

- **Exploring is the point.** There are no timers, scores or fail states, and nothing is locked. Every place can be reached from the start.
- **The real town, with an artistic twist.** Streets, buildings, trails, the lake and the railway come from real map data. Landmarks are modelled from photographs. Shops have invented names.
- **Painted, not rendered.** Everything is drawn in a gouache and print style: flat tones of light, wobbling brush edges, and paper grain.
- **Built to grow.** Each part of town is a separate region produced by the same pipeline, so more of the map can be added later.

## What you can do

- Walk the cat with one finger: hold to lead it, or tap to send it somewhere.
- Pinch out to see the whole map. The further out you are, the faster the cat travels, and tapping a place you have already found takes you straight there.
- Come across a small number of orange rings, which give something to wear, a trick (Meow), or a moment of local history. At some, a pencil drawing of what once stood there sketches itself in.
- Sketch any view into a journal, where it is kept as a pencil drawing.
- Ride the steam train and the carousel in Oak Meadow, and take a rowing boat out on Vasona Lake.
- Visit the farmers' market by the plaza, which sets up on Sundays.
- Reach Vasona Dam for the closing view back to the mountains.
- Start over at any time from the bottom of the journal.

## Controls

| Action | Touch | Keyboard and mouse |
|---|---|---|
| Walk | Hold and drag | Hold the mouse button, or W A S D / arrow keys |
| Go to a spot | Tap | Click |
| Trot | Hold further from the cat | Shift with the movement keys |
| Zoom | Pinch | Mouse wheel |

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
git clone https://github.com/kidwise/los-gatos.git
cd los-gatos
npm install
npm run dev
```

Then open http://localhost:5173/.

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Starts the development server with live reload |
| `npm run typecheck` | Checks the TypeScript without building |
| `npm run build` | Type-checks and builds the game into `dist/` |
| `npm run preview` | Serves the built game locally |
| `npm test` | Runs the play tests (see Testing) |

### Useful addresses while developing

Add these to the local address:

| Address ending | Effect |
|---|---|
| `?region=main-street` or `?region=vasona` | Start in that region |
| `?reset` | Forget saved progress and start from the opening |
| `?market` | Show the farmers' market on any day |
| `?corner` | Open the original style-study street corner |
| `?x=…&z=…&span=…` | Start at a map position, with a given zoom |
| `?quality=0.6` | Fix the picture sharpness instead of adapting it |
| `?pose=walk&phase=0.25` | Hold the cat in one frame of a pose: stand, walk, trot, gallop, sit, loaf or groom |
| `?wear=beret,glasses` | Dress the cat |

## Testing

The tests play the real game in a browser and check what happens. They need Google Chrome installed and the development server running.

```sh
npm run dev      # in one terminal
npm test         # in another
```

`npm test` runs every test and takes about ten minutes. To run some of them, name them: `npm test bridge rides`.

| Test | What it checks |
|---|---|
| `bridge` | The cat crosses the Main Street bridge on the deck, is stopped by the railing, and can pass underneath |
| `rings` | Every ring in every region can be reached by tapping it from a nearby street |
| `rides` | The carousel, the train and the rowing boat can each be boarded, carry the cat, and be left |
| `story` | The opening, resuming where you left off, and the ending at the dam |
| `travel` | Walking between regions, trotting and dashing speeds, and map travel to a found place |
| `journal` | Wearing what is found, the Meow trick, the sound button, and sketching a view |

Tests live in `tests/`, one file each, with shared set-up in `tests/helper.mjs`. If the development server is on a different port, set `GAME_URL`, for example `GAME_URL=http://localhost:5174/ npm test`. The tests rely on a helper the game only exposes in development, so they cannot be run against the published game.

Other checks:

| Command | What it does |
|---|---|
| `npm run build` | Fails on any type error |
| `npm run perf` | Reports frame rate and drawing load for six views |
| `node scripts/sound-check.mjs` | Measures how loud the mix is in seven situations (add `SOUND=effects` to leave out the music) |
| `node scripts/shot.mjs "<address ending>" <output.png> [width] [height]` | Saves a screenshot of the running game |
| `node scripts/cat-sheet.mjs <output.png> [poses…]` | Saves a contact sheet of the cat's poses and gaits, frame by frame |

## How it is built

- **TypeScript, Vite and Three.js.** There is no game engine and no server; the published game is static files.
- **One paint shader** (`src/style/gouache.ts`) draws every surface, and a final pass (`src/style/paperPass.ts`) adds paper grain and edge effects.
- **Models are made in code.** Buildings, people, the cat, boats and trees are assembled from simple shapes, with no imported 3D files.
- **Sound and music are made in code** with the Web Audio API (`src/game/sound.ts`): a generative score that changes with where you are, plus the sounds of each place and of the cat. They are stand-ins tuned by measurement, until real recordings replace them.
- **Progress is saved in the browser** (local storage), so there are no accounts.

### Folders

| Path | Contents |
|---|---|
| `src/main.ts` | Start-up and the game loop |
| `src/cat/` | The cat and its animation |
| `src/game/` | Camera, controls, journal and sound |
| `src/style/` | Palette, paint shader and paper pass |
| `src/world/` | Regions, buildings, landmarks, people, lake, mountains and routing |
| `pipeline/` | Turns map data into region packs |
| `data/raw/` | Pinned OpenStreetMap snapshots |
| `data/overlays/` | Hand-written lists of things to find in each region |
| `public/regions/` | The built region packs the game loads |
| `tests/` | Play tests that drive the game in a browser |
| `scripts/` | Screenshot and performance tools |

### The map pipeline

Regions are defined in `pipeline/regions.mjs` as a box on the real map. To rebuild one, or add a new one:

```sh
node pipeline/fetch.mjs main-street   # download a fresh OpenStreetMap snapshot
node pipeline/build.mjs main-street   # build public/regions/main-street.json
```

The build places streets, footprints, water, trees and street furniture, and reads `data/overlays/<region>.json` for the rings. OpenStreetMap has no ground heights, so terrain is inferred: the freeway and creek are cut below town level and streets are kept flat.

## Publishing

Every push to `main` is built and published to GitHub Pages by `.github/workflows/deploy.yml`.

## Accuracy

This is an artist's impression, not a survey.

- Street layout, building footprints, the lake shore and the railway are real.
- Landmark buildings are modelled by eye from photographs.
- Shop names are invented, and are not real Los Gatos businesses.
- The mountain skyline, the two historical "ghost" drawings, tree positions and the farmers' market layout are approximations.

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License.
- Lettering is set in [Playfair Display](https://fonts.google.com/specimen/Playfair+Display).
- Built with [Three.js](https://threejs.org) and [Vite](https://vite.dev).

## Licence

The game's code and artwork are released under the [MIT Licence](LICENSE). The map data keeps its own licence, above.
