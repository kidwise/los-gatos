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
    exits: [{ to: 'vasona', side: 'north' }],
  },
  vasona: {
    title: 'Oak Meadow & Vasona',
    // The creek corridor north of downtown: the trail, Oak Meadow Park and Vasona Lake.
    bbox: [37.2258, -121.9768, 37.2460, -121.9630],
    // This region is about the parks, so the streets round them are kept plain and light.
    shopfronts: false,
    parkedCars: false,
    scale: 1,
    // Here the freeway runs at grade and the creek in a shallow bed, unlike downtown's deep cutting.
    freewayDepth: 0.6,
    creekDepth: 2.6,
    heroes: [{ id: 'carousel', near: 'W.E. "Bill" Mason Carousel' }],
    // Walking off this edge leads to the neighbouring region.
    exits: [{ to: 'main-street', side: 'south' }],
  },
};
