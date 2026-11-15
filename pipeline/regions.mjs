// Every region of the game is a box on the real map plus how much to shrink it.
// Adding a region later means adding one entry here and running the pipeline.
export const REGIONS = {
  'main-street': {
    title: 'Main Street',
    // south, west, north, east (degrees)
    bbox: [37.2188, -121.9848, 37.2258, -121.9772],
    // Real metres are multiplied by this. Downtown stays at true size so buildings keep human scale;
    // long, empty stretches of trail are where a smaller number belongs.
    scale: 1,
  },
};
