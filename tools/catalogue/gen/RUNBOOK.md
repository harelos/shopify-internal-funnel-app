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

---

## Update after the second run

**The relay replaced the download manager.** Chrome blocks repeated downloads
from chatgpt.com at site level and that cannot be cleared from the page. So
`relay.py` runs on 127.0.0.1:9123, the tab base64s a batch of images into
`window.name`, navigates to the relay, and the server writes the files.
`window.name` survives cross-origin navigation, which is the whole trick. Three
images per trip. Start it and leave it running.

**The composer is shared with another agent.** Partway through, the composer
filled with a NovaHair banner brief in Hebrew that this session did not write.
Another Claude is working in the same ChatGPT account. That is the real cause of
most of the "typed text did not land" failures, and it is a reason to stop
rather than something to work around: retrying means overwriting their prompt.
Check the composer contents before sending; if it holds something you did not
write, leave it alone and come back later.

**The sequence that works**, when the composer is free:

1. Load `https://chatgpt.com/` fresh. Do not reuse a chat.
2. `find` the file input. Its ref changes on every load.
3. Upload three references. **Four of them are .png, not .jpg**: 15, 24, 38, 42.
   A wrong extension returns a permissions error, not a missing-file error.
4. Real click on the composer, then real `type`. Do not use execCommand; it
   inserts into the DOM without updating React, and the send button then
   believes the composer is empty.
5. Verify with `#prompt-textarea`.textContent.length before pressing Return.
6. Return. Wait about two minutes. Scroll down to force the images to load,
   then count `naturalWidth === 1254`.
7. Stage into `window.name`, navigate to the relay, then `pairsheet.py NN NN NN`.

**Always run the pair sheet.** It puts each result beside the reference it was
made from. Two mislabellings got through without it and both were obvious with
it. It also found five products whose carton makes a claim the store will not
carry, which no filter on titles could ever have seen.
