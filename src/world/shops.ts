import { P } from '../style/palette';
import type { Display, Shop } from './buildings';

// Invented shop names. None is meant to be a real Los Gatos business.
const NAMES: [string, Display][] = [
  ['Café Sereno', 'cafe'], ['Maison Pêche', 'fashion'], ['Sombroso Books', 'books'], ['The Gilded Fig', 'flowers'],
  ['Pan y Luna', 'bakery'], ['Alder & Wren', 'fashion'], ['Vasona Tea', 'cafe'], ['Luz Editions', 'books'],
  ['Fig & Thistle', 'flowers'], ['Atelier Laurel', 'fashion'], ['Oro Gelato', 'bakery'], ['Ridgeline', 'fashion'],
  ['Wren Paper Co.', 'books'], ['Bluebird Espresso', 'cafe'], ['Juniper Row', 'fashion'], ['Sugar & Sorrel', 'bakery'],
  ['Lupine & Co.', 'flowers'], ['Creekside Books', 'books'], ['Linen & Larch', 'fashion'], ['Little Heron Café', 'cafe'],
  ['Casa Mirlo', 'fashion'], ['The Marginalia', 'books'], ['Petit Madrone', 'bakery'], ['Wild Fennel', 'flowers'],
  ['Poppy Atelier', 'fashion'], ['Tazza Lenta', 'cafe'], ['Ink & Oak', 'books'], ['Sycamore & Silk', 'fashion'],
  ['Golden Crumb', 'bakery'], ['Manzanita Flowers', 'flowers'], ['Verano', 'fashion'], ['Copper Kettle Tea', 'cafe'],
  ['Flume Stationers', 'books'], ['Lune Atelier', 'fashion'], ['Morning Quail', 'cafe'], ['Petal Mill', 'flowers'],
  ['Wildcat Tailors', 'fashion'], ['The Flour Annex', 'bakery'], ['Quail & Madrone', 'fashion'], ['Heron Bindery', 'books'],
];

type Dress = Omit<Shop, 'name' | 'display'>;

// A handful of considered shopfront colourways, so the street varies without clashing.
const DRESS: Dress[] = [
  { sign: 'italic', signInk: P.brass, band: P.ink, door: P.ink, backdrop: P.backdropBlush },
  { sign: 'italic', signInk: P.oxblood, band: P.cream, door: P.oxblood, backdrop: P.backdropButter, awning: P.persimmon, awningStripe: P.warmWhite },
  { sign: 'caps', signInk: P.trim, band: P.navy, door: P.navy, backdrop: P.backdropSky, awning: P.navy },
  { sign: 'italic', signInk: P.deepGreen, band: P.cream, door: P.inkGreen, backdrop: P.backdropSky, awning: P.deepGreen },
  { sign: 'caps', signInk: P.trim, band: P.deepGreen, door: P.deepGreen, backdrop: P.backdropButter },
  { sign: 'italic', signInk: P.oxblood, band: P.warmWhite, door: P.oxblood, backdrop: P.backdropBlush, awning: P.warmWhite, awningStripe: P.blush },
  { sign: 'caps', signInk: P.trim, band: P.oxblood, door: P.oxblood, backdrop: P.backdropButter, awning: P.oxblood },
  { sign: 'italic', signInk: P.inkGreen, band: P.sage, door: P.inkGreen, backdrop: P.backdropButter, awning: P.deepGreen, awningStripe: P.sage },
  { sign: 'italic', signInk: P.navy, band: P.warmWhite, door: P.navy, backdrop: P.backdropSky },
  { sign: 'caps', signInk: P.brass, band: P.ink, door: P.ink, backdrop: P.backdropButter, awning: P.ink },
];

/** The nth shop on the map: names come round in order, so the same one never appears twice close by. */
export function shopAt(n: number, pick: number): Shop {
  const [name, display] = NAMES[n % NAMES.length];
  return { name, display, ...DRESS[Math.floor(pick * DRESS.length) % DRESS.length] };
}
