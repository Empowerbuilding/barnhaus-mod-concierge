# Barnhaus Mod Concierge

Full-page plan-customization app for **customize.barnhaussteelbuilders.com**. Customers pick a Barnhaus plan (or arrive via deep link from a product page), then go through a formal, step-by-step AI interview that captures every modification they want — with AI-generated **floor-plan edit concept previews** along the way.

**Lead-gen only.** No pricing, no checkout. The exit is always *"send my changes to the design team."*

Forked from [`barnhaus-shopify-concierge`](https://github.com/Empowerbuilding/barnhaus-shopify-concierge).

## How It Works

1. **Plan Picker** — responsive grid of Barnhaus plans pulled live from Shopify (`GET /api/mod-plans`, cached 10 min). Deep link `?plan=<handle>` skips the picker.
2. **Customizer** — split layout:
   - **Left:** the plan's 2D floor plan (auto-detected via Claude vision from the product's Shopify images), Original ↔ Your Concept toggle, and a stack of kept concept thumbnails.
   - **Right:** step-by-step chat with progress tracker (Contact → Rooms → Additions → Kitchen & Bath → Exterior → Review) and a running checkmarked change list.
   - Mobile: plan image pinned on top, chat below.
3. **Concept previews** — when the customer defines a concrete change, the model emits a `generate_preview` directive. The server calls the n8n **floor-plan-edit** webhook (or **style-swap** for exteriors) and the client renders a before/after card with **Keep / Try Again / Skip**. Kept changes chain — the next edit builds on the last kept concept.
4. **Completion** — the interview ends with a structured submission (`change_list` of every modification + concept image URLs) that feeds the existing notify pipeline (CRM, Discord, portal, ack email).

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/mod-plans` | Filtered Shopify plan catalog (in-memory cache, 10 min) |
| `GET /api/mod-plans/:handle` | Plan detail + vision-classified `floorPlanImage` |
| `POST /api/chat` | Chat turn (`mode: "mod"` → phased mod interview prompt) |
| `POST /api/generate-preview` | `{sessionId, editPrompt, target, imageUrl}` → n8n image edit |
| `POST /api/partial` | Partial lead capture on contact-card submit |
| `POST /api/complete` | Final submission → notify pipeline |

## DRY_RUN

`DRY_RUN=true` (the default) logs submissions but suppresses **all** external writes — no Discord, CRM, portal, email/SMS, or Supabase inserts. Set `DRY_RUN=false` only in production.

## Development

```bash
cp .env.example .env   # fill in keys
npm install
npm run build          # builds client
npm start              # serves on :3000
# or: npm run dev      # server + vite dev server (:5173)
```

## Stack

Node/Express + Vite React (no CSS framework — inline Barnhaus dark theme: `#1a1a1a` / gold `#B8860B`–`#DAA520`, Inter). Claude Sonnet for the interview, Claude Haiku vision for floor-plan image classification, n8n webhooks for image editing.
