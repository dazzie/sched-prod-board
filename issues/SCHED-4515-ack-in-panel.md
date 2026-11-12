---
id: SCHED-4515
title: Ack moves from the row to an incident panel
status: done
plan: R2
---

Follow-up to SCHED-4511, from product's answer to the step-one report (2026-11-12).

With Ack in the row, a new incident arriving at the top moves every Ack button down one place. In the
recording, at 00:34, a click meant for INC-7552 (sev1) acked INC-1217 instead.

Product's decision: "New incidents stay live at the top. Ack leaves the row: a row opens its incident panel,
and Ack lives there."

- Rows keep arriving live at the top (R1, unchanged).
- A row has no Ack button (`data-testid="ack"` is retired). Selecting a row opens the incident panel
  (`data-testid="incident-panel"`), which names the incident id.
- The panel's Ack (`data-testid="panel-ack"`) acks the incident the panel names and marks its row acked
  (`data-testid="acked"`).
- The panel does not move when the list moves, and opening it does not move the list.

Acceptance: while new incidents arrive, an ack always goes to the incident the panel names; a click that
lands on another row only opens that row's panel.
