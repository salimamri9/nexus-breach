// Terminal puzzles, generated per team from the match seed. Every team gets the same 12 puzzle
// TYPES but its own words, numbers, wall clues and letter order, so an answer overheard across the
// room is useless. Generation is deterministic (seed + terminal + team), so a restored match
// rebuilds exactly the same puzzles.
//
// Puzzle kinds:
//   text     a typed answer (most types)
//   pair     two teammates stand at the terminal and its second console at the same time
//   beacons  a timed run: touch three beacons in order before the clock runs out
import { mulberry32, sectorName, TILE, PX } from '../shared/world.js';

const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };
const ORD = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// a stable stream of random numbers for (seed, terminal, team)
const rngFor = (seed, i, team) => mulberry32((seed ^ (i * 7919 + 1) * 2654435761 ^ (team + 1) * 40503) >>> 0);
const pickR = (r, arr) => arr[Math.floor(r() * arr.length)];
function shuffleR(r, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// hand out distinct entries of a pool across teams (wrapping if there are more teams than entries)
const distinct = (r, pool, n) => { const s = shuffleR(r, pool); return Array.from({ length: n }, (_, k) => s[k % s.length]); };

const caesar = (s, k) => s.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCharCode((c.charCodeAt(0) - 65 + k) % 26 + 65));

// open street tiles at a distance band from a point, reachable on foot (not solid, not a base)
function streetSpots(world, x, y, rMin, rMax) {
  const out = [];
  for (const k of world.roadTiles) {
    const tx = (k % world.W + 0.5) * TILE, ty = (Math.floor(k / world.W) + 0.5) * TILE;
    const d = Math.hypot(tx - x, ty - y);
    if (d >= rMin && d <= rMax) out.push({ x: tx, y: ty });
  }
  return out;
}

