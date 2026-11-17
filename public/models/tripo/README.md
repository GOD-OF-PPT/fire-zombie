# Tripo energy vault — non-commercial art trial

This optional asset is **not part of the Quaternius CC0 library**.

- Generated on Tripo Studio's web interface using the signed-in Free plan, 2026-11-16.
- The plan shown at generation time states: **public models; non-commercial use only**. Do not treat this trial as a commercially licensed or CC0 asset.
- Web generation: `3c82e008-9b7c-4627-9284-df08bd060e55`, H2.5, 5,000-face budget, 4K textures, de-lighting and PBR.
- Export record preserved in GLB metadata: `7414c346-f83f-4b28-9cd8-c887253cde36`.
- One generation consumed **40 web credits**, balance **200 → 160**. One export used the allowance **15 → 14**. No reroll, subscription, or purchase was performed.
- Runtime: **4,966 triangles**, one mesh/material, three embedded **1,024×1,024** maps (base colour, normal, metallic/roughness), **1,504,260 bytes**.
- Source export: 3,916,176 bytes, three 4K maps; archived locally at `.shots/tripo-web/source.glb` with the website screenshot.

Full prompt and trial record: `docs/TRIPO_ART_PLAN.md`.

Enable with `?play=1&art=tripo`; default gameplay retains the original casing. Optional model load failure falls back to the original. The original weapon pickup and gameplay collision bounds are preserved.

Local preparation: glTF Transform 4.2.1 `center --pivot below`, then `optimize --compress false --simplify false --texture-compress false`; resize the embedded maps with `python scripts/prepare-tripo-glb.py <cleaned.glb> public/models/tripo/energy_vault.glb` (Pillow 11.2.1 used). No geometry decoder is required.
