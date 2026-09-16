# Where the pack contradicts the copy

Found by generating the frame, because the frame reproduces the label and the
label is the only place some of this is written. CJ's own ingredient list and
the carton do not always agree, and the carton is what arrives.

| src | handle | copy says | pack says | action |
|---|---|---|---|---|
| 20 | novaglow-malic-toner | חומצה מאלית, malic acid | GLYCOLIC ACID 10% EXFOLIATING TONER | CJ's ingredient list says malic acid, the carton says glycolic 10%. Rewrite the copy to glycolic, or drop as a near duplicate of 18 (glycolic 7%). Decide once 21 and 22 are generated, because both are also glycolic and four glycolic toners is not a shelf. |

## Why the dedupe missed this

The selection deduped on title words. CJ titles for all four are variations of
"Exfoliating Toner" and "Toner", and none of them name the acid. The acid is on
the carton. So a word-overlap test on titles cannot tell a glycolic toner from a
malic one, and four near-identical products survived as four different ones.

The generated frames are what surfaced it, which is an argument for generating
the hero before writing the copy rather than after.