// Builds every terminal's per-team instances. Returns [{ def, kind, inst: [perTeam...] }].
// ctx: { seed, teamCount, world, terminals (positions), story, npcs (hideouts with names) }
export function buildPuzzles(defs, ctx) {
  const { seed, teamCount, world, story } = ctx;
  const out = [];
  defs.forEach((def, i) => {
    const term = ctx.terminals[i];
    const r0 = rngFor(seed, i, 99);
    const inst = [];
    const kind = def.type === 'pair' ? 'pair' : def.type === 'beacons' ? 'beacons' : 'text';
    // per-type shared draws (so teams get different entries from the same pool)
    const words = def.words ? distinct(r0, def.words, teamCount) : [];
    const phrases = def.phrases ? distinct(r0, def.phrases, teamCount) : [];
    for (let team = 0; team < teamCount; team++) {
      const r = rngFor(seed, i, team);
      let p;
      switch (def.type) {
        case 'caesar': {
          const phrase = phrases[team], shift = 3 + Math.floor(r() * 9);
          p = {
            prompt: `An intercepted Wakeful broadcast, Caesar-encrypted:\n\n    ${caesar(phrase, shift)}\n\nThe shift is sprayed on a wall in sector {sector}.\nDecrypt the message.`,
            graffiti: [`SHIFT ▸ ${shift}`],
            answers: [phrase.toLowerCase()],
            hint: `Shift every letter ${shift} places BACK through the alphabet: ${caesar('A', shift)} → A.`,
          };
          break;
        }
        case 'binary': {
          const w = words[team];
          p = {
            prompt: `Raw ASCII from NEXUS's memory:\n\n    ${[...w].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' ')}\n\nEach byte is one capital letter (A = 01000001).\nWhat word is it?`,
            answers: [w.toLowerCase()],
            hint: `A = 65. Read each byte as a number and count up the alphabet: the first letter is ${w[0]}.`,
          };
          break;
        }
        case 'reverse': {
          // answer depends on what this team recovered at the required terminal
          p = { prompt: `Uplink from {req} accepted.\n\nThe vault opens to the word you recovered there,\nbut only if you speak it in reverse.`, answersFrom: def.requires, hint: 'Read the word from your other terminal right to left.' };
          break;
        }
        case 'split': {
          let code;
          do { code = String(1000 + Math.floor(r() * 9000)); } while (new Set(code).size < 4 || code === [...code].sort().join(''));
          p = {
            prompt: `4-digit override required.\nThe Wakeful split it in two and sprayed each half on a wall:\n\n    first half in sector {sector}\n    second half in sector {sector2}\n\nFind both. Enter the full code.`,
            graffiti: [`OVERRIDE ▸ FIRST HALF ▸ ${code[0]} ${code[1]}`, `OVERRIDE ▸ SECOND HALF ▸ ${code[2]} ${code[3]}`],
            answers: [code],
            hint: 'The two halves are on opposite sides of the city: split up. Check your INTEL panel.',
            sortedCode: [...code].sort().join(''),
          };
          break;
        }
        case 'sorted':
          p = { prompt: `Uplink from {req} accepted.\n\nEnter that override with its digits sorted from lowest to highest.`, answersFrom: def.requires, sort: true, hint: 'Take the 4-digit override and put its digits in order, smallest first.' };
          break;
        case 'morse': {
          const w = words[team];
          const decoys = shuffleR(r, Object.keys(MORSE).filter((c) => !w.includes(c))).slice(0, 3);
          const key = shuffleR(r, [...new Set([...w, ...decoys])]).map((c) => `${c} ${MORSE[c]}`).join('  ');
          p = {
            prompt: `A dying transmitter repeats a pattern. Someone transcribed it in sector {sector}.\nAnother Wakeful cell left a Morse key in sector {sector2}.\n\nDecode the transmission.`,
            graffiti: [[...w].map((c) => MORSE[c]).join('   '), `MORSE KEY ▸ ${key}`],
            answers: [w.toLowerCase()],
            hint: `${w.length} letters. You need both walls: the pattern and the key.`,
          };
          break;
        }
        case 'echo': {
          // a specific word from a specific Echo: you have to find it and read it
          const echoes = (story?.echoes || []).map((e, id) => ({ ...e, id })).filter((e) => e.text.split(/\s+/).length > 20);
          const e = echoes[(Math.floor(r0() * echoes.length) + team * 3) % echoes.length];
          const wordsIn = e.text.split(/\s+/);
          let n = 0, word = '';
          for (let tries = 0; tries < 60; tries++) {
            n = 4 + Math.floor(r() * Math.min(26, wordsIn.length - 4));
            word = wordsIn[n - 1].replace(/[^A-Za-z]/g, '');
            if (word.length >= 5) break;
          }
          p = {
            prompt: `Salim hid this password inside one of the Echoes.\n\nFind the Echo titled “${e.title}”.\nIts ${ORD(n)} word is the password.\n\n(Echoes are the pale-blue lights around the city. Once read, they stay in your INTEL panel.)`,
            answers: [word.toLowerCase()],
            hint: `That Echo is in sector ${sectorName(world.echoes[e.id % world.echoes.length].x, world.echoes[e.id % world.echoes.length].y)}. Count from the very first word of its text. The password has ${word.length} letters.`,
            echoId: e.id,
          };
          break;
        }
        case 'survivor': {
          const names = ctx.npcNames;
          const npc = (Math.floor(r0() * names.length) + team * 5) % names.length;
          const w = words[team];
          p = {
            prompt: `Salim trusted one survivor with this password: ${names[npc]}.\n\nThey hide in the ruins and move between hideouts.\nFind ${names[npc]} and talk to them (E).`,
            answers: [w.toLowerCase()],
            hint: `${names[npc]} was last seen in sector {npcSector}.`,
            npc, password: w,
          };
          break;
        }
        case 'count': {
          // count the tarp-covered cars in one sector: walk it, look, count
          const cars = world.props.filter((q) => q.type === 'covered_car');
          const per = new Map();
          for (const c of cars) { const s = sectorName(c.x, c.y); per.set(s, (per.get(s) || 0) + 1); }
          const good = [...per].filter(([, n]) => n >= 3 && n <= 7).map(([s]) => s).sort();
          const sector = good.length ? good[(Math.floor(r0() * good.length) + team * 7) % good.length] : [...per.keys()][0];
          const n = per.get(sector) || 0;
          p = {
            prompt: `Patrol audit. NEXUS logged every vehicle in sector ${sector}, then the log was wiped.\n\nHow many tarp-covered cars are parked in sector ${sector}?\n\n(The sector you are in is shown under the minimap.)`,
            answers: [String(n), NUM_WORDS[n] || String(n)],
            hint: `Walk every street in ${sector}, edge to edge. It's more than ${Math.max(0, n - 2)} and fewer than ${n + 3}.`,
            sector,
          };
          break;
        }
        case 'glitch': {
          const w = words[team];
          p = {
            prompt: `This terminal's password does not exist in Halcyon.\nIt only appears when the city glitches.\n\nWatch your screen when the simulation slips.`,
            answers: [w.toLowerCase()],
            hint: `Glitches come more often as the night goes on. The word flashes for about a second, in green. It has ${w.length} letters and starts with ${w[0]}.`,
            glitchWord: w,
          };
          break;
        }
        case 'pair': {
          const spots = streetSpots(world, term.x, term.y, 16 * PX, 28 * PX);
          const c = spots.length ? spots[Math.floor(r0() * spots.length)] : { x: term.x + 20 * PX, y: term.y };
          p = {
            prompt: `TWO-KEY TERMINAL.\n\nOne of you stays at this terminal. Another goes to the second console in sector ${sectorName(c.x, c.y)} (now marked on your map).\nBoth stand at your console at the same time for 3 seconds.`,
            hint: 'Split up: you cannot do this one alone. Stand right next to each console.',
            console: { x: c.x, y: c.y },
          };
          break;
        }
        case 'beacons':
          p = {
            prompt: `BEACON RELAY.\n\nPress START and three beacons light up nearby, one after another.\nTouch each one (any of you) before the clock runs out.\nIt's loud: drones will come.`,
            hint: 'Spread your team out before you start, so someone is already near the next beacon.',
          };
          break;
        default:
          // plain typed puzzle straight from config (riddles and the like)
          p = { prompt: def.prompt, answers: def.answers, hint: def.hint, graffiti: def.graffiti };
      }
      inst.push({ reward: def.reward || null, ...p });
    }
    out.push({ def, kind, inst });
  });
  // chains: answers that depend on the required terminal's answer for the same team
  for (const t of out) {
    for (const [team, p] of t.inst.entries()) {
      if (p.answersFrom === undefined) continue;
      const src = out[p.answersFrom]?.inst[team];
      if (!src) continue;
      if (p.sort) p.answers = [src.sortedCode || [...src.answers[0]].sort().join('')];
      else p.answers = [[...src.answers[0]].reverse().join('')];
    }
  }
  return out;
}

// three beacon spots for a run, spaced out around the terminal
export function beaconSpots(world, x, y, rnd) {
  const spots = streetSpots(world, x, y, 22 * PX, 55 * PX);
  const picked = [];
  for (let tries = 0; tries < 400 && picked.length < 3; tries++) {
    const s = spots[Math.floor(rnd() * spots.length)];
    if (!s || picked.some((q) => Math.hypot(q.x - s.x, q.y - s.y) < 25 * PX)) continue;
    picked.push(s);
  }
  while (picked.length < 3) picked.push({ x: x + (picked.length + 1) * 15 * PX, y });
  return picked;
}

