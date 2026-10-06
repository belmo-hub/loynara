# Overnight product completion (local, for owner review)

Branch `product/overnight-completion-v1`, based on production SHA `c822d2381dc67544a0ba0c898bf2ddcf98035943`.
Nothing here is deployed. Production gating (`lib/pilot-surfaces`) and production config are unchanged.

## What a merchant sees differently

**Overview: "Was jetzt zählt" (SEE → UNDERSTAND → ACT).** Replaces "Als Nächstes", which was hidden in pilot
production because it depended on the campaign/audience surfaces. The new card works everywhere:

- Card base bar: active in 30 days / longer away / never at the counter.
- Observations, each with its rule and a real next step:
  referrals needing review → *Empfehlungen prüfen*; rewards earned but not collected → *Karten ansehen*;
  cards away 30+ days (with week-over-week comparison) → *Karten ansehen* (+ *Rückhol-Aktion vorbereiten* only
  where campaigns are offered, owner only); near reward → *Karten ansehen* (+ *Erinnerung vorbereiten*);
  sign-ups never stamped after 7 days; referred cards waiting for a first checkout.

**Customers.** New view selector: recently active, longer away (14/30/60/90 days), never at the counter,
near reward, reward earned. A "Warum diese Karten?" line explains the rule. Each card shows "Zuletzt vor N Tagen".
Overview links land on the matching view (URL-addressable).

**Win-back / campaigns** (local and preview only; hidden in pilot production as before).
Goals: Kunden zurückholen, An die Prämie erinnern, Ruhige Zeit füllen, Neuigkeit ankündigen (new "all open cards"
audience). Goal links carry the threshold the owner just saw. Audience step links to the matching cards.
Composer has counters and a footer preview. When delivery is disabled there is no schedule field or button;
the saved draft says plainly that nothing was sent. Identical double submits return the same draft.
Campaign detail shows "Danach wieder an der Kasse: X von Y", explicitly not attribution.

**Referrals.** Customer share panel: 3-step explainer, native share on phones, and the card's own progress
("2 Anmeldungen über deinen Link, davon 1 an der Kasse bestätigt"). Owner summary reads as a funnel with
qualification rate and a "needs review" stage. Owner list shows K-XXXXXX card numbers (was raw ID fragments).

**Recovery.** Correction dialog previews balance before → after; the history labels each correction with the
entry it undoes. Reissue and correction show reason-length guidance.

**Team.** "Wer darf was?" matrix mirroring server checks; role hints in the invite form; role chip and location per person.

**Analytics / adviser.** Ergebnisse gets "Kundenbindung heute" with adjustable lapse threshold and links.
The rule-based adviser adds: lapsed cards growing, earned rewards not collected, many sign-ups never stamped,
each with what the data cannot know and a link. No LLM involved.

**Automations.** Merchant-language trigger names, honest delivery banner, card numbers in the run log.

## Definitions (all from recorded data)

A *qualifying checkout* is an unreversed online or reconciled offline staff award (existing rule).
*Longer away*: ≥1 qualifying checkout, none within the threshold. *Never at the counter*: none at all.
*Near reward*: missing ≤ ¼ of the cheapest active reward (1–2 of 8 stamps). *Reward earned*: balance ≥ cheapest
active reward. Closed cards are excluded. Nothing claims why someone stopped coming.

## Fixes found on the way

- Empty `PROMOTIONAL_*` limits (as in `.env.example`) made every campaign preview fail with "Internal error".
- `/api/merchant/locations` read limit (60/15 min) silently flipped the overview to lifetime metrics in busy sessions; now 240/user, 480/peer.
- Removed a technical "sc_" hint at the till; data export is now a labelled download.

## Local review setup

```
cd ~/Developer/Loynara-overnight
npx tsx scripts/seed-demo-activity.ts   # after npm run db:seed; localhost-only synthetic history
```

QA screenshots: `var/qa/shots-r1/` (owner/cashier/public pages at 1440/1280/768/390/320).
