import { describe, expect, it } from 'vitest';
import { createSimulation, verifyDeterministicReplay } from '../../src/sim/index';
import {
  buildExpeditionNodeScript,
  EXPEDITION_RELICS,
  generateExpeditionMap,
} from '../../src/sim/v23Mechanics';
import {
  BUILTIN_TRACK_PRESETS,
  compileCustomBlueprint,
  decodeTrackShareCode,
  encodeTrackShareCode,
} from '../../src/sim/trackEditor';

describe('V23 Live-Service Endgame & Modding Studio Five Stages', () => {
  it('generates a deterministic 3-Act branching Star-Chart Expedition & compiles node scripts', () => {
    const mapA = generateExpeditionMap(202623);
    const mapB = generateExpeditionMap(202623);
    expect(mapA).toEqual(mapB);
    expect(mapA.availableNodeIds).toEqual(['a1_0', 'a1_1']);
    expect(Object.keys(EXPEDITION_RELICS).length).toBe(4);

    // Every act has 5 nodes (2 entry -> 2 mid -> 1 act boss = 15 nodes across 3 acts)
    expect(mapA.act).toBe(1);
    const script = buildExpeditionNodeScript(
      {
        id: 'a1_0',
        act: 1,
        col: 0,
        lane: 0,
        kind: 'prism_lab',
        sectorTheme: 1,
        nemesisRisk: false,
        nextIds: ['a1_2'],
      },
      202623,
      32,
    );
    expect(script.startSquad).toBe(32);
    expect(script.encounters.some((e) => e.type === 'reflector')).toBe(true);
  });

  it('spawns Nemesis "PRISM HUNTER · 零号猎犬" with Adaptive Polarized Shield & shatters via weapon swap / bank-shot', () => {
    const sim = createSimulation();
    sim.startSector(2, {
      layoutSeed: 202623,
      bonusSquad: 45,
      damageMult: 2.2,
      starterWeapon: 'pulse',
      forceNemesisAmbush: true,
      equippedWingman: 'prism_mirror',
      wingmanFormation: 'forward_mirror',
    });

    let ambushed = false;
    let shieldBroken = false;
    let defeated = false;

    for (let i = 0; i < 2200; i++) {
      const snap = sim.getSnapshot();
      if (snap.phase !== 'PLAYING') break;
      const nem = snap.nemesis;
      const shouldSwap = Boolean(nem && !nem.shieldBroken && i % 45 === 0);
      const evs = sim.stepFixed({
        dragDeltaX: nem ? (nem.x - snap.squadX) * 0.16 : 0,
        keyAxisX: 0,
        swapWeapon: shouldSwap,
        overdrive: snap.resonance >= 0.99,
      });
      for (const ev of evs) {
        if (ev.type === 'NEMESIS_AMBUSH') ambushed = true;
        if (ev.type === 'NEMESIS_SHIELD_BREAK') shieldBroken = true;
        if (ev.type === 'NEMESIS_DEFEAT') defeated = true;
      }
      if (defeated) break;
    }

    expect(ambushed).toBe(true);
    expect(shieldBroken || defeated).toBe(true);
  });

  it('activates Tri-Prism Resonance Lattice & unleashes Overlimit Nirvana Burst with 0-drift replay', () => {
    const sim = createSimulation();
    sim.startSector(1, {
      firingRange: true,
      layoutSeed: 202619,
      equippedWingman: 'prism_mirror',
      wingmanFormation: 'forward_mirror',
    });

    let latticeOnline = false;
    let nirvanaFired = false;

    for (let i = 0; i < 160; i++) {
      const s = sim.getSnapshot();
      const fireNirvana = (s.nirvanaCharge ?? 0) >= 0.999 && !nirvanaFired;
      const evs = sim.stepFixed({
        dragDeltaX: 0,
        keyAxisX: 0,
        nirvanaBurst: fireNirvana,
      });
      for (const ev of evs) {
        if (ev.type === 'TRI_PRISM_LATTICE_ONLINE') latticeOnline = true;
        if (ev.type === 'OVERLIMIT_NIRVANA_BURST') nirvanaFired = true;
      }
    }

    const finalSnap = sim.getSnapshot();
    expect(latticeOnline || (finalSnap.triPrismLinks?.length ?? 0) > 0).toBe(true);
    expect(nirvanaFired).toBe(true);
    expect((finalSnap.nirvanaDmgTotal ?? 0) > 0).toBe(true);

    const log = sim.exportReplayLog();
    const verify = verifyDeterministicReplay(log);
    expect(verify.matched).toBe(true);
  });

  it('encodes, decodes, and compiles Custom Track Blueprints via PZ23 Share Codes losslessly', () => {
    const preset = BUILTIN_TRACK_PRESETS[0]!;
    const code = encodeTrackShareCode(preset);
    expect(code.startsWith('PZ23-')).toBe(true);

    const decoded = decodeTrackShareCode(code);
    expect(decoded).not.toBeNull();
    expect(decoded!.title).toBe(preset.title);
    expect(decoded!.bossId).toBe('hydra_02');
    expect(decoded!.items.length).toBe(preset.items.length);

    const compiled = compileCustomBlueprint(decoded!);
    expect(compiled.script.runwayLength).toBe(300);
    expect(compiled.runtimeProps.some((p) => p.kind === 'reflector')).toBe(true);

    const sim = createSimulation();
    sim.startSector(decoded!.sectorTheme, {
      layoutSeed: 777,
      customBlueprint: decoded!,
    });
    const snap = sim.getSnapshot();
    expect(snap.customTrackTitle).toBe(preset.title);
  });
});
