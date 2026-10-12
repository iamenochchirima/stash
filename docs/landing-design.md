# Stash landing page review

Local preview: http://127.0.0.1:3000/ and http://127.0.0.1:3000/signup. The user requested local review before deployment. No hosting changes or deployment were made for this redesign.

The current hero removes the mock library UI. A single tactile folder illustration accompanies concise copy about saving useful things during chat/research. The second section demonstrates saving, organizing, and retrieval through manually controlled vector animation. There are no particular agent-client names, testimonials, fabricated metrics, or pricing claims on the public page.

The final hero asset is `/home/enoch/aworkspace/agents/stash/apps/web/public/stash-hero.webp`, 1000 by 985 pixels, with alpha transparency and approximately 129 KiB. It was generated using the built-in image-generation tool, then optimized into WebP for the page. The original generated PNG is under `/home/enoch/.codex/generated_images/01a12ef8-43e0-75c2-a768-e92506b42ec1/exec-27ec3c09-9ee2-4a6a-bd4d-1e6a48c41937.png`.

Generation prompt:

Create a premium editorial 3D product illustration for the website Stash, a tool where people and AI agents save useful links and notes while chatting or researching. One isolated still-life object, a beautifully crafted open document folder with softly rounded corners made of warm ivory matte paper, containing just three saved reference cards: one small article card, one card with a minimal chain-link symbol, one card with a small violet bookmark tab. Arrange papers neatly at subtly different angles, not exploding or floating, mostly tucked into the folder. Front of folder has a small clean violet outlined cube emblem without words. Studio product photography meets tactile high-end 3D illustration. Precise edges, realistic paper thickness, soft neutral daylight from upper left, restrained contact shadow, elegant off-white and stone materials, small desaturated violet and sage accents. Front three-quarter view, composition occupies central 75 percent of a square canvas, medium closeup. TRUE TRANSPARENT BACKGROUND, preserve clean alpha edges and a very soft contact shadow. No text, no letters, no numbers, no UI panels, no gradients or glowing blobs in background, no sparkles, no decorative floating objects, no robots, no faces, no charts. Sophisticated, calm, clean, beautifully detailed, appropriate for a professional SaaS landing page. Visual asset only, not a website mockup.


## Centered folder with incoming saves

The user requested a smaller central folder surrounded by assistant examples. ChatGPT, Claude, Grok, Lina, Gemini, and Any agent appear as compact labels with decorative symbols. These symbols are not official logo assets or claims of native integrations. Example article links, notes, and references move inward one at a time over a 16.8-second cycle. The folder makes a small receiving motion. Reduced motion removes the incoming items and folder movement. The existing WebP is reused; the paths and animation are CSS/SVG.

The animation is clipped to its illustration region, preventing delayed invisible items from creating horizontal scrolling on small screens.


## Official marks and richer incoming cards

The user rejected decorative assistant symbols and tiny stream labels. The ChatGPT, Claude, Grok, and Gemini labels now use assets from their official sites or asset packages. Source URLs are recorded in apps/web/public/agents/README.md. Lina is text-only pending the user's logo; Any agent is removed. The folder width is reduced from 54% to 44%. The incoming saves are 154px article preview and note cards with readable titles and a thumbnail or document icon. They keep their size for most of the approach, then tuck behind the folder front. Five staggered arrivals share a 20-second loop.


## MCP connection section and Lina icon

Lina now uses the user's supplied original PNG. A new section after the walkthrough pairs the copy "Your library. In the conversation." with a quiet agent-to-Stash connection illustration and three setup steps. The primary Connect your agent button opens the existing MCP guide at /help#agents. The guide begins with account creation/sign-in actions and directs users to Agent connections for their key and MCP address. The section states the current remote MCP/key compatibility requirement.


## Quieter MCP section

At the user's request, removed the MCP kicker, paragraph, compatibility footnote, and three setup rows. The section now has only its heading, Connect your agent button, and the unchanged connection diagram. The linked setup guide retains the account, compatibility, and configuration details.
