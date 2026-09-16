# Generating the product gallery

Everything here is resumable. The state lives in `gen/out/`, and a file that
exists is a frame that is done. Nothing needs to be regenerated because a run
stopped.

## Where it stands

| | |
|---|---|
| prompts queued | 176, in `gen/queue1/` |
| references ready | 44, in `gen/ref/` |
| frames generated | 4 |
| heroes remaining | 41 |

Done: `00_0_hero`, `02_0_hero`, `02_1_texture`, `02_2_inuse`.

## What blocked it

The Claude in Chrome extension stopped responding partway through. The image
work needs it, because the logged-in ChatGPT session lives in that Chrome and
nowhere else. The in-app browser reaches chatgpt.com but is signed out, and
signing it in is not something to automate.

To resume: open the Claude side panel in Chrome, confirm it is signed in, then
run the loop below.

## The loop, three products at a time

Batching three references into one message was measured at 1m 20s for three
images against 4m 30s one at a time. Use it.

1. `navigate` to `https://chatgpt.com/`, then `find` the file input. **The ref
   changes on every page load**, so find it each time rather than reusing one.
2. `file_upload` three references, for example `ref/01.jpg ref/03.jpg ref/04.jpg`.
3. `find` the message textbox and **click it before typing**. Attaching files
   reflows the composer and typing without clicking first goes nowhere, silently.
4. Type the three-up prompt (in `queue1/`, flattened to one line because the
   composer submits on a blank line), press Return.
5. Wait about 90 seconds.
6. Download each image separately. The "All 3 images in this series" menu item
   produced one file, not three, so use "This image" on each.
7. `python grab.py NN_0_hero` immediately after each download.

## The rule that matters

`grab.py` refuses any download older than three minutes. **Do not override it.**

It was overridden once, on the reasonable-sounding assumption that the one file
sitting there must be the right one. It was the previous product's bottle, and
it went into the catalogue under the next product's name. Nothing would have
flagged it; it was caught only by looking at a contact sheet afterwards.

Regenerating costs ninety seconds. A wrong product photograph costs a customer
opening a parcel that does not match what she bought.

Two other reasons the guard earns its place:

- The Downloads folder is shared with another agent's session. Files unrelated
  to this work appear in it mid-run. The glob is scoped to `ChatGPT Image*.png`
  for that reason.
- A four-day-old ChatGPT download was already sitting there when this started,
  and the guard refused it correctly on the first run.

## Frames 2 to 4

Frame 4 is generated as a clean plate with its upper right left empty. The
Hebrew is drawn afterwards by `benefits.py`, never by the image model, which
renders Hebrew as convincing nonsense. `benefits.py --selftest` proves the
direction handling on a blank plate in one second; run it if the text ever looks
wrong.

## Putting the images on the products

`publish_glow.py --images` replaces the CJ packshot with the generated hero on
any product that has one, without recreating the product. Products already
created keep their handles, their copy and their subscription plans.
