# FLOW brand assets

All artwork here is **original** to PDA BLISS FLOW. Vector assets are generated from code:

```text
npm run brand:generate   # scripts/generate-brand-assets.mjs
```

Edit the generator, not the SVG output, so the assets stay consistent.

| Folder              | Contents                                                                                    | Status                               |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| `brand/`            | FLOW symbol (time ring + F), wordmark (forest / ivory), lockup                              | Concept v0 — pending owner review    |
| `mascot/reference/` | `sally-reference-owner.png` (1254×1254) — **owner-approved canonical Sally**                | Approved by owner 2026-11-26         |
| `mascot/web/`       | Web derivatives of the reference: portrait 360/720 (WebP), avatar 128/256 (WebP), 512 (PNG) | Generated from the reference         |
| `mascot/`           | `sally-<expression>.svg` — 6 vector expressions drawn to match the reference                | Follow the reference; refine in EP05 |
| `rich-menu/`        | 2500×1686 six-action concept (with Sally) + `rich-menu.spec.json` (areas → LIFF URLs)       | Not uploaded to LINE                 |
| `flex-messages/`    | Template catalogue (rendered from `packages/shared/src/flex-preview.ts`)                    | Previews only                        |

## Sally — character sheet (owner direction, 2026-11-26)

Sally (น้องแซลลี่) is an **adorable, original anthropomorphic car mascot**. She is not a
human or humanoid assistant. Direction: **Cute × Premium × Friendly**.

- Rounded compact car body in pastel automotive blue, with silver and emerald details.
- A face on the windshield with large emerald eyes, heart-shaped sparkles, long lashes and a
  warm open smile.
- A silver clock crown with emerald heart gems and a mint light halo (the time motif).
- Emerald headphones on a silver band. The right cup carries a calendar-check mark (the
  calendar motif).
- An emerald bow with a heart gem, glowing heart headlights, and a mint light strip.
- A "FLOW" licence plate. No third-party logos, characters or promotional artwork are used, and
  no affiliation or licence with any studio is implied.

**Canonical source:** `mascot/reference/sally-reference-owner.png`. Identity-critical surfaces
(welcome screen, LINE profile/chat avatar, About, showcase hero) use this image or its crops.

**Expressions:** six vector versions keep one consistent body and change only the eyes, brows,
mouth, clock hands, headlight glow and a small status badge:

| Expression           | Face                                       | Badge | Use                                       |
| -------------------- | ------------------------------------------ | ----- | ----------------------------------------- |
| default (welcome)    | open sparkling eyes, open smile            | —     | greeting, welcome                         |
| happy (confirmation) | closed happy eyes, big smile               | check | **only** after a real success             |
| reminder             | eyes open, small “o”, clock hands moved    | bell  | reminder cards, daily summary             |
| thoughtful           | eyes glancing aside, flat mouth            | dots  | loading, checking, simulated confirmation |
| empty                | calm closed eyes, small smile, soft lights | leaf  | empty day or list                         |
| error                | worried brows and mouth, dimmed headlights | alert | failures, unavailable                     |

**Small sizes:** the avatar crop (crown + face) is recognisable at 96 / 64 / 40 / 32 px. Use
it for the LINE profile picture and chat avatar.

### Regenerating raster derivatives

From the reference (any image tool; EP00 used Pillow):

- portrait: full image resized to 720 and 360 px, WebP q≈86
- avatar: crop `(190, 20) – (1000, 830)` of the 1254 px original, resized to 512 (PNG),
  256 and 128 (WebP)

## Fonts

UI text uses **IBM Plex Sans Thai** (SIL Open Font License 1.1), self-hosted through
`@fontsource/ibm-plex-sans-thai`. The rich menu SVG names the same font. Export it to PNG on a
machine with the font installed (EP05) so Thai glyphs render correctly.
