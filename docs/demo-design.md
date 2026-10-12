# Agent save demo, local review

Local preview: http://127.0.0.1:3000/#how-it-works. This revision replaces the small vector walkthrough with a larger video-like animated conversation. It remains uncommitted and local. The previous checkpoint is bb72a47.

The story has one continuous object: an article preview. The opening research response shows its thumbnail. A short request types into the composer, sends, and produces an agent confirmation card. A simulated pointer confirms the save. The same card moves into the Design collection, whose count and saved status update. Desktop shows conversation and library side by side; mobile moves between those views while preserving the card. Playback lasts 13.2 seconds, holds the saved result for 1.8 seconds, and repeats.

The player begins automatically when sufficiently visible and pauses when out of view or in a hidden tab. It resumes when visible again unless the user paused it manually. The playback bar, chapter tabs, and caption have been removed at the user's request. Only a small pause/resume button appears on hover or keyboard focus, keeping the default view clear. Reduced motion suppresses animation and automatic playback. Confirmation is an example agent interaction, not a required product protocol. The demo is explicitly labelled Example workflow and uses example.com. It does not send a request or create real library content. Thumbnail imagery and the reading-time badge illustrate the proposed preview treatment rather than new database features.

Hero subtext now uses the short line discussed with the user: “Ask your agent to save what’s useful without breaking your flow.” The existing headline, hero artwork, and fonts remain.

The final thumbnail asset is `/home/enoch/aworkspace/agents/stash/apps/web/public/reading-preview.webp`, 960 by 540 pixels. It was generated with the built-in image-generation tool and optimized into WebP. Original: `/home/enoch/.codex/generated_images/01a12ef8-43e0-75c2-a768-e92506b42ec1/exec-bc472b38-38ad-4dac-9e96-26dd0cef89ec.png`.

Generation prompt:

Create one high-quality editorial photograph for a small article-preview thumbnail on a polished research app website. Wide landscape 16:9 composition. Quiet overhead-to-oblique closeup of an open design book, a few sheets of neatly annotated paper and a simple graphite pencil on a warm ivory desk. Soft natural window light, fine paper texture, very subtle shadows, muted warm stone, cream and desaturated sage colors. A tiny lavender bookmark is tucked in the open book. Realistic premium magazine photography, thoughtful composition with enough breathing room, tactile, clean, restrained. No computer, no person, no coffee, no plant, no decorative clutter, no text overlays, no logos, no identifiable readable words, no gradients. The book's printing should look like authentic small typesetting, indistinct at this scale. Intended as thumbnail art for an example saved article about better reading experiences. Image only, no UI or website mockup.


## Populated library and chat styling revision

At the user's request, the library pane is now 36% of the desktop stage rather than 44%. It begins with two existing saved cards. The incoming article contracts from its detailed confirmation preview into a matching compact card; the two older cards slide down, and the count changes from 2 to 3. Mobile preserves the same populated list in its saved scene.

The conversation now uses a ChatGPT-style toolbar, plain assistant text, neutral rounded user messages, a rounded grey composer, plus control, and circular send button. The header uses ChatGPT as the requested visual example. This is an illustrated interface, not proof of a native ChatGPT integration or a change to supported authentication. The product's general agent positioning remains in the hero.

Screenshots include `docs/evidence/browser/demo-ask-stage.png` and `demo-saved-stage.png`. The browser test checks that both previously saved resources remain after the addition and that the count increases to three. Composer placeholder contrast was adjusted after an axe finding. The revision remains local and uncommitted.

## Phone library revision

The Stash side now appears inside a dark rounded phone frame with a quiet status bar, camera island, and home indicator. The phone sits separately from the chat on desktop. Its compact list retains both previous resources; the new preview moves into the phone as a third card. On narrow screens, the chat transitions into the phone scene.
