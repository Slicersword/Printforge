# AI platforms in PrintForge

Open **AI** in the top bar and pick a platform on the left. Each platform keeps its own key in your browser, so you can switch between them without typing keys again. Keys are sent only to their own service, or to your relay if you set one.

Free tiers change often. Check each site for current limits before relying on them.

| Platform | What you get | Input | Free tier | Key |
|---|---|---|---|---|
| **Gemini** (Google AI Studio) | A code model with editable sizes | Text | Free tier with daily limits | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| **Claude** (Anthropic API) | A code model with editable sizes | Text | Paid, per use | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| **OpenAI-compatible** | A code model with editable sizes | Text | Depends on the service; local models (Ollama, LM Studio) are free | Depends on the service |
| **Zoo Text-to-CAD** (zoo.dev) | A CAD-quality mesh (STL) | Text | Free monthly developer credit | API token from your Zoo account ([how](https://zoo.dev/docs/developer-tools/api/authentication)) |
| **Tripo3D** | A detailed mesh, converted to STL | Text or a picture | Free credits when you sign up | API Keys page on the Tripo developer platform ([docs](https://developers.tripo3d.com/en/docs/quick-start)) |
| **TRELLIS** on Hugging Face | A mesh from a photo | A picture | Free community GPU: about 2 minutes a day without a token, 5 with a free account | Optional: [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) (Read access) |

## Which one should I use?

- **Brackets, boxes, mounts, holders, spacers**: Gemini (free) or Claude. You get a code model whose sizes stay editable in the panel.
- **Mechanical parts described in words**: Zoo Text-to-CAD.
- **Figures, animals, props, miniatures**: Tripo3D (from words or a picture) or TRELLIS (from a picture, free).

Meshes from Tripo3D and TRELLIS are scaled so the largest side matches **Largest side (mm)**. If a mesh has holes, PrintForge rebuilds it as a watertight solid automatically and tells you, since very fine details can soften.

## How each one is called

- **Gemini**: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the `x-goog-api-key` header. The default model is `gemini-flash-latest`; use **More settings → List my Gemini models** to pick another.
- **Claude**: `POST https://api.anthropic.com/v1/messages` with browser access enabled.
- **Zoo**: `POST https://api.zoo.dev/ai/text-to-cad/stl` with `{"prompt": …}`, then poll `GET /user/text-to-cad/{id}` until `completed`. The STL arrives base64-encoded in `outputs`.
- **Tripo3D** (API v3): `POST /v3/generation/text-to-model` or upload with `POST /v3/files` and `POST /v3/generation/image-to-model`, poll `GET /v3/tasks/{id}`, then `POST /v3/models/convert` with `"format": "STL"` and download `output.model_url`.
- **TRELLIS**: the official Gradio client (loaded from jsDelivr) calls the Space's `/image_to_3d` and `/extract_glb` endpoints. The default Space is `trellis-community/TRELLIS`; change it under **More settings** if it moves.

## The relay (only if Zoo or Tripo3D say they can't be reached)

Web pages can only call services that allow it (CORS). Gemini, Claude and Hugging Face allow it. Zoo and Tripo3D may not, because they expect calls from servers. If PrintForge says it couldn't reach them, run your own relay:

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (free plan is fine).
2. **Workers & Pages → Create → Worker**, name it `printforge-relay`, click **Deploy**, then **Edit code**.
3. Replace the code with `relay/worker.js` from this repo. In `ALLOWED_ORIGINS`, put your site's address (for example `https://slicersword.github.io`). Click **Deploy**.
4. In PrintForge: **AI → More settings → Relay**, paste the worker address, for example `https://printforge-relay.yourname.workers.dev`.

The relay forwards only to Zoo and Tripo3D (and their file downloads), only for pages from your own site, and stores nothing.
