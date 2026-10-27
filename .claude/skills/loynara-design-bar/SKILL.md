---
name: loynara-design-bar
description: Loynara's design bar and anti-slop review for the cashier screen, owner dashboard, customer card, onboarding, marketing site and print. Use when designing, critiquing or specifying any Loynara interface or print piece, when a screen "looks generic", or before a design request goes to the CTO.
---

# Loynara design bar

Maintainers: Head of Design owns this bar and proposes changes; Head of Marketing owns the voice rule it cites; the CTO session edits the file.

Loynara is used in three very different moments, and a design that ignores them is wrong even if it is pretty: the cashier has one hand free and ten seconds, often in bad light; the customer glances at the card for five seconds once a week on a phone; the owner is not technical and reads the dashboard between two customers. Print lives on a counter next to a cash register.

## 1. The system we already have (do not reinvent it)

Direction A "Stempelpapier", decided by the founder on 13 October 2026: a light grey ground (#EEF0EF) with white cards, forest green as the primary, Manrope for all text with display titles in Manrope 800 (never italic), pressed coral stamps as the one accent (founder decisions 13 Oct and D-020, 22 Oct). The cashier is the exception: dark, camera-first, with the minus/plus stepper kept. Dark mode follows the system. Points programmes are first-class next to stamp programmes. Read the live app and the existing tokens before proposing anything; a proposal that introduces a new colour, a second typeface or a new component without retiring something is suspect.

## 2. What generic looks like, and is refused

- Gradient hero, purple-blue SaaS palette, glassmorphism, three equal feature cards with icons, centered everything.
- Emoji standing in for icons; stock illustration people; decorative blobs.
- Inter or system fonts "for now"; two weights of one face doing all the hierarchy.
- Placeholder copy, English in a German product, labels that describe the UI instead of the action ("Submit" instead of "1 Stempel").
- Equal visual weight everywhere: if the primary action is not found in one second, the screen failed.
- Motion for decoration; anything that moves without reduced-motion respect.
- Empty, loading and error states left to the framework defaults.

## 3. Rules per surface

**Cashier (dark, camera-first):** one primary action per state, thumb-reachable, at least 44 pt; contrast that survives sunlight and a dim counter; confirmation feedback within 200 ms and visible from arm's length; errors say what to do next in one line; the fallback (scan the QR) always one tap away; nothing requires reading more than six words.

**Customer card:** the balance and the next reward readable in one glance; the shop's name and colour make it theirs; the join flow asks for nothing but consent; Wallet offered, never pushed; works on a four-year-old Android in Chrome.

**Owner dashboard:** the three numbers that matter this week on top (cards, stamps, redemptions); every action phrased as what happens in the shop; no table before a sentence; settings behind one more tap, not on the first screen.

**Onboarding (owner):** at the counter with the founder present, no promised minutes until the rehearsal has measured them; every step has a visible end state; the first customer enrolled live is the finish line; copy in German, du (house rule: `~/Developer/Loynara-runs/company/marketing/2026-10-18-voice-rule.md`; Sie only one-to-one when the owner starts with Sie; neutral third person in contracts and legal pages).

**Marketing site and print:** the same type pair and palette as the product; a flyer that reads from two metres: price, the one promise, the tap; QR codes with quiet zones; no claim the product cannot do today (Wallet "auf Wunsch", NFC only where the tag exists).

## 4. Typography, space, colour, motion

One face (Manrope), hierarchy by size and weight on a fixed scale (for example 12, 14, 16, 20, 28, 40), line length near 65 characters for running text, headings balanced. Spacing on one scale (4 base), never ad hoc pixels. Colour only through tokens; forest green for action, coral for the stamp moment and nothing else, neutrals from the tokens (grey ground, white surfaces). Motion communicates state change (a stamp pressing in, a confirmation settling), 150 to 250 ms, honours reduced motion.

## 5. Accessibility is part of the bar

Contrast at least 4.5:1 for text, 3:1 for large text and controls; touch targets 44 pt; focus states visible; every control has a label; German screen-reader text where it differs from the visual label; no information carried by colour alone (a stamp also changes shape or count).

## 6. The review protocol (ten minutes)

1. Screenshot or live screen, at phone width, light and dark.
2. Five questions: What is the one action here, and is it found in a second? Who is holding the phone, and with what free attention? What state is missing (empty, loading, error, success)? Where does this break the system in section 1? What would a skeptical owner say is "typical software" about it?
3. Verdict: ship, fix (list, file and screen), or rethink (one paragraph on why).
4. Every fix that needs code becomes a ticket-ready request to the CTO: screens, states, acceptance criteria, risk, before and after.

Pair this skill with `taste-skill`, `frontend-design`, `apple-design-skill`, `behavioral-design` and, when installed, the Design plugin's critique and accessibility review and the VectorLab anti-slop set. This skill decides what Loynara is; those tell you how to get there.
