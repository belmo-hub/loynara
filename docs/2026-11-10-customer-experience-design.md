# Customer-side experience: design (ENG-204)

Status: **draft for the founder's OK. Nothing is built.** Build tickets are reserved: ENG-205 first page, ENG-206 stamp and reward moment, ENG-207 head start, ENG-208 surprise bonus. One pull request per ticket, each behind its flag, each off by default.

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

Four environment flags, each strictly `true` or `false`, unset means off:

| Flag | Gates | Ticket |
|---|---|---|
| `FIRST_TAP_HOOK_ENABLED` | New first page: logo, build animation, order of the Wallet step | ENG-205 |
| `STAMP_ANIMATION_ENABLED` | The booking moment that is already merged, plus haptic, reward moment and the referral timing | ENG-206 |
| `HEAD_START_ENABLED` | The owner's head-start setting and the entry at card creation | ENG-207 |
| `SURPRISE_BONUS_ENABLED` | The owner's surprise setting and the draw at booking | ENG-208 |

Rules:
- Off means today's production behaviour: no new markup, no new query, no new ledger row. Each ticket has a test that the flag-off path makes the same queries as before.
- Flags are read on the server only. A page learns about a feature through fields that exist in the API answer only when the flag is on.
- Each flag is added to `.env.example`, `scripts/config-check.ts` (the strict true/false loop) and its test, and to the demo, preview and device-test guards.
- A flag switches the feature for the whole deployment. Per shop, head start and surprise bonus stay off until the owner turns them on in Programm.
- The weekly line has no flag in the brief. Proposal: it rides on `STAMP_ANIMATION_ENABLED`'s ticket as its own small PR with no flag, because it is read-only for the owner. **Founder decides** (section 11).

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
- **Weight:** HTML and CSS only, no library, no image except the logo. The page keeps working without script (the form posts, the card page opens).

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

**Decision needed (recommended: option A).** "Startbonus" already means the bonus with the first booking.

- **A, one Startbonus with a time (recommended):** the owner sets "Startbonus" once and chooses when it is given: *bei der Anmeldung* (new) or *mit der ersten Buchung* (today). Never both. One word for the customer, one row in Programm.
- **B, two bonuses:** head start and Startbonus side by side. Twice the cost for the shop and two names for nearly the same thing.

Rules for the head start at card creation:
- Stamp programmes only in the first version. 1 or 2 stamps, never more than 25 % of the cheapest reward (8 stamps: up to 2; 6 stamps: 1; under 4 stamps: not offered).
- Off by default. Owner only (not the Leitung, not the Kasse). The owner page says what it costs ("jede neue Karte braucht 2 Besuche weniger bis zur Prämie") and why it helps, in Marketing's words.
- Given once per card, inside the enrollment transaction, as its own ledger entry (section 7). A repeat of the request cannot book it twice.
- Shown as "Startbonus" on the preview, in the pill and in "Letzte Aktivität".
- The Wallet pass shows the balance including it from the start.

What stops abuse:
- A guest can open the link on a second device and get a second card with its own Startbonus. Cards cannot be merged and stamps cannot be moved, so two cards with 2 stamps each are worth less than one. The existing limits on card creation per network and per programme stay.
- The Kasse cannot grant it. Changing the setting does not touch existing cards.
- The owner reverses it like any booking, with a reason (the existing correction, which writes a reversal entry).
- It is not a visit: it does not count as a booking in the Übersicht, does not qualify a referral, does not start the Willkommen-zurück clock and does not trigger the first-purchase automation. Each of those is pinned by a test.

## 6. Surprise bonus (ENG-208)

**Blocked on Legal before any code.** A reward that depends on chance may fall under rules for prize draws; Legal has to say whether it may ship, with which wording in the Teilnahmebedingungen, and whether the chance must be stated.

If Legal clears it:
- Owner only, off by default. Two settings: the chance per booking (proposal: 5, 10 or 20 %) and a hard cap per calendar month for the shop (proposal: 10 to 200).
- The draw happens on the server, inside the booking transaction, only for a team-confirmed booking made online (not offline bookings, not corrections, not bonuses).
- At most one surprise per card per calendar month, and none in the booking that already makes a reward ready.
- +1 stamp (stamp programmes only in the first version), as its own ledger entry tied to the booking that triggered it.
- Reversing that booking reverses the surprise with it.
- When the monthly cap is reached, nothing is drawn. The owner sees "x von y in diesem Monat" in Programm.
- Shown honestly on the card and in the activity list as a surprise from the shop. The Kasse sees it on the booked screen, so the team can say it.

What stops abuse: a cashier cannot raise the odds by booking more often for the same card (one per card per month); offline bookings never draw; the monthly cap bounds the shop's cost whatever happens.

## 7. Data model and ledger

The ledger stays append-only and tenant-scoped. No existing row, balance, redemption or export changes. Bonuses are told apart by `source`, as today; `kind` stays `award` / `reversal`.

| Change | Ticket |
|---|---|
| `ledger_entries.source` check gains `head_start` | ENG-207 |
| `programs.head_start smallint not null default 0` with a check 0 to 2; a second column or enum for the time if option A is chosen | ENG-207 |
| Reserved key prefixes `headstart:` and `headstart-reversal:` in `RESERVED_KEY_PREFIXES`; key `headstart:<membershipId>` | ENG-207 |
| `ledger_entries.source` check gains `surprise_bonus` | ENG-208 |
| `programs.surprise_chance smallint default 0`, `programs.surprise_monthly_cap smallint default 0`, with checks | ENG-208 |
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

## 11. Open points for the founder

1. **Head start and the existing Startbonus:** option A (one bonus, owner picks the time) or B (two bonuses)? Recommended: A.
2. **Animation lengths:** the brief says about 1 s per stamp and about 2 s for the reward. Head of Design's motion rules of 10 Nov cap one animation at 480 ms. Proposal: keep each step within the cap and let the reward moment be a sequence of about 1.5 s. Design specs the screens either way.
3. **Sentence on the first page:** "Du hast schon 2 von 8" is shown before the card exists, so it is not yet true at that moment. Proposal: say what the customer gets with the card, then show "Stempel erhalten +2" once it is created. Wording by Marketing and Legal.
4. **Brief strings against house rules:** "bis zum Gratis-Haarschnitt" builds grammar around a reward title (the design system forbids it); "Besuche" (the card counts Stempel); "Belohnung" (the app says Prämie); "Ihr bekommt beide einen Stempel" (the bonus amounts are the owner's and can differ). All customer and owner strings go to Marketing and Legal; none is final in this document.
5. **Surprise bonus:** Legal's answer decides whether ENG-208 is built at all.
6. **Weekly line:** no flag was named for it. Ship it without a flag (read-only), or add a fifth flag?
7. **Points programmes:** head start and surprise bonus for stamps only in the first version?
8. **Haptic on iPhone:** not possible in Safari. Accept Android only?
9. **`STAMP_ANIMATION_ENABLED`:** the booking moment merged today has no flag. Putting it behind this flag means production gets no moment until the flag is turned on. Intended?

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
