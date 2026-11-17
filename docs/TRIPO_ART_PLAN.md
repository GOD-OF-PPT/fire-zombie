# Tripo art trial: energy vault

Status: Web generation and GLB export succeeded. The asset is integrated behind an opt-in art trial; the original game art remains the default. The prior CLI/API proposal below was not executed.

## Web trial (2026-11-16)

- Task: `3c82e008-9b7c-4627-9284-df08bd060e55`.
- Page: <https://studio.tripo3d.ai/zh/workspace/generate/3c82e008-9b7c-4627-9284-df08bd060e55>.
- Model: **H2.5 – 经典版本**. The free web plan lists 15 exports restricted to H2.5, so H3.1 was not used for this trial.
- Settings observed in the UI before submission: text input below, 5000 faces, triangle topology, texture generation on, 4K textures, de-lighting on, PBR on. Part generation and 8K were off.
- One generation submitted at the displayed price of **40 web credits**. The balance changed from **200 to 160**. API credits are separate and were not used.
- The website's free plan states **public models, non-commercial use only**. This is an art experiment; retain the existing default game art and do not label this output as Quaternius/CC0.
- Generation completed: **4,966 triangles**, 4,333 vertices shown in Studio; one mesh and one PBR material in the exported GLB.
- Export succeeded as GLB. Export ID: `7414c346-f83f-4b28-9cd8-c887253cde36`. Remaining free export allowance: **14**. No additional generation or paid reroll was submitted.
- Raw size: **3,916,176 bytes**, with three embedded 4096×4096 JPEG textures. Runtime size: **1,504,260 bytes**, with 1024×1024 textures and the same geometry. glTF Transform centered/pruned the scene; `scripts/prepare-tripo-glb.py` resized the textures using Pillow. Producer metadata remains in the GLB.
- Art review: the open chamber is usable, but some hard edges are softened/melted and the finish differs from the intended gunmetal. Keep this as a comparison trial rather than a wholesale art replacement.
- Development preview: `/scripts/preview-prop.html`. Opt-in game route: `/?play=1&art=tripo`. Normal game loading does not request the trial asset. Missing trial assets retain the original vault casing.
- Validation: build and 85 unit tests passed. Browser checks verified successful PBR loading and the deliberate missing-model fallback. Phone hardware and commercial licensing are not certified.
- Local evidence: `.shots/tripo-web/generated.jpg` and `.shots/tripo-web/runtime-preview.jpg`. Raw and intermediate GLBs are retained in that ignored folder.

## Goal

Replace the current procedural reward-vault casing with one detailed, textured sci-fi prop. Preserve the visible rotating weapon, reward labels, collision bounds and game rules. Review the generated preview before integrating the asset, then inspect it in the real game camera.

## Exact input

```text
A single premium stylized sci-fi energy upgrade capsule for a neon arcade shooter. Compact upright reactor vault, squat readable silhouette, open cage with four thick beveled gunmetal pillars, layered armored hexagonal base, brushed silver edge trims, tiny bolts, recessed vents, restrained orange caution accents, cyan illuminated rings. Empty open central display chamber to hold a rotating weapon pickup, clear sight through the center, no object inside the chamber. Armored top lid. Polished hard-surface game prop with clean panel lines and detailed PBR metal and ceramic surfaces, subtle edge wear, cohesive object, readable from an elevated third-person camera. No ground plane, no environment, no trailing cables, no floating parts, no text, no logo.
```

## Archived API proposal (not executed)

One API call, in order:

1. `POST /v3/generation/text-to-model`: CLI model alias `tripo-v3.1`, API model `v3.1-20260211`; `face_limit=5000`, `smart_low_poly=true`, `texture_quality=detailed`, `texture=true`, `pbr=true`.

Estimated cost: textured text generation 20 credits + smart low-poly 10 credits + detailed textures 10 credits = **40 credits total**. Failed or cancelled tasks are refunded. No paid conversion, rigging, animation, or automatic reroll is planned. The task result supplies the actual billed amount.

## Files

- Raw CLI output: `.shots/tripo/tripo-out/prism-energy-vault-<task>/` (`model.glb`, preview and task record, according to the generation result).
- Proposed runtime asset: `public/models/tripo/energy_vault.glb` after preview approval and validation.
- Provenance: record the task ID, prompt, actual credits, final triangle/texture counts and source in the asset attribution. Tripo output must not be labelled as part of the existing Quaternius CC0 library.

## Integration and validation

- Load as an optional prop with the existing casing retained as a fallback.
- Preserve PBR maps and normalize its scale and ground pivot locally.
- Keep its central display chamber unobstructed and preserve the gameplay labels.
- Share cloned geometry/materials across vault instances.
- Inspect preview, gameplay close-up, desktop/mobile viewport screenshots, load failure, file size and frame cost before enabling it by default.

## Archived API command (not executed)

```powershell
$env:TRIPO_CLIENT_APP='codex'
$env:TRIPO_DISTRIBUTION_CHANNEL='codex_plugin'
tripo make 'A single premium stylized sci-fi energy upgrade capsule for a neon arcade shooter. Compact upright reactor vault, squat readable silhouette, open cage with four thick beveled gunmetal pillars, layered armored hexagonal base, brushed silver edge trims, tiny bolts, recessed vents, restrained orange caution accents, cyan illuminated rings. Empty open central display chamber to hold a rotating weapon pickup, clear sight through the center, no object inside the chamber. Armored top lid. Polished hard-surface game prop with clean panel lines and detailed PBR metal and ceramic surfaces, subtle edge wear, cohesive object, readable from an elevated third-person camera. No ground plane, no environment, no trailing cables, no floating parts, no text, no logo.' --model tripo-v3.1 -p face_limit=5000 -p smart_low_poly=true -p texture_quality=detailed -p texture=true -p pbr=true --name prism-energy-vault -o .shots/tripo --json --yes
```

The same command with `--dry-run --json` instead of `--json --yes` returned `valid: true`, no pending uploads, no warnings and no errors.
