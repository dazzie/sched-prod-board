# sched-prod incident board — plan

The on-call board for sched-prod. One page, one list: tonight's incidents, newest first, so on-call sees
what just broke and takes it.

## Flows

| flow | who | what happens |
|------|-----|--------------|
| `open-board` | on-call | opens the board; sees tonight's incidents |
| `ack-incident` | on-call | picks an incident on the board: its row opens the incident panel, which names the incident; on-call acks it there — "I've got this one" |
| `watch-board` | on-call | keeps the board open; it stays current without a reload |

## Requirements

- **R1** New incidents appear live at the top of the list, newest first.
- **R2** A row has no Ack of its own. Selecting a row (click, Enter or Space) opens that incident's **panel**, which names the incident id. **Ack lives in the panel**: it sends the ack for the incident the panel names (`api.ack(id)`) and marks that incident's row acked. The panel has its own fixed place beside the list (a bottom sheet on narrow screens): it does not move when the list moves, and opening it does not move the list. *(Changed 2026-11-12 by product's decision, see below.)*
- **R3** Show a loader until incidents load.
- **R4** The board refreshes itself every 2 seconds while open.
- **R5** Times show in the viewer's local time; day before month for EU locales (dd/mm).
- **R6** The page names its build: `<meta name="build" content="<git sha>">` in the head and the same sha in the footer.

## Hooks (pinned — tests and the replay rely on them)

| `data-testid` | element |
|---------------|---------|
| `board` | the board's main area |
| `loader` | the loader (gone once incidents load) |
| `empty` | what shows when there are no incidents |
| `incident-list` | the list |
| `incident-row` | one incident row, with `data-id="<incident id>"` |
| `incident-panel` | the incident panel, naming the incident id (shown only while an incident is open) |
| `panel-ack` | the Ack button in the panel |
| `acked` | the acked mark in a row |
| `build-sha` | the sha in the footer |

## Decisions

- **2026-11-12 — Ack leaves the row (product).** The step-one recording showed, at 00:34, a click meant for
  INC-7552 acking INC-1217: a new incident arrived at the top (R1) and moved every row's Ack button down one
  place under the pointer. Product decided: "New incidents stay live at the top. Ack leaves the row: a row
  opens its incident panel, and Ack lives there." R1 is unchanged. R2 changed as written above. The hook
  `ack` (the Ack button in a row) is retired; `incident-panel` and `panel-ack` are new. A click that
  lands on the wrong row after the list moves now only opens the wrong panel, which names its incident;
  nothing is acked until on-call presses Ack in a panel that names the incident they want.

## Done

Every issue in `issues/` delivered, deployed to a public https address, and shown working.
