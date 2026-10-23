# gtm/field: field sales kit

Start with [../17-field-kit.md](../17-field-kit.md).

| Folder / file | Content |
|---|---|
| `PROSPECTS.md` | Pointer: the prospect list and routes are with Sales, outside the repo |
| `collateral/` | Demo and objection cheat sheets, pilot interest sheet, after-demo summary: `templates/` (source), `print/` (PDF), `variants.py` (release-gated wording) |
| `learning-sheet.xlsx` / `learning-sheet-template.csv` | One row per conversation |
| `stand/` | Counter stand: spec, artwork, laser files, fabrication sheet, previews, QA |

Rebuild everything (needs Chrome via Playwright):

```bash
python3 gtm/field/build_learning_sheet.py
python3 gtm/field/collateral/build_collateral.py          # current wording
python3 gtm/field/stand/build_stand.py [--frame 2.0]      # frame thickness from the measured tag
```

Real merchant notes (owner reactions, permissions) belong in `gtm/data/private/` (git-ignored), never in this folder.
