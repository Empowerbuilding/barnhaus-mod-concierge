# VERIFY.md — Phase 1 Local Verification

Run locally on 2026-09-07 against a dev `.env` (keys from the existing Coolify concierge app). Server on `:3000`, `DRY_RUN=true`. All responses below are real, unedited.

## 1. Health

```
GET /health
{"status":"ok","plans":75,"dryRun":true}
```

## 2. GET /api/mod-plans — 30 plans, credits product excluded

31 Shopify products → 30 plans ("5 Style Credits" filtered out). Spec parsing from tags/handle/body:

```
count: 30
The Apex        | beds: 4 baths: 3.5 sqft: 3323
The Bastion     | beds: 4 baths: 4.5 sqft: 3020
The Bloom       | beds: 4 baths: 3   sqft: 2741
The Bungalow    | beds: 3 baths: 2   sqft: None
The Cloud Gate  | beds: 3 baths: 2.5 sqft: 2275
The Cove Branch | beds: 3 baths: 2   sqft: 2323
```

## 3. GET /api/mod-plans/:handle — vision floor-plan classification

The Apex has 18 images (renders first, floor plans at indexes 16–17). One Claude Haiku vision call over an 8-image candidate pool picked the correct 2D floor plan:

```
title: The Apex | Modern Industrial Barndominium Plan
beds/baths/sqft: 4 3.5 3323
floorPlanImage: .../files/1st_info.jpg?v=1764051942   ← correct (the 2D floor plan)
(1.8s, cached per product afterward)
```

## 4. Scripted chat session (mode: "mod", The Apex)

**Turn 1 — "Hello"** → Phase 0 greeting, `step: "contact"`:
> "Welcome! You're looking at The Apex — great choice. I'm the Barnhaus Mod Concierge, and I'll walk you through customizing this plan step by step. Before we start, I need your name, email, and phone so we can save your changes."

**Turn 2 — tried to skip contact ("I want to add a bedroom")** → correctly refused:
> "I'd love to help you with that! I just need your name, email, and phone before we dig in — that's how the design team saves your customization file. What's your name?"
> `step: "contact"`

**Turn 3 — contact submitted** → moved to Rooms & Layout, `step: "rooms"`, referenced plan specs (4 bed / 3,323 SF).

**Turn 4 — vague change** ("extend the porch across the rear") → asked a clarifying question (depth) instead of generating — as designed.

**Turn 5 — concrete change** ("12 feet deep, full width") → emitted the preview directive:

```json
"pendingPreview": {
  "editPrompt": "Extend the covered back porch to run the full width across the entire rear wall of the house, 12 feet deep.",
  "target": "floorplan"
},
"step": "additions"
```

## 5. POST /api/generate-preview — real floor-plan edit (The Apex, 1st_info.jpg)

```
POST /api/generate-preview
{"sessionId":"verify_...","editPrompt":"Extend the covered back porch...12 feet deep.",
 "target":"floorplan","imageUrl":"https://cdn.shopify.com/s/files/1/0755/2024/5817/files/1st_info.jpg?v=1764051942"}

→ 47s →
{
  "success": true,
  "resultUrl": "https://res.cloudinary.com/dbyz6clmj/image/upload/v1788813386/home-designs/floorplans/poexd6cka9oie1z0aymz.jpg",
  "verified": false,
  "notes": "Porch slab added along the right exterior wall beyond the rear wall request."
}
```

## 6. Keep flow + walkthrough to completion

Hidden "[Client kept the change: ... Concept: <url>]" message → model acknowledged ("that full-width rear porch is locked in") and continued the walkthrough. Steps tracked correctly through the whole session: `contact → rooms → kitchen_bath → exterior → review`.

Final turn → `conversationComplete: true` with the new schema:

```json
"change_list": [
  {
    "category": "Additions",
    "description": "Extend the covered back porch to run the full width across the entire rear wall of the house, 12 feet deep.",
    "concept_image_url": "https://res.cloudinary.com/dbyz6clmj/image/upload/v1788813386/home-designs/floorplans/poexd6cka9oie1z0aymz.jpg"
  }
],
"additional_notes": "Modification request for The Apex: Client wants to extend the covered rear porch to full width across the entire back wall at 12 feet deep. No other changes requested.",
"name": "Test Verifier", "email": "verify@example.com", "phone": "(555) 123-4567",
"location": "Boerne, TX", "timeline": "Spring next year", "land_owned": true
```

(A discarded change — the fifth bedroom the client backed out of — was correctly *excluded* from change_list.)

## 7. DRY_RUN gating — no external writes

```
POST /api/complete  → {"success":true,"dryRun":true}
POST /api/partial   → {"ok":true,"dryRun":true}

server log:
[DRY_RUN] Submission received — external writes suppressed: {...}
[DRY_RUN] Partial lead captured: Test Verifier <verify@example.com> (555) 123-4567 — external writes suppressed
```

No Discord, CRM, portal, Supabase, email, or SMS calls fired.

## 8. Client build

`npm run build` → clean, 225 kB bundle (41 modules). Served from Express static at `/`.

## Not live-tested

- **Style-swap (exterior) webhook** — code path implemented in `server/previews.js` but not exercised live (avoids writing swap-credit records for a test email). Same request/response shape as documented.
- **Production notify pipeline** (`DRY_RUN=false`) — intentionally untested per Phase 1 scope.
- **Visual/browser UI pass** — client builds clean and all API contracts are verified above, but no manual click-through was performed in this run (sandbox browser couldn't reach localhost).
