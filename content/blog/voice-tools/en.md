---
title: "Actions: bookings, order status and confirming by voice"
description: We give the voice agent tools for the schedule and work orders. How to shape tools for voice, hold a slot while the caller thinks, confirm dates and plates without mistakes, survive slow and broken systems, and send a confirmation message.
date: 2026-08-07
updated: 2026-11-08
series: voice-agent
part: 5
tags: [voice, agents, tools]
---

:::tldr
A voice agent's tools are the same as a text agent's, but they answer briefly: two nearest slots instead of a list of twenty, a status in one line instead of the whole work order. A found slot is held for a couple of minutes while the caller thinks so nobody else takes it. Before any action the agent reads back the key details and waits for "yes". The model computes dates from the current time we put into the prompt and says them as a weekday and date. Plates are not spelled letter by letter: the agent finds the car by digits and confirms it by make. Every action is idempotent, slow systems are covered with "one moment, checking", and after a booking the caller gets a message with the date and address.
:::

## Which actions are needed

Going by the table of calls from part one, six tools are enough:

| Tool | What it does |
|---|---|
| `find_slots` | two nearest slots for a service and station |
| `book` | book the held slot |
| `find_booking` | find a customer's booking by phone or plate |
| `reschedule` / `cancel` | move or cancel a booking |
| `car_status` | the status of a car under repair in one sentence |
| `transfer_to_advisor` | connect to an advisor, from the previous part |

Reference questions, station addresses, opening hours and prices of standard services, need no tools: a short reference sheet sits in the system prompt and is cached with it. The tools call the system where the service keeps its schedule and work orders over HTTP. If that system has no convenient API, a small service of your own sits in between, as in the [automations series](/blog/automations-foundation/).

::news{topic="voice"}

## Answers shaped for voice

In a text agent a tool can return a forty-row table: the model will read it and pick what it needs. In voice this is bad for two reasons. A long result increases the model's response time, and the model is strongly tempted to recite everything at once.

So the voice agent's tools do part of the work themselves:

- **`find_slots` returns two slots**, the nearest and the next, not the whole schedule. If neither works, the agent asks which day suits better and calls the tool again with that day.
- **`car_status` returns one sentence** from the work order: "In progress, waiting for a part, ready Friday afternoon." The agent does not need the whole card.
- **Errors are readable.** Not `HTTP 409` but "that slot was just taken, the nearest free one is at eleven". The model relays it to the caller and carries on.

## Hold the slot

Between the moment the agent finds a slot and the moment the caller says "yes, that works", ten to twenty seconds pass. In that time an advisor booking a customer at the desk may take the slot. Awkward: "Oh, that time has just been taken."

The fix is the same as with cinema tickets: a found slot is held for two minutes. `find_slots` returns slots along with a hold ID, `book` confirms it, and an unconfirmed hold expires by itself.

```python
@function_tool
async def find_slots(ctx: RunContext, service: str, station: str, day: str | None = None) -> str:
    """Two nearest free slots for a service. day as YYYY-MM-DD if the caller named a day."""
    slots = await schedule.hold_nearest(service, station, day, count=2, hold_s=120,
                                        hold_key=ctx.userdata.call_id)
    if not slots:
        return "No free slots that day. Offer another day or another station."
    return "; ".join(f"{s.hold_id}: {s.spoken}" for s in slots)
```

`s.spoken` is already written for the ear: "Thursday the twelfth at ten thirty". All the model has to do is offer and wait for the answer.

## Confirm before acting

A recognition mistake in the word "Thursday" is visible right away in chat, while in voice it turns into a customer who shows up on the wrong day. So before every action that changes something, the agent reads back the key details and waits for an explicit "yes":

> "Booking the Kia Rio for an oil change on Thursday the twelfth at ten thirty at the Leninsky station. Is that right?"

The rule is written in the prompt and repeated in the `book` tool description: call it only after the caller has confirmed the date, time, station and car. If the caller says "yes, but not at ten, at eleven", the agent finds a new slot and confirms again.

## Dates, times and plates

Three kinds of data cause the most mistakes in voice.

**Relative dates.** Callers say "the day after tomorrow", "next Thursday", "after the holidays". The model computes them well if it knows what today is. At the start of each turn we add the current date, weekday and the station's time zone. Tools accept ISO dates, and the agent always says them as a weekday and date so the caller can catch a mistake.

**Times.** "Half ten", "around lunch", "ten-ish". The model turns this into a specific time or asks if there are several options: does "around lunch" mean twelve or one?

**License plates.** Spelling a plate letter by letter is painful, and recognition confuses similar letters. So the agent does not require the exact plate. It looks up the caller's cars by phone number, or, if they call from another number, by digits and region, and confirms with something the caller certainly knows: "Is that your grey Kia Rio?" Confirming by make is more reliable than any dictation.

**Phone numbers** the agent repeats in groups, the way people say them.

## Slow and broken systems

The scheduling system answers in half a second on a normal day and in five seconds on Monday morning. For voice that is the difference between a normal conversation and a silence during which the caller hangs up.

- **A phrase before a slow tool.** "One moment, checking the schedule" plays right away and buys the system a couple of seconds, as in the previous part.
- **A timeout.** If a tool has not answered in four seconds, the agent stops waiting: apologizes and offers a callback or an advisor.
- **Idempotency.** Every booking carries a key made of the call ID and the hold. If the request went through, the response got lost and the model retried, no second booking appears.
- **Retry reads only.** Looking up slots and statuses can be retried; a booking must not be retried blindly: first check whether it was created.

## What the agent does not do

Write down the limits as explicitly as the capabilities. Our agent does not discuss discounts or repair costs beyond the price list for standard services, does not diagnose a knocking noise from a description, does not take payments and does not cancel a booking an advisor made for a complex repair. All of that goes to a person. The model keeps such rules well when they are listed briefly and concretely in the prompt, and the tools physically cannot do what is forbidden.

## Confirmation by message

After a booking the caller gets an SMS or messenger message: date, time, station address, what to bring and a link to reschedule. A voice is forgotten in a minute, a message stays. It also catches the last mistakes: if recognition did confuse the day, the caller sees it in the message and calls back.

## What's next

The agent takes calls, books and reschedules, tells the status and hands over to a person. It remains to find out whether it does this well. In the [sixth part](/blog/voice-quality/) we build quality checks: simulated calls with callers of different temperaments, metrics that actually tell you something, and a weekly review of recordings.
