# Customer-side experience: design (ENG-204)

Status: **the founder answered the open points on 10 Nov and said to build (section 11).** Nothing is pushed, merged or deployed until he types "go". Build tickets are reserved: ENG-205 first page, ENG-206 stamp and reward moment, ENG-207 head start, ENG-208 surprise bonus. One pull request per ticket, each behind its flag, each off by default.

Goal: the customer adds the card and comes back. The first page and the first ten seconds give a reason to return; every later visit ends in a short, honest moment on the browser card. The Wallet pass cannot animate, so all of this lives on the web pages.

## 1. What exists today, and what is new

| Area | Exists in `railway-rc` | New in this design |
|---|---|---|
| First page `/join/<slug>` | Shop name, empty preview card, reward line, "Meine Karte erstellen", terms sentence, optional message tick (iPhone with Apple Wallet only), Wallet step after creation. No logo. | Logo, head-start stamps on the preview, the card building after the tap, Wallet step only after that. |
| Stamp moment on the card | Pill "Stempel erhalten +1", the stamp lands, the goal line updates, once per booking per device, reduced-motion version (merged 10 Nov, not yet in production, **no flag**). | Put it behind `STAMP_ANIMATION_ENABLED`; add a light haptic; a larger reward moment. |
| "Startbonus" | Owner setting in Programm (0 to 3 stamps), granted **with the first team-confirmed booking**, once per card, ledger source `welcome_bonus`. | A head start granted **at card creation**. See the decision in section 5. |
| Referral | Block on the card whenever the owner has referrals on. Bonus only after the friend's first team-confirmed booking. | Show it from the second confirmed booking, not on the first visit. Crediting unchanged. |
| Owner Übersicht | Bookings per day, new cards, returning cards, "Kurz vor Prämie" (within a quarter of the reward), all over 30 days. | One weekly line; optional "one stamp from the reward" count. |
| Surprise bonus | Nothing. | New, owner-set, capped, ledger-backed. Needs Legal first (section 6). |

## 2. Flags

