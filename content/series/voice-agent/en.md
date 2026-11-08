---
title: "Voice agent: AI answers the phone"
description: How to put AI on the first line of your phone and not embarrass yourself in front of customers. Speech recognition, the model and speech synthesis, live dialogue with interruptions, telephony and handing over to a human, actions in the schedule and CRM, quality checks and the cost of a minute.
plan:
  - "Concept: where a voice agent pays off and why latency decides everything"
  - "The cascade: speech recognition, the model and speech synthesis"
  - "Live dialogue: pauses, end of turn and interruptions"
  - "Telephony: a number, SIP and handing over to a human"
  - "Actions: bookings, order status and confirming by voice"
  - "Quality: simulated calls, metrics and reviewing recordings"
  - "To production: load, the cost of a minute and personal data"
---

Over the last two years text chatbots became the norm, while the phone stayed almost everywhere the same: a queue, hold music, "your call is important to us" and a menu of digits. Yet people still call a lot, especially businesses where the customer needs to agree on a time quickly: car services, clinics, salons, delivery, repairs. Half of these calls are the same: book, reschedule, check a status, ask for an address or a price.

In 2026 voice models finally let you put AI on these calls that customers do not mind talking to. Speech recognition is faster than a person finishes a sentence, synthesis sounds natural and starts speaking within a fraction of a second, and language models call tools reliably. The hard part is no longer the models but the glue: how to fit the whole chain into a second, how not to interrupt the person and not stay silent when they are done, how to hand the call to a live employee and how to know the agent is doing well.

The running example is a chain of six car service stations with about four hundred calls a day. The agent books service appointments, reschedules them, tells callers the status of a car under repair, answers questions about addresses and prices, and hands everything it cannot handle to a service advisor. The stack is open and current: LiveKit Agents for the voice pipeline and telephony, streaming speech recognition and synthesis from open or cloud models, and Claude Haiku 5.5 as the agent's brain.

There is little code in the series: only the fragments that carry the idea. What matters here are the decisions: what to hand to the agent, where the border with a human runs, what latency is made of and how to measure quality. Tool versions are as of early November 2026, and each article has a news feed on the topic next to it.
