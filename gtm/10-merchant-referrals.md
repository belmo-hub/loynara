# 10 · Merchant-to-merchant referrals

Owners know each other: the barber next door, the pizzeria supplier, the Döner across the street, family who run another shop. One warm introduction is worth about 10 cold doors (planning assumption; measure it). The funnel model assumes 15 % of paying merchants come from introductions (target scenario).

This is a **manual, founder-run process**. Nothing is built into the product, and nothing needs to be.

## Reward: recommendation and status

**No cash, credit, discount or free month is offered.** Any of those is a commercial term and needs founder decision **D-2** (see [README](README.md)) plus the legal documents (O-013).

Until D-2 is decided, the thank-you is non-monetary and costs only founder time:

| Thank-you (no approval needed) | Why it works |
|---|---|
| A personal thank-you visit with a coffee | Local, human, cheap |
| Priority support: their number goes on the founder's "answer within 1 hour" list | Real value for a counter business |
| The introduced shop learns who introduced them, with the referrer's consent | Status among peers |
| Featured in an AD-31 „Ein Tag, ein Laden“ episode, only with written consent and only about the setup | Visibility |

**If D-2 later approves a monetary reward**, the recommended shape is:
- One month's fee credited to the referrer, only after the introduced location has **paid its first invoice**. That mirrors our own customer-referral rule: no reward for the introduction alone.
- One credit per introduced location.
- Written down in the AGB.

This is a recommendation only. It is not offered anywhere in `gtm/`.

## When to ask (trigger moments)

| Moment | Why | Script |
|---|---|---|
| **Day-21 review**, right after showing their own numbers | Peak of seen value | „Kennst du einen anderen Ladeninhaber, für den das auch passen würde? Ich frag nur, ob ich mich auf dich berufen darf – den Rest mach ich.“ |
| When the owner says something positive unprompted | Natural moment | „Freut mich! Wenn dir jemand einfällt, dem das auch helfen könnte – sag Bescheid.“ |
| A "No" at the door (polite close) | They know the street | „Kennst du jemanden hier in der Nähe, für den das eher passt?“ |
| Never | In the first 7 days of a pilot, or after a support problem | — |

## How the introduction happens (three options; the referrer picks)

1. **„Darf ich sagen, dass du mich schickst?“**
   - The founder walks in and opens with the referrer's name.
   - Lowest effort for the referrer. Ask permission explicitly.
   - Opener: „Hi, ich bin [Name]. [Vorname] von [Laden] meinte, ich soll mal bei dir vorbeischauen – er nutzt bei sich die digitale Stempelkarte.“
2. **The referrer messages their peer** and asks if the founder may get in touch. Contact follows only after the peer agrees. This is the cleanest legally; see [05-sales-playbook.md](05-sales-playbook.md).
   - Text the founder can give the referrer to forward (they edit it freely):
   > „Hey, ich hab bei mir im Laden so eine digitale Stempelkarte, ohne App. Der Gründer ist aus der Gegend und zeigt's dir in zwei Minuten. Darf er sich bei dir melden?“
3. **The referrer brings the peer along** to their own shop while the founder is there for the day-21 review. This is the strongest proof: a real counter, a real owner.

**Never** do any of these:
- Ask the referrer for a list of contacts' phone numbers
- Contact a referred owner digitally before they agreed
- Imply the referrer endorses results they haven't seen

## Tracking (in `data/private/pipeline.csv`)

| Column | Example |
|---|---|
| `source` | `merchant_referral` |
| `referred_by` | the referrer's `merchant_id` |
| `intro_type` | `name_drop` · `peer_message` · `brought_along` |
| `referral_permission` | Referrer agreed to be named (yes/no) |

**Monthly review:**
- Introductions per live merchant
- Introduction → demo rate
- Introduction → pilot rate, compared with cold walk-ins
- Which trigger moment produced the introduction

Floor: 1 introduction per 5 live merchants within 30 days after pilot #10 ([04-funnel.md](04-funnel.md)).

## Thank-you loop

1. The referred shop goes live: the founder tells the referrer within 24 h („[Laden] ist jetzt auch dabei – danke dir!“).
2. The referred shop pays: thank-you visit.
3. Each referrer gets a quarterly thank-you, in person.