Five environment flags (the brief's four and one for the weekly line), each strictly `true` or `false`, unset means off:

| Flag | Gates | Ticket |
|---|---|---|
| `FIRST_TAP_HOOK_ENABLED` | New first page: logo, build animation, order of the Wallet step | ENG-205 |
| `STAMP_ANIMATION_ENABLED` | The booking moment that is already merged, plus haptic, reward moment and the referral timing | ENG-206 |
| `HEAD_START_ENABLED` | The owner's head-start setting and the entry at card creation | ENG-207 |
| `SURPRISE_BONUS_ENABLED` | The owner's surprise setting and the draw at booking | ENG-208 |
| `OWNER_WEEKLY_LINE_ENABLED` | The weekly line on the Übersicht | own small ticket |

Rules:
- Off means today's production behaviour: no new markup, no new query, no new ledger row. Each ticket has a test that the flag-off path makes the same queries as before.
- Flags are read on the server only. A page learns about a feature through fields that exist in the API answer only when the flag is on.
- Each flag is added to `.env.example`, `scripts/config-check.ts` (the strict true/false loop) and its test, and to the demo, preview and device-test guards.
- A flag switches the feature for the whole deployment. Per shop, head start and surprise bonus stay off until the owner turns them on in Programm.
- The weekly line had no flag in the brief. The founder left it open, so the brief's rule decides: everything behind a flag, off by default.

## 3. First page (ENG-205)

```
┌──────────────────────────────┐   after the tap (about 0.5 s)
│ [Logo] Barbershop Kaan       │   ┌──────────────────────────────┐
│        Kassel Mitte          │   │ [Logo] Barbershop Kaan       │
│ ┌──────────────────────────┐ │   │ ┌──────────────────────────┐ │
│ │ ● ● ○ ○                  │ │   │ │ ● ● ○ ○   card settles,  │ │
│ │ ○ ○ ○ 🎁    Startbonus 2 │ │   │ │ ○ ○ ○ 🎁  2 stamps land  │ │
│ └──────────────────────────┘ │   │ └──────────────────────────┘ │
│ <progress sentence>          │   │ Stempel erhalten        +2   │
│ <terms sentence, small>      │   └──────────────────────────────┘
│ [ Meine Karte erstellen ]    │   then the existing Wallet step
│ ☐ <message tick, small>      │   (iPhone) or the card page.
└──────────────────────────────┘
```

- **Order:** logo and shop name, the card, one progress sentence, the terms sentence, the one button, the optional message tick below it. No e-mail, no other field (the enroll route already refuses them).
- **Logo:** the programme's stored logo; the monogram when the shop has none. Fixed box, so nothing shifts when it loads.
- **Card picture:** with head start on for this shop, the preview shows the head-start stamps, labelled "Startbonus". Without it, an empty card with the reward named, as today.
- **After the tap:** the request is sent at once. When it answers, the card settles in ("Card arrive") and the head-start stamps land. Only then the Wallet step opens. If the shop has no head start, **no stamp lands**: the card builds empty. A stamp the customer did not get is never shown.
- **Terms and tick:** the existing sentence and the existing consent text and version (Legal's decision of 6 Nov) are kept word for word; only their position changes. The tick stays unchecked and stays limited to the cases where it is offered today.
- **Weight:** HTML and CSS only, no library, no image except the logo. As today the page needs script: it is client-rendered and the enroll route takes JSON, and ENG-205 does not change that. Server rendering plus a form post, so the page works without script, is an option for the founder as its own ticket.
- **Screens:** Head of Design's spec of 10 Nov (revision 2) sets the order, sizes and the steps after the tap; where it differs from the sketch above, the spec is what is built. The shop's uploaded logo needs a public image route that does not exist for browser pages; until that is decided the tile shows the shop's initial.

## 4. Stamp and reward moment (ENG-206)

Every visit (exists, moves behind the flag):
1. The pill "Stempel erhalten +1" drops in.
2. The card steps from the balance last seen; the new stamp lands.
3. The goal line already reads the new state ("Noch 3 Stempel bis zu deiner Prämie").
4. Reduced motion: the end state at once.

New:
- **Haptic:** `navigator.vibrate(10)` when the stamp lands, where the browser has it (Android Chrome). iPhone Safari has no vibration API, so iPhones get none. No sound.
- **Reward moment,** when the booking makes a reward ready. A sequence, not one long animation: the last stamp lands, the card presses once, the band "Prämie verfügbar" opens, the headline names the reward. About 1.5 s in all. The existing redemption instructions sit below it, unchanged.
- **Surprise line** (ENG-208): a second chip in the pill and its own activity row.
- **Referral timing:** the referral block appears on the card once the card has two team-confirmed bookings. It opens right after the second stamp's moment. Before that it is not rendered and its API is not called.

```
 after the last stamp                       after the second stamp
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ ✓ Stempel erhalten       +1  │          │ ● ● ○ ○ ...                  │
│ Deine Prämie ist bereit:     │          ├──────────────────────────────┤
│ Gratis-Haarschnitt           │          │ Karte empfehlen              │
│ ● ● ● ●   (card presses once)│          │ <bonus sentence from the     │
│ ● ● ● ●                      │          │  shop's own settings>        │
│ ┌ Prämie verfügbar. ───────┐ │          │ [ Teilen ] [ Link kopieren ] │
│ └ Lass sie an der Kasse …  ┘ │          └──────────────────────────────┘
└──────────────────────────────┘
```

## 5. Head start (ENG-207)

**Decided: option A.** "Startbonus" already means the bonus with the first booking.

- **A, one Startbonus with a time (recommended):** the owner sets "Startbonus" once and chooses when it is given: *bei der Anmeldung* (new) or *mit der ersten Buchung* (today). Never both. One word for the customer, one row in Programm.
- **B, two bonuses:** head start and Startbonus side by side. Twice the cost for the shop and two names for nearly the same thing.

Rules for the head start at card creation:
- Stamp programmes: 1 or 2 stamps, never more than 25 % of the cheapest reward (8 stamps: up to 2; 6 stamps: 1; under 4 stamps: not offered).
- Points programmes too (founder, 10 Nov): the Startbonus amount the owner already sets (up to 50 points), never more than 25 % of the cheapest reward when it is given at sign-up.
- Off by default. Owner only (not the Leitung, not the Kasse). The owner page says what it costs ("jede neue Karte braucht 2 Besuche weniger bis zur Prämie") and why it helps, in Marketing's words.
- Given once per card, inside the enrollment transaction, as its own ledger entry (section 7). A repeat of the request cannot book it twice.
- Shown as "Startbonus" on the preview, in the pill and in "Letzte Aktivität".
- The Wallet pass shows the balance including it from the start.

As built (ENG-207, with Legal's and Marketing's answers of 10 Nov):
- The cap is read when the owner saves and again when the card is created. Stamps: at most 2. Points: at most 50. Both: never more than 25 % of the cheapest live reward's cost, rounded down (a 100-point reward allows 25 points, a 6-stamp reward 1 stamp, a reward under 4 nothing). The grant books the smaller of the owner's amount and the cap; if that is 0, nothing is booked.
- Owner only, once per card: the key is `headstart:<membershipId>`, and the entry has no actor (like the automatic tap and the expiry job), so `ledger_nfc_actor_valid` is widened with `ledger_source_valid`.
- Never both, by the card and not by the setting: a card with a `head_start` entry (corrected or not) never gets `welcome_bonus`. A card without one still gets the Startbonus with its first team-confirmed booking, also while the owner's choice is sign-up. That covers cards from before the switch and further cards.
- A further card on the same device („Weitere Karte erstellen“, `additionalCard: true`) gets no Startbonus at sign-up. The join page must not show the sentence on that path; `headStart` in the public programme data does not know the path.
- The owner or the Leitung corrects it with the existing correction, under the correction's own key like any directly corrected booking. `headstart-reversal:` is reserved and unused.
- The Teilnahmebedingungen carry Legal's edits (b) and (d) and the Startbonus paragraph. They are not behind the flag and must be live before the flag goes on.

What stops abuse:
- A guest can open the link on a second device and get a second card with its own Startbonus. Cards cannot be merged and stamps cannot be moved, so two cards with 2 stamps each are worth less than one. The existing limits on card creation per network and per programme stay.
- The Kasse cannot grant it. Changing the setting does not touch existing cards.
- The owner or the Leitung reverses it like any booking, with a reason (the existing correction, which writes a reversal entry).
- It is not a visit: it does not count as a booking in the Übersicht, does not qualify a referral, does not start the Willkommen-zurück clock and does not trigger the first-purchase automation. Each of those is pinned by a test.

## 6. Surprise bonus (ENG-208)

**Blocked on Legal before any code.** A reward that depends on chance may fall under rules for prize draws; Legal has to say whether it may ship, with which wording in the Teilnahmebedingungen, and whether the chance must be stated.

If Legal clears it:
- Owner only, off by default. Two settings: the chance per booking (proposal: 5, 10 or 20 %) and a hard cap per calendar month for the shop (proposal: 10 to 200).
- The draw happens on the server, inside the booking transaction, only for a team-confirmed booking made online (not offline bookings, not corrections, not bonuses).
- At most one surprise per card per calendar month, and none in the booking that already makes a reward ready.
- +1 stamp, or on a points programme an amount the owner sets, never more than 25 % of the cheapest reward (points too: founder, 10 Nov). Its own ledger entry tied to the booking that triggered it.
- Reversing that booking reverses the surprise with it.
- When the monthly cap is reached, nothing is drawn. The owner sees "x von y in diesem Monat" in Programm.
- Shown honestly on the card and in the activity list as a surprise from the shop. The Kasse sees it on the booked screen, so the team can say it.

What stops abuse: a cashier cannot raise the odds by booking more often for the same card (one per card per month); offline bookings never draw; the monthly cap bounds the shop's cost whatever happens.

## 7. Data model and ledger

The ledger stays append-only and tenant-scoped. No existing row, balance, redemption or export changes. Bonuses are told apart by `source`, as today; `kind` stays `award` / `reversal`.

| Change | Ticket |
|---|---|
| `ledger_entries.source` check gains `head_start` | ENG-207 |
| Option A: the amount stays `programs.welcome_bonus`; a new column says when it is given (first booking, the default, or sign-up), with a check for the 25 % cap at sign-up | ENG-207 |
| Reserved key prefixes `headstart:` and `headstart-reversal:` in `RESERVED_KEY_PREFIXES`; key `headstart:<membershipId>` | ENG-207 |
| `ledger_entries.source` check gains `surprise_bonus` | ENG-208 |
| `programs.surprise_chance smallint default 0`, `programs.surprise_monthly_cap smallint default 0`, an amount for points programmes, with checks | ENG-208 |
| Reserved prefixes `surprise:` and `surprise-reversal:`; key `surprise:<awardEntryId>` | ENG-208 |

- ENG-205 and ENG-206 need no migration.
- Every place that lists ledger sources (exports, Übersicht, retention, referral qualification, Startbonus check, Wallet messages) is reviewed in the ticket that adds a source; the new sources must appear in exports under their own name and nowhere as a visit.
- Client keys can never use the new prefixes (`assertClientKey` rejects reserved prefixes).

## 8. Migration plan

- Two additive, forward-only migrations, one per ticket (ENG-207, ENG-208), generated with `npm run db:generate` and committed with their snapshots.
- Widening a check constraint means dropping and re-adding it. It is added `NOT VALID` and validated in the same migration, so existing rows are checked without a long lock. The append-only trigger concerns rows, not this constraint.
- New columns have defaults, so old code keeps working during a deploy; new code with the flag off never reads them.
- Rollback: turn the flag off. The columns and the wider check can stay.
- Run only against a local or throwaway database until the release; a person runs it in production. Because the release then contains a migration, the security audit's scope is re-checked (CTO).

## 9. Owner weekly line

One sentence on the Übersicht, rule-based: bookings this week, how many of them by cards with an earlier booking, new cards this week. "This week" is Monday to today in the shop's time zone. Optional second sentence: cards exactly one stamp from their reward. Numbers come from the existing analytics read with a seven-day window plus one small count; nothing is stored. Wording from Marketing (the app says "Buchungen", not "Besuche").

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Link opened twice on the same device | The existing card is offered ("Meine Karte öffnen"); no second card, no second Startbonus. |
| Second device | A new card is created (there is no account). It gets its own Startbonus; see abuse above. The way back to the first card stays "Karte wiederfinden" or the card number. |
| Double tap, retry, slow network on the button | One request at a time (browser lock), and the server books the Startbonus under one key per card, so it exists once. |
| Offline or very slow at the tap | The button shows it is working; on failure the existing error line appears and nothing is animated. No card is drawn before the server has answered. |
| Android or any phone without Apple Wallet | No Wallet step. The browser card page is the card; the moment, haptic and referral work there. |
| Demo shops | All animations work; Startbonus and surprise entries are written to the demo shop's own ledger. Nothing is sent or billed (existing demo rules). |
| Message tick declined | No consent row, so no message can reach the card, and the card page does not ask again by itself. Bonuses do not depend on it. |
| Reduced motion | Every moment shows its end state at once. |
| Booking seen on the tap page first | The card page does not replay it (existing record per device). |
| Programme type changed by the owner | Head start and surprise settings reset to off, as the Startbonus does today. |

## 11. Decisions (founder, 10 Nov)

1. **Head start and the existing Startbonus:** option A, one Startbonus, the owner picks when it is given. (Proposed with the draft; not objected to.)
2. **Animation lengths:** as proposed. Each step stays within Design's 480 ms; the reward moment is a sequence of about 1.5 s.
3. **Sentence on the first page:** it follows the owner's setting. It appears only when the owner gives the Startbonus at sign-up, says what the card comes with, and "Stempel erhalten +2" shows once the card exists. No free text by the owner.
4. **Brief strings against house rules:** left open by the founder. The house rules stand; Marketing writes every string, Legal checks claims.
5. **Surprise bonus:** Legal's answer decides whether ENG-208 is built.
6. **Weekly line:** left open by the founder. Behind its own flag, off by default, like everything else in the brief.
7. **Points programmes:** head start and surprise bonus for points programmes too.
8. **Haptic:** accepted. Chrome on Android vibrates; no browser on an iPhone can (all of them run on Safari's engine).
9. **`STAMP_ANIMATION_ENABLED`:** the booking moment goes behind the flag, as the brief says. Production shows it once a person sets the flag; the demo environment has it on.

## 12. Order of work and checks

1. ENG-205 first page (no ledger change).
2. ENG-206 moment behind its flag, haptic, reward moment, referral timing; the weekly line as its own small PR.
3. ENG-207 head start (migration, L2).
4. ENG-208 surprise bonus (migration, L2), only after Legal.

Each PR: failing test first, then the change; `typecheck`, `lint`, the full `npm test`, a production build; Chrome at 375 px and, for the first time in this work, a real Safari check by a person, because none is available to the build sessions. Design specs and checks the screens; ENG-207 and ENG-208 need the Reviewer and a security re-check of the ledger change before merge. Nothing is pushed, merged or deployed until the founder types "go".

## 13. Risks

- **Ledger:** a new source that some query wrongly counts as a visit. Mitigated by reviewing every source list and a test per consumer.
- **Cost to the shop:** head start and surprise lower the visits needed for a reward. Capped, owner-only, off by default, and explained on the owner page.
- **Legal:** chance-based reward; wording about bonuses on a public page.
- **Honesty:** any animation that shows a stamp before the ledger has it. Ruled out by building the card only from the server's answer.
- **Not verifiable here:** real Safari, Android haptics, VoiceOver.
