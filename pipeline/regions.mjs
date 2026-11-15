// Every region of the game is a box on the real map plus how much to shrink it.
// Adding a region later means adding one entry here and running the pipeline.
export const REGIONS = {
  'main-street': {
    title: 'Main Street',
    // south, west, north, east (degrees)
    bbox: [37.2188, -121.9848, 37.2258, -121.9735],
    // Real metres are multiplied by this. Downtown stays at true size so buildings keep human scale;
    // long, empty stretches of trail are where a smaller number belongs.
    scale: 1,
    // Landmarks that get a hand-built model instead of a generic block. Each is matched to the
    // building nearest a named map feature (near), or to one building by its map id (way).
    // `faces` names the street its front looks onto, when that is not simply the nearest one.
    heroes: [
      { id: 'mill-annex', near: 'Forbes Mill Museum' },
      { id: 'theatre', near: 'Los Gatos Theatre' },
      { id: 'library', near: 'Los Gatos Public Library' },
      { id: 'high-school', way: 82710819, faces: 'East Main Street' },
    ],
  },
};
